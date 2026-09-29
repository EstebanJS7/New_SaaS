import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { STAFF_SESSION_COOKIE } from "@/lib/session-cookie";

export const dynamic = "force-dynamic";

const DEFAULT_API_URL = "http://localhost:3001";

/** Root segment of the private API's cash surface. */
const API_CASH_PREFIX = "/cash";

/** Web mount point of this proxy. */
const WEB_CASH_PREFIX = "/api/cash";

/** HTTP methods the cash API exposes and this proxy is willing to forward. */
type CashMethod = "GET" | "POST";

/**
 * Method-independent shapes of the cash API surface: the register sub-collection
 * and the session sub-collection.
 */
type CashPathShape = "registers" | "sessions";

/**
 * The four routes this proxy serves, matching the API's own cash surface (EPIC-12
 * POS-004). They are declared here, in one place, so the reachable surface is
 * readable and cannot grow by accident:
 *
 * - `GET  /cash/registers`   the caller tenant's registers
 * - `POST /cash/registers`   create an in-tenant register
 * - `GET  /cash/sessions`    the caller tenant's sessions (optional `status`)
 * - `POST /cash/sessions`    open one session for an in-tenant register
 *
 * Deliberately absent (so the request is refused here, never smuggled upstream):
 * `PATCH` and `DELETE` anywhere, and every `POST /cash/sessions/:id/close`-style
 * route — session close, the expected/counted difference, the six remaining
 * movement kinds and the cash reversal belong to EPIC-13 (DEC-020), and this
 * Story ships no close command. A caller-supplied `status`, `tenantId`,
 * `openedByMembershipId`, `currency`, `branchId` or `isActive` is refused as a
 * body key below rather than forwarded.
 *
 * Unlike the sale surface, these four pairs form a COMPLETE method×shape product
 * (each shape answers both verbs), so the cash proxy has no reachable
 * "known path, disallowed method" branch: a verb it does not export is answered
 * by the framework's own router before this module runs, and the module exports
 * only `GET` and `POST`. The rejection contract this module owns is therefore the
 * unknown path, the malformed path, the out-of-contract query, the
 * out-of-contract body and the missing credential.
 */

/**
 * Query keys each shape accepts, in canonical forward order. It mirrors the cash
 * contracts in `apps/api/src/cash/cash.zod.ts` exactly: `cashSessionListQuery`
 * defines `status` for `GET /cash/sessions` (one lifecycle value, with no
 * implicit open-only default), while the register list declares no `@Query` at
 * all and therefore accepts none. Both queries are `.strict()` upstream, so an
 * unknown key is a `400` there; this boundary refuses it outright instead of
 * forwarding a parameter the browser invented.
 */
const CASH_QUERY_KEYS: Readonly<Record<CashPathShape, readonly string[]>> = {
  registers: [],
  sessions: ["status"],
};

/**
 * Top-level body keys each shape accepts on `POST`, mirroring the `.strict()`
 * request schemas in `apps/api/src/cash/cash.zod.ts`: `createCashRegisterBody`
 * accepts `name` alone, and `openCashSessionBody` accepts `registerId` and
 * `openingAmount` alone.
 *
 * This is where the proxy refuses, before any upstream call, the keys those
 * schemas deliberately exclude — `tenantId` (server-resolved, never caller
 * authority), the server-owned `status` and `isActive`, the server-resolved
 * `openedByMembershipId` instead of any caller identity, and the non-existent
 * `currency` and `branchId` (DEC-020: there is no currency column and no Branch
 * dimension). The refusal reuses the API's own stable `VALIDATION_FAILED`
 * envelope and message for the shape, so a caller cannot tell a proxy refusal
 * from an API refusal by shape or by text ([[TD-013]]).
 *
 * Nested keys are not inspected because neither cash body has a nested object.
 * The check is deliberately a key-set check, never a re-encode: the caller's
 * bytes are forwarded unchanged once the key set is known to be in contract.
 */
const CASH_BODY_KEYS: Readonly<Record<CashPathShape, readonly string[]>> = {
  registers: ["name"],
  sessions: ["registerId", "openingAmount"],
};

