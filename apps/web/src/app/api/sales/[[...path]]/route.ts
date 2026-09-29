import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { STAFF_SESSION_COOKIE } from "@/lib/session-cookie";

export const dynamic = "force-dynamic";

const DEFAULT_API_URL = "http://localhost:3001";

/** Root segment of the private API's sale surface. */
const API_SALES_PREFIX = "/sales";

/** Web mount point of this proxy. */
const WEB_SALES_PREFIX = "/api/sales";

/** Canonical UUID shape required by the upstream sale route params. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** HTTP methods the sale API exposes and this proxy is willing to forward. */
type SaleMethod = "GET" | "POST" | "PUT";

/**
 * Method-independent shapes of the sale API surface. A shape is only "known";
 * whether it is reachable also depends on the HTTP method. Keeping the two
 * apart is what lets a known path reached with a wrong method answer with a
 * method refusal instead of being conflated with an unknown path.
 */
type SalePathShape = "list" | "item" | "cancel" | "complete";

/**
 * Method-aware allowlist for the sale proxy (EPIC-12 POS-004).
 *
 * The proxy is the ONLY browser-facing entrypoint to the private sale API, so
 * it must not become a general-purpose tunnel. A request is forwarded only when
 * its `(method, shape)` pair is listed here; every other combination is refused
 * before any upstream call. The reachable surface is exactly the six routes
 * `POS-001` shipped plus the `POS-003` completion command:
 *
 * - `GET  /sales`                    the caller tenant's sales
 * - `POST /sales`                    create a `DRAFT` sale
 * - `GET  /sales/:uuid`              one sale (foreign/unknown ⇒ 404)
 * - `PUT  /sales/:uuid`              update a `DRAFT` (whole line set)
 * - `POST /sales/:uuid/cancel`       explicit `DRAFT`-only cancel command
 * - `POST /sales/:uuid/complete`     explicit `DRAFT`-only completion command
 *
 * Deliberately absent (so the request is refused here, never smuggled
 * upstream): `PATCH` and `DELETE` anywhere — the API exposes neither, the
 * lifecycle is server-owned, and a sale line is dropped through the update
 * command — plus a caller-supplied `status`, which only the two transition
 * commands may change.
 */
const ALLOWED_SALE_ROUTES: Readonly<Record<SaleMethod, ReadonlySet<SalePathShape>>> = {
  GET: new Set<SalePathShape>(["list", "item"]),
  POST: new Set<SalePathShape>(["list", "cancel", "complete"]),
  PUT: new Set<SalePathShape>(["item"]),
};

/**
 * Query keys the `GET /sales` list accepts, in canonical forward order. It
 * mirrors `saleListQuery` in `apps/api/src/sales/sales.zod.ts` exactly: `status`
 * narrows the list to one lifecycle value and there is no implicit draft-only
 * default. The API validates this query with `.strict()`, so an unknown key is a
 * `400` upstream; this boundary refuses it outright instead of forwarding a
 * parameter the browser invented.
 */
const SALE_LIST_QUERY_KEYS = ["status"] as const;

/**
 * Top-level body keys each shape accepts on a mutating verb, mirroring the
 * `.strict()` request schemas in `apps/api/src/sales/sales.zod.ts`:
 * `createSaleBody` / `updateSaleBody` accept `customerId` and `lines`,
 * `completeSaleBody` accepts `payments`, and the cancel command declares no
 * `@Body` at all so it accepts no field (the client sends `{}`).
 *
 * This is where the proxy refuses, before any upstream call, the keys the
 * contract deliberately excludes — most importantly `tenantId`, which
 * `sales.zod.ts` names explicitly as "resolved server-side from the request
 * context and never caller authority", plus the server-owned `status`,
 * `currency`, `total` and `number` and the non-existent discount field. The
 * refusal reuses the API's own stable `VALIDATION_FAILED` envelope and message
 * for the shape, so a caller cannot tell a proxy refusal from an API refusal by
 * shape or by text ([[TD-013]]).
 *
 * Nested keys (`lines[].*`, `payments[].*`) are NOT inspected here: their
 * `.strict()` schemas stay the API's, exactly as the quantity, unit price and
 * amount patterns do. The check is deliberately a key-set check, never a
 * re-encode: the caller's bytes are forwarded unchanged once the key set is
 * known to be in contract.
 */
