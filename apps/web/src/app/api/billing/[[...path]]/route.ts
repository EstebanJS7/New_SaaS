import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { STAFF_SESSION_COOKIE } from "@/lib/session-cookie";

export const dynamic = "force-dynamic";

const DEFAULT_API_URL = "http://localhost:3001";

/**
 * Web mount point of this proxy. The private API's invoice routes are unprefixed
 * (DEC-002) and live at `/invoices`, so the segments after this mount point ARE
 * the upstream path: `/api/billing/invoices/:id` maps to `/invoices/:id` with no
 * prefix to re-add and no segment to drop.
 */
const WEB_BILLING_PREFIX = "/api/billing";

/** HTTP methods the billing API exposes and this proxy is willing to forward. */
type BillingMethod = "GET" | "POST";

/**
 * Shapes of the invoice surface this proxy serves: the invoice collection, one
 * invoice by id, and the two lifecycle commands.
 */
type BillingPathShape = "invoiceList" | "invoiceItem" | "invoiceConfirm" | "invoiceCancel";

/**
 * The five routes this proxy serves, matching the API's own invoice surface
 * (`BillingController`, EPIC-14 BILL-002/BILL-003). They are declared here, in
 * one place, so the reachable surface is readable and cannot grow by accident:
 *
 * - `GET  /invoices`              the caller tenant's invoices (optional `status`)
 * - `POST /invoices`              create one `DRAFT` invoice from a completed sale
 * - `GET  /invoices/:id`          one invoice of the caller tenant with its lines
 * - `POST /invoices/:id/confirm`  the explicit `DRAFT`-only confirmation
 * - `POST /invoices/:id/cancel`   the explicit cancellation with its reason
 *
 * The collection answers both verbs; the id read is `GET`-only and the two
 * lifecycle commands are `POST`-only, because the API declares no `PUT` there.
 * A `GET` on a command is refused here (a uniform not-found, the cash precedent)
 * instead of being forwarded on a hop the API could only answer with its own
 * 404. The id segment is opaque to this proxy: the API owns value validation, so
 * a non-UUID id is its own stable `400`.
 *
 * Deliberately absent (so the request is refused here, never smuggled upstream):
 * `PATCH`, `PUT` and `DELETE` anywhere — the invoice is immutable from creation
 * and drafts are never edited (DEC-038) — plus every fiscal, payment, portal,
 * printable, export or report path (DEC-042, DEC-044, DEC-045). A caller-supplied
 * `tenantId` is refused as a body key below rather than forwarded.
 *
 * The module exports only `GET` and `POST`, so a verb it does not export is
 * answered by the framework's own router before this module runs. The rejection
 * contract this module owns is therefore the unknown path, the malformed path,
 * the out-of-contract query, the out-of-contract body, the method-mismatch
 * `GET` on a command shape, and the missing credential.
 */

/**
 * Query keys each shape accepts, in canonical forward order. It mirrors the
 * billing contracts in `apps/api/src/billing/billing.zod.ts` exactly:
 * `invoiceListQuery` defines the optional `status` for `GET /invoices` (one
 * lifecycle value, with no implicit draft-only default), while the id read and
 * both commands declare no `@Query` at all and therefore accept none. The list
 * query is `.strict()` upstream, so an unknown key is a `400` there; this
 * boundary refuses it outright instead of forwarding a parameter the browser
 * invented.
 */
const BILLING_QUERY_KEYS: Readonly<Record<BillingPathShape, readonly string[]>> = {
  invoiceList: ["status"],
  invoiceItem: [],
  invoiceConfirm: [],
  invoiceCancel: [],
};