/**
 * The API's own `VALIDATION_FAILED` message per shape (the `parseInput` calls in
 * `cash.controller.ts`). Reusing the exact strings keeps a local refusal
 * byte-compatible with the upstream one it replaces, so the proxy adds no
 * divergence to the rejection contract.
 */
const CASH_BODY_MESSAGES: Readonly<Record<CashPathShape, string>> = {
  registers: "Invalid cash register create body.",
  sessions: "Invalid cash session open body.",
};

/** Uniform not-found: this boundary never reveals whether a path exists. */
function notFound(): NextResponse {
  return NextResponse.json(
    { error: { code: "NOT_FOUND", message: "Cash route was not found." } },
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
    { error: { code: "VALIDATION_FAILED", message: "Invalid cash request path." } },
    { status: 400 }
  );
}

/**
 * Payload rejection: the request body is not the JSON object the shape's strict
 * contract defines, or it carries a key that contract does not allow. Answered
 * with the API's own message for the shape, so the refusal is byte-compatible
 * with the one the API would have produced after a wasted hop.
 */
function invalidBody(shape: CashPathShape): NextResponse {
  return NextResponse.json(
    { error: { code: "VALIDATION_FAILED", message: CASH_BODY_MESSAGES[shape] } },
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
 * Classifies validated segments into a known cash path shape, or `null` when the
 * path is not part of the API surface at all. Method-independent, so the caller
 * can tell "unknown path" apart from "known path, wrong method". The two
 * sub-collections are the whole surface: there is no third segment, so
 * `/api/cash/sessions/:id/close` is an unknown path rather than a command this
 * slice forgot to allow.
 */
function cashPathShape(segments: readonly string[]): CashPathShape | null {
  if (segments.length !== 1) {
    return null;
  }
  const [first] = segments;
  if (first === "registers") {
    return "registers";
  }
  if (first === "sessions") {
    return "sessions";
  }
  return null;
}

/**
 * Rebuilds the upstream query string from the shape's allowlist, or returns
 * `null` when the requested query is out of contract.
 *
 * Query policy: only `GET` accepts a query, and only the keys the shape's
 * contract defines (`status` for the session list, none for the register list).
 * A query on a mutating verb, or an unknown key, is refused (uniform not-found,
 * never dropped silently) so the proxy cannot become a query tunnel. The string
 * is rebuilt from the allowlist rather than forwarded verbatim, so a duplicate
 * key collapses to its first value and a value is always percent-encoded by
 * `URLSearchParams`.
 */
function resolveCashQuery(
  searchParams: URLSearchParams,
  shape: CashPathShape,
  method: CashMethod
): string | null {
  if ([...searchParams.keys()].length === 0) {
    return "";
  }
  if (method !== "GET") {
    return null;
  }
  const allowed = CASH_QUERY_KEYS[shape];
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

type CashResolution =
  | { readonly ok: true; readonly path: string; readonly shape: CashPathShape }
  | { readonly ok: false; readonly response: NextResponse };

/**
 * Resolves the browser pathname to a safe upstream path, or a rejection
 * response. The remainder after `/api/cash` must match an allowlisted shape for
 * the request method, and every emitted segment is re-encoded, so traversal and
 * encoded-separator input can never reshape the upstream URL. Tenant identity is
 * deliberately NOT derived here: the upstream API resolves it from the forwarded
 * session cookie, so no client value can re-scope a cash read or write and this
 * proxy never becomes an authorization authority.
 */
function resolveCashPath(request: NextRequest, method: CashMethod): CashResolution {
  const { pathname } = request.nextUrl;
  if (pathname !== WEB_CASH_PREFIX && !pathname.startsWith(`${WEB_CASH_PREFIX}/`)) {
    return { ok: false, response: notFound() };
  }

  const remainder = pathname.slice(WEB_CASH_PREFIX.length);
  // A legitimate route never contains a percent escape; reject any encoded byte
  // outright so a decoded separator cannot add or reshape a path segment.
  if (remainder.includes("%")) {
    return { ok: false, response: invalidPath() };
  }

  // The remainder is "" for the collection root (`/api/cash`, which is not a
  // route of this surface) or starts with the single separator of a sub-path. A
  // trailing slash yields an empty segment, which the check below refuses rather
  // than normalizing away.
  const segments = remainder.length === 0 ? [] : remainder.slice(1).split("/");
  if (segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")) {
    return { ok: false, response: invalidPath() };
  }

  const shape = cashPathShape(segments);
  if (shape === null) {
    return { ok: false, response: notFound() };
  }

  const query = resolveCashQuery(request.nextUrl.searchParams, shape, method);
  if (query === null) {
    return { ok: false, response: notFound() };
  }

  const encoded = [API_CASH_PREFIX.slice(1), ...segments].map((segment) =>
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

type CashBodyResolution =
  | { readonly ok: true; readonly body: string | undefined }
  | { readonly ok: false; readonly response: NextResponse };

/**
 * Applies the body contract for the shape, or a rejection response.
 *
 * The body is read once and then forwarded UNCHANGED: the check decides whether
 * the key set is in contract, it never re-encodes the payload, so the API's Zod
 * validation still sees the caller's exact bytes and remains the only validator
 * of values and formats (the register-name length and the opening-amount pattern
 * included). An absent or empty body stays absent — the API decides whether its
 * shape requires one — and a body that is not a JSON object, or that carries a
 * key the shape does not define, is refused here with the API's own message. A
 * rejection is a clean `400` error state; no key is ever dropped, defaulted or
 * silently rewritten, so `tenantId`, `status`, `isActive`,
 * `openedByMembershipId`, `currency` and `branchId` can never reach the API.
 */
async function resolveCashBody(
  request: NextRequest,
  shape: CashPathShape,
  method: CashMethod
): Promise<CashBodyResolution> {
  if (method !== "POST") {
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

  const allowed = CASH_BODY_KEYS[shape];
  for (const key of Object.keys(parsed)) {
    if (!allowed.includes(key)) {
      return { ok: false, response: invalidBody(shape) };
    }
  }

  return { ok: true, body: text };
}

/**
 * Proxies staff cash API calls to the private NestJS cash surface.
 *
 * `/api/cash/registers` maps to the upstream `/cash/registers` and
 * `/api/cash/sessions` to `/cash/sessions`. An empty, unknown, malformed,
 * method-mismatched or out-of-contract request is rejected here before any
 * upstream call.
 *
 * Browser headers cross through a strict allowlist: only the authenticated staff
 * session cookie (read server-side by name, never from the browser) and
 * `x-request-id`. No tenant, role, permission or user header is ever
 * synthesized — in particular the session opener is resolved by the API from the
 * authenticated context, never from the body or a forwarded header. A mutating
 * body is read once and forwarded byte-for-byte after its key set is checked
 * against the shape's contract, and the proxy declares the JSON media type
 * itself because the cash surface is JSON-only. Upstream status, error envelope,
 * `content-type` and `x-request-id` are preserved and the upstream body is
 * streamed back — so a `400`, the entitlement `403`, the permission `403`,
 * `404` and the two stable `409`s (duplicate register name, register already
 * open) reach the browser unchanged.
 */
async function proxyCashRequest(request: NextRequest, method: CashMethod): Promise<NextResponse> {
  const resolution = resolveCashPath(request, method);
  if (!resolution.ok) {
    return resolution.response;
  }

  const cookieStore = await cookies();
  const session = cookieStore.get(STAFF_SESSION_COOKIE);
  // `cookies()` reads the browser's jar, but only the staff cookie is consulted:
  // a portal cookie cannot authenticate a cash request, and an empty value is no
  // credential either.
  if (session === undefined || session.value.length === 0) {
    return unauthenticated();
  }

  const bodyResolution = await resolveCashBody(request, resolution.shape, method);
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
  return proxyCashRequest(request, "GET");
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  return proxyCashRequest(request, "POST");
}