const SALE_BODY_KEYS: Readonly<Record<SalePathShape, readonly string[]>> = {
  list: ["customerId", "lines"],
  item: ["customerId", "lines"],
  cancel: [],
  complete: ["payments"],
};

/**
 * The API's own `VALIDATION_FAILED` message per shape (the `parseInput` calls in
 * `sales.controller.ts`). Reusing the exact strings keeps a local refusal
 * byte-compatible with the upstream one it replaces, so the proxy adds no
 * divergence to the rejection contract. `cancel` has no upstream twin because
 * the command declares no body; its message is the local one for the field set
 * the contract does not define.
 */
const SALE_BODY_MESSAGES: Readonly<Record<SalePathShape, string>> = {
  list: "Invalid sale create body.",
  item: "Invalid sale update body.",
  cancel: "Invalid sale cancel body.",
  complete: "Invalid sale completion body.",
};

/**
 * Header the completion command alone consumes (`sales.controller.ts`
 * `readIdempotencyKey`, DEC-024). It is optional: the API serializes on the
 * header row lock and treats an identical replay as a `200` with the same body,
 * while a key reused for a DIFFERENT request fingerprint is a stable `409`.
 * This boundary forwards the caller's value verbatim and NEVER synthesizes or
 * derives one; the `1..255` bound stays the API's `saleIdempotencyKey` schema.
 */
const IDEMPOTENCY_KEY_HEADER = "idempotency-key";

/** Uniform not-found: this boundary never reveals whether a path exists. */
function notFound(): NextResponse {
  return NextResponse.json(
    { error: { code: "NOT_FOUND", message: "Sale route was not found." } },
    { status: 404 }
  );
}

/**
 * Uniform method refusal for a path the API does expose. Same envelope shape as
 * `notFound`, and it deliberately sets no `Allow` header, so the caller cannot
 * enumerate which other methods that path supports. The code names the
 * transport-level method mismatch; it does not reuse `VALIDATION_FAILED`, which
 * this system reserves for payload/DTO validation.
 */
function methodNotAllowed(): NextResponse {
  return NextResponse.json(
    {
      error: {
        code: "METHOD_NOT_ALLOWED",
        message: "Sale route does not support this method.",
      },
    },
    { status: 405 }
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
    { error: { code: "VALIDATION_FAILED", message: "Invalid sale request path." } },
    { status: 400 }
  );
}

/**
 * Payload rejection: the request body is not the JSON object the shape's strict
 * contract defines, or it carries a key that contract does not allow. Answered
 * with the API's own message for the shape, so the refusal is
 * byte-compatible with the one the API would have produced after a wasted hop.
 */