/**
 * Body contracts for the shapes that own a request body, mirroring the
 * `.strict()` schemas in `apps/api/src/billing/billing.zod.ts`: `createInvoiceBody`
 * accepts `saleId` alone and `cancelInvoiceBody` accepts `reason` alone.
 *
 * This is where the proxy refuses, before any upstream call, the keys those
 * schemas deliberately exclude — `tenantId` (server-resolved, never caller
 * authority), `status` (server-owned lifecycle, `DRAFT` by schema default),
 * `currency` and `customerId` (both inherited from the source sale, DEC-038),
 * `series`/`number` (allocated only at confirmation, DEC-039) and any
 * caller-supplied line or total. The refusal reuses the API's own stable
 * `VALIDATION_FAILED` message for the shape, so a caller cannot tell a proxy
 * refusal from an API refusal by shape or by text ([[TD-013]]).
 *
 * The two payload-free shapes are deliberately absent: `GET /invoices/:id`
 * takes no body, and `POST /invoices/:id/confirm` declares no `@Body()` at all,
 * so a body sent to it is never read and never forwarded. Nested keys are not
 * inspected because no invoice body has a nested object. The check is
 * deliberately a key-set check, never a re-encode: the caller's bytes are
 * forwarded unchanged once the key set is known to be in contract, so the API's
 * Zod validation (the reason trim, its 1..500 bound and the sale UUID format)
 * stays their only validator.
 */
const BILLING_BODY_CONTRACTS: Readonly<
  Partial<Record<BillingPathShape, { readonly keys: readonly string[]; readonly message: string }>>
> = {
  invoiceList: { keys: ["saleId"], message: "Invalid invoice create body." },
  invoiceCancel: { keys: ["reason"], message: "Invalid invoice cancel body." },
};

/** Uniform not-found: this boundary never reveals whether a path exists. */
function notFound(): NextResponse {
  return NextResponse.json(
    { error: { code: "NOT_FOUND", message: "Billing route was not found." } },
    { status: 404 }
  );
}

/**
 * Structural rejection: the request path is malformed (a percent escape, an
 * empty segment, or a `.`/`..` segment) rather than a request for a route that
 * does not exist. Refusing it is what keeps "the matched shape is the requested
 * path" true, so `//`, a trailing slash and an encoded separator can never be
 * normalized onto a real route.
 */
function invalidPath(): NextResponse {
  return NextResponse.json(
    { error: { code: "VALIDATION_FAILED", message: "Invalid billing request path." } },
    { status: 400 }
  );
}

/**
 * Payload rejection: the request body is not the JSON object the shape's strict
 * contract defines, or it carries a key that contract does not allow. Answered
 * with the API's own message for the shape, so the refusal is byte-compatible
 * with the one the API would have produced after a wasted hop.
 */
function invalidBody(message: string): NextResponse {
  return NextResponse.json({ error: { code: "VALIDATION_FAILED", message } }, { status: 400 });
}

/**
 * Rejection for a request that carries no staff session. The private API answers
 * a missing session with this exact `401 UNAUTHENTICATED` envelope (`auth.guard`
 * + `global-exception.filter`); this boundary refuses it earlier only because
 * there is no credential to forward. A portal cookie can never satisfy this: the
 * two cookie families are separate, and the portal cookie is not read here.
 */
function unauthenticated(): NextResponse {
  return NextResponse.json(
    { error: { code: "UNAUTHENTICATED", message: "Authentication required." } },
    { status: 401 }
  );
}

/**
 * Classifies validated segments into a known billing path shape, or `null` when
 * the path is not part of the API surface for the request method. The classifier
 * is method-aware exactly where the API is: the collection answers both verbs,
 * the id read is `GET`-only, and `invoices/:id/confirm` and `invoices/:id/cancel`
 * are `POST`-only, so a `GET` on either command is `null` here (a refusal)
 * instead of a forwarded hop the API could only answer with its own 404.
 *
 * The middle segment of a command shape is an opaque invoice id: it is
 * re-encoded like every other segment and deliberately NOT validated here — the
 * API owns value validation, and this proxy owns only "is this a known shape".
 * The segment count is exact, so `/invoices/:id/confirm/extra`, `/invoices/:id`
 * with a wrong method and `/invoices/:id/lines` are unknown paths rather than
 * half-matched routes.
 */
function billingPathShape(
  segments: readonly string[],
  method: BillingMethod
): BillingPathShape | null {
  if (segments.length === 1) {
    return segments[0] === "invoices" ? "invoiceList" : null;
  }
  if (segments.length === 2) {
    return segments[0] === "invoices" && method === "GET" ? "invoiceItem" : null;
  }
  if (segments.length === 3 && segments[0] === "invoices" && method === "POST") {
    if (segments[2] === "confirm") {
      return "invoiceConfirm";
    }
    if (segments[2] === "cancel") {
      return "invoiceCancel";
    }
  }
  return null;
}

/**
 * Rebuilds the upstream query string from the shape's allowlist, or returns
 * `null` when the requested query is out of contract.
 *
 * Query policy: only `GET` accepts a query, and only the keys the shape's
 * contract defines (`status` for the invoice list, none for the id read or
 * either command). A query on a mutating verb, or an unknown key, is refused
 * (uniform not-found, never dropped silently) so the proxy cannot become a query
 * tunnel. The string is rebuilt from the allowlist rather than forwarded
 * verbatim, so a duplicate key collapses to its first value and a value is
 * always percent-encoded by `URLSearchParams`.
 */
function resolveBillingQuery(
  searchParams: URLSearchParams,
  shape: BillingPathShape,
  method: BillingMethod
): string | null {
  if ([...searchParams.keys()].length === 0) {
    return "";
  }
  if (method !== "GET") {
    return null;
  }
  const allowed = BILLING_QUERY_KEYS[shape];
  for (const key of searchParams.keys()) {
    if (!allowed.includes(key)) {
      return null;
    }
  }
  const forwarded = new URLSearchParams();
  for (const key of allowed) {
    const value = searchParams.get(key);
    if (value !== null && value.length > 0) {
      forwarded.set(key, value);
    }
  }
  const query = forwarded.toString();
  return query.length > 0 ? `?${query}` : "";
}

type BillingResolution =
  | { readonly ok: true; readonly path: string; readonly shape: BillingPathShape }
  | { readonly ok: false; readonly response: NextResponse };

/**
 * Resolves the browser pathname to a safe upstream path, or a rejection
 * response. The remainder after `/api/billing` must match an allowlisted shape
 * for the request method, and every emitted segment is re-encoded, so traversal
 * and encoded-separator input can never reshape the upstream URL. Tenant
 * identity is deliberately NOT derived here: the upstream API resolves it from
 * the forwarded session cookie, so no client value can re-scope an invoice read
 * or write and this proxy never becomes an authorization authority. A
 * cross-tenant invoice id therefore stays the API's own `404`.
 */
function resolveBillingPath(request: NextRequest, method: BillingMethod): BillingResolution {
  const { pathname } = request.nextUrl;
  if (pathname !== WEB_BILLING_PREFIX && !pathname.startsWith(`${WEB_BILLING_PREFIX}/`)) {
    return { ok: false, response: notFound() };
  }

  const remainder = pathname.slice(WEB_BILLING_PREFIX.length);
  // A legitimate route never contains a percent escape; reject any encoded byte
  // outright so a decoded separator cannot add or reshape a path segment.
  if (remainder.includes("%")) {
    return { ok: false, response: invalidPath() };
  }

  // The remainder is "" for the mount root (`/api/billing`, which is not a route
  // of this surface) or starts with the single separator of a sub-path. A
  // trailing slash yields an empty segment, which the check below refuses rather
  // than normalizing away.
  const segments = remainder.length === 0 ? [] : remainder.slice(1).split("/");
  if (segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")) {
    return { ok: false, response: invalidPath() };
  }

  const shape = billingPathShape(segments, method);
  if (shape === null) {
    return { ok: false, response: notFound() };
  }

  const query = resolveBillingQuery(request.nextUrl.searchParams, shape, method);
  if (query === null) {
    return { ok: false, response: notFound() };
  }

  const encoded = segments.map((segment) => encodeURIComponent(segment));
  return { ok: true, path: `/${encoded.join("/")}${query}`, shape };
}