function invalidBody(shape: SalePathShape): NextResponse {
  return NextResponse.json(
    { error: { code: "VALIDATION_FAILED", message: SALE_BODY_MESSAGES[shape] } },
    { status: 400 }
  );
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
 * Classifies validated segments into a known sale path shape, or `null` when the
 * path is not part of the API surface at all. Method-independent, so the caller
 * can tell "unknown path" apart from "known path, wrong method".
 */
function salePathShape(segments: readonly string[]): SalePathShape | null {
  if (segments.length === 0) {
    return "list";
  }
  if (segments.length === 1) {
    const [first] = segments;
    if (first === undefined) {
      return null;
    }
    return UUID_PATTERN.test(first) ? "item" : null;
  }
  if (segments.length === 2) {
    const [first, second] = segments;
    if (first !== undefined && UUID_PATTERN.test(first)) {
      if (second === "cancel") {
        return "cancel";
      }
      if (second === "complete") {
        return "complete";
      }
    }
  }
  return null;
}

/**
 * Rebuilds the upstream query string from the allowlist, or returns `null` when
 * the requested query is out of contract.
 *
 * Query policy: ONLY the `GET /sales` list shape accepts a query, and only its
 * one contract key. A query on any other shape, or an unknown key on the list, is
 * refused (uniform not-found, never dropped silently) so the proxy cannot become
 * a query tunnel. The string is rebuilt from the allowlist rather than forwarded
 * verbatim, so a duplicate key collapses to its first value and a value is always
 * percent-encoded by `URLSearchParams`.
 */
function resolveSaleQuery(
  searchParams: URLSearchParams,
  shape: SalePathShape,
  method: SaleMethod
): string | null {
  if ([...searchParams.keys()].length === 0) {
    return "";
  }
  if (shape !== "list" || method !== "GET") {
    return null;
  }
  for (const key of searchParams.keys()) {
    if (!(SALE_LIST_QUERY_KEYS as readonly string[]).includes(key)) {
      return null;
    }
  }
  const forwarded = new URLSearchParams();
  for (const key of SALE_LIST_QUERY_KEYS) {
    const value = searchParams.get(key);
    if (value !== null && value.length > 0) {
      forwarded.set(key, value);
    }
  }
  const query = forwarded.toString();
  return query.length > 0 ? `?${query}` : "";
}

type SaleResolution =
  | { readonly ok: true; readonly path: string; readonly shape: SalePathShape }
  | { readonly ok: false; readonly response: NextResponse };

/**
 * Resolves the browser pathname to a safe upstream path, or a rejection
 * response. The remainder after `/api/sales` must match an allowlisted shape for
 * the request method, and every emitted segment is re-encoded, so traversal and
 * encoded-separator input can never reshape the upstream URL. Tenant identity is
 * deliberately NOT derived here: the upstream API resolves it from the forwarded
 * session cookie, so a cross-tenant sale id stays a `404` there and this proxy
 * never becomes an authorization authority.
 */
function resolveSalePath(request: NextRequest, method: SaleMethod): SaleResolution {
  const { pathname } = request.nextUrl;
  if (pathname !== WEB_SALES_PREFIX && !pathname.startsWith(`${WEB_SALES_PREFIX}/`)) {
    return { ok: false, response: notFound() };
  }

  const remainder = pathname.slice(WEB_SALES_PREFIX.length);
  // A legitimate route never contains a percent escape; reject any encoded byte
  // outright so a decoded separator cannot add or reshape a path segment.
  if (remainder.includes("%")) {
    return { ok: false, response: invalidPath() };
  }

  // The remainder is "" for the collection root (`/api/sales`) or starts with the
  // single separator of a nested path. A trailing slash yields an empty segment,
  // which the check below refuses rather than normalizing away.
  const segments = remainder.length === 0 ? [] : remainder.slice(1).split("/");
  if (segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")) {
    return { ok: false, response: invalidPath() };
  }

  const shape = salePathShape(segments);
  if (shape === null) {
    return { ok: false, response: notFound() };
  }

  const query = resolveSaleQuery(request.nextUrl.searchParams, shape, method);
  if (query === null) {
    return { ok: false, response: notFound() };
  }

  if (!ALLOWED_SALE_ROUTES[method].has(shape)) {
    return { ok: false, response: methodNotAllowed() };
  }

  const encoded = [API_SALES_PREFIX.slice(1), ...segments].map((segment) =>
    encodeURIComponent(segment)
  );
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

type SaleBodyResolution =
  | { readonly ok: true; readonly body: string | undefined }
  | { readonly ok: false; readonly response: NextResponse };

/**
 * Applies the body contract for the shape, or a rejection response.
 *
 * The body is read once and then forwarded UNCHANGED: the check decides whether
 * the key set is in contract, it never re-encodes the payload, so the API's Zod
 * validation still sees the caller's exact bytes and remains the only validator
 * of values, formats and nested keys. An absent or empty body stays absent — the
 * API decides whether its shape requires one — and a body that is not a JSON
 * object, or that carries a key the shape does not define, is refused here with
 * the API's own message. A rejection is a clean `400` error state; no key is
 * ever dropped, defaulted or silently rewritten.
 */
async function resolveSaleBody(
  request: NextRequest,
  shape: SalePathShape,
  method: SaleMethod
): Promise<SaleBodyResolution> {
  if (method !== "POST" && method !== "PUT") {
    return { ok: true, body: undefined };
  }

  const text = await request.text();
  if (text.trim().length === 0) {
    return { ok: true, body: undefined };
  }

  const parsed = parseJsonObject(text);
  if (parsed === null) {
    return { ok: false, response: invalidBody(shape) };
  }

  const allowed = SALE_BODY_KEYS[shape];
  for (const key of Object.keys(parsed)) {
    if (!allowed.includes(key)) {
      return { ok: false, response: invalidBody(shape) };
    }
  }

  return { ok: true, body: text };
}

/**
 * Proxies staff sale API calls to the private NestJS sale surface.
 *
 * `/api/sales` maps to the upstream `/sales`, and the nested shapes map
 * one-to-one (`/api/sales/:id/cancel` → `/sales/:id/cancel`,
 * `/api/sales/:id/complete` → `/sales/:id/complete`). An empty, unknown,
 * malformed, method-mismatched or out-of-contract request is rejected here
 * before any upstream call.
 *
 * Browser headers cross through a strict allowlist: only the authenticated staff
 * session cookie (read server-side by name, never from the browser),
 * `x-request-id` and — on the completion shape alone — the caller's optional
 * `Idempotency-Key`. No tenant, role or permission header is ever synthesized:
 * the API resolves tenant and permission authority from the session alone. A
 * mutating body is read once and forwarded byte-for-byte after its key set is
 * checked against the shape's contract, and the proxy declares the JSON media
 * type itself because the sale surface is JSON-only. Upstream status, error
 * envelope, `content-type` and `x-request-id` are preserved and the upstream body
 * is streamed back — so a `400`, `403`, `404`, the entitlement `403` and the
 * stable `409`s reach the browser unchanged, and the completion's `201` (fresh)
 * versus `200` (identical replay) distinction survives untouched.
 */
async function proxySaleRequest(request: NextRequest, method: SaleMethod): Promise<NextResponse> {
  const resolution = resolveSalePath(request, method);
  if (!resolution.ok) {
    return resolution.response;
  }

  const cookieStore = await cookies();
  const session = cookieStore.get(STAFF_SESSION_COOKIE);
  // `cookies()` reads the browser's jar, but only the staff cookie is consulted:
  // a portal cookie cannot authenticate a sale request, and an empty value is no
  // credential either.
  if (session === undefined || session.value.length === 0) {
    return unauthenticated();
  }

  const bodyResolution = await resolveSaleBody(request, resolution.shape, method);
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

  // The completion command's optional key is the ONLY header the surface adds
  // beyond the credential: it crosses on that shape verbatim and is dropped
  // everywhere else, exactly as every other non-allowlisted browser header is. It
  // is never generated, reused or derived by the proxy.
  if (resolution.shape === "complete") {
    const idempotencyKey = request.headers.get(IDEMPOTENCY_KEY_HEADER);
    if (idempotencyKey !== null) {
      headers[IDEMPOTENCY_KEY_HEADER] = idempotencyKey;
    }
  }

  const hasBody = bodyResolution.body !== undefined;
  if (hasBody) {
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
  return proxySaleRequest(request, "GET");
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  return proxySaleRequest(request, "POST");
}

export async function PUT(request: NextRequest): Promise<NextResponse> {
  return proxySaleRequest(request, "PUT");
}