/** Parses a request body as a JSON object, or `null` when it is anything else. */
function parseJsonObject(text: string): Record<string, unknown> | null {
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

type BillingBodyResolution =
  | { readonly ok: true; readonly body: string | undefined }
  | { readonly ok: false; readonly response: NextResponse };

/**
 * Applies the body contract for the shape, or a rejection response.
 *
 * A shape with no body contract (the `GET` id read and the payload-free confirm
 * command) never has its body read, so nothing a browser sends on those paths
 * can reach the API. For a body-owning shape the body is read once and then
 * forwarded UNCHANGED: the check decides whether the key set is in contract, it
 * never re-encodes the payload, so the API's Zod validation still sees the
 * caller's exact bytes and remains the only validator of values and formats (the
 * cancel reason's trim and length bounds included). An absent or empty body
 * stays absent — the API decides whether its shape requires one — and a body that
 * is not a JSON object, or that carries a key the shape does not define, is
 * refused here with the API's own message. A rejection is a clean `400` error
 * state; no key is ever dropped, defaulted or silently rewritten, so `tenantId`,
 * `status`, `currency`, `customerId`, `series`, `number` and every caller-supplied
 * total can never reach the API.
 */
async function resolveBillingBody(
  request: NextRequest,
  shape: BillingPathShape,
  method: BillingMethod
): Promise<BillingBodyResolution> {
  const contract = BILLING_BODY_CONTRACTS[shape];
  if (method !== "POST" || contract === undefined) {
    return { ok: true, body: undefined };
  }

  const text = await request.text();
  if (text.trim().length === 0) {
    return { ok: true, body: undefined };
  }

  const parsed = parseJsonObject(text);
  if (parsed === null) {
    return { ok: false, response: invalidBody(contract.message) };
  }

  for (const key of Object.keys(parsed)) {
    if (!contract.keys.includes(key)) {
      return { ok: false, response: invalidBody(contract.message) };
    }
  }

  return { ok: true, body: text };
}

/**
 * Proxies staff billing API calls to the private NestJS invoice surface.
 *
 * `/api/billing/invoices` maps to the upstream `/invoices`,
 * `/api/billing/invoices/:id` to `/invoices/:id`, and the two commands to
 * `/invoices/:id/confirm` and `/invoices/:id/cancel`.An empty, unknown,
 * malformed, method-mismatched or out-of-contract request is rejected here
 * before any upstream call.
 *
 * Browser headers cross through a strict allowlist: the authenticated staff
 * session cookie (read server-side by name, never from the browser) and
 * `x-request-id`. No tenant, role, permission or user header is ever synthesized
 * — in particular the invoice's tenant is resolved by the API from the
 * authenticated context, never from the body or a forwarded header, and neither
 * command takes an `Idempotency-Key` (both are payload-free and state-guarded,
 * DEC-041/DEC-043). A mutating body is read once and forwarded byte-for-byte
 * after its key set is checked against the shape's contract, and the proxy
 * declares the JSON media type itself because the invoice surface is
 * JSON-only. Upstream status, error envelope, `content-type` and `x-request-id`
 * are preserved and the upstream body is streamed back — so a `400`, the
 * entitlement `403`, the permission `403`, `404` and the stable `409`s
 * (incomplete sale, customer required, sale already invoiced, not a draft, not
 * cancellable) reach the browser unchanged.
 */
async function proxyBillingRequest(
  request: NextRequest,
  method: BillingMethod
): Promise<NextResponse> {
  const resolution = resolveBillingPath(request, method);
  if (!resolution.ok) {
    return resolution.response;
  }

  const cookieStore = await cookies();
  const session = cookieStore.get(STAFF_SESSION_COOKIE);
  // `cookies()` reads the browser's jar, but only the staff cookie is consulted:
  // a portal cookie cannot authenticate a billing request, and an empty value is
  // no credential either.
  if (session === undefined || session.value.length === 0) {
    return unauthenticated();
  }

  const bodyResolution = await resolveBillingBody(request, resolution.shape, method);
  if (!bodyResolution.ok) {
    return bodyResolution.response;
  }

  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? DEFAULT_API_URL;
  const headers: Record<string, string> = {
    cookie: `${STAFF_SESSION_COOKIE}=${session.value}`,
  };

  const requestId = request.headers.get("x-request-id");
  if (requestId) {
    headers["x-request-id"] = requestId;
  }

  if (bodyResolution.body !== undefined) {
    headers["content-type"] = "application/json";
  }

  const response = await fetch(`${apiUrl}${resolution.path}`, {
    method,
    headers,
    body: bodyResolution.body,
    cache: "no-store",
  });

  const responseHeaders: Record<string, string> = {
    "content-type": response.headers.get("content-type") ?? "application/json",
  };

  const responseRequestId = response.headers.get("x-request-id");
  if (responseRequestId) {
    responseHeaders["x-request-id"] = responseRequestId;
  }

  return new NextResponse(response.body, {
    status: response.status,
    headers: responseHeaders,
  });
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  return proxyBillingRequest(request, "GET");
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  return proxyBillingRequest(request, "POST");
}
