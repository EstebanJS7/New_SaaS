import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { STAFF_SESSION_COOKIE } from "@/lib/session-cookie";

export const dynamic = "force-dynamic";

const DEFAULT_API_URL = "http://localhost:3001";

/** Root segment of the private API's purchase surface. */
const API_PURCHASES_PREFIX = "/purchases";

/** Web mount point of this proxy. */
const WEB_PURCHASES_PREFIX = "/api/purchases";

/** Canonical UUID shape required by the upstream purchase route params. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** HTTP methods the purchase API exposes and this proxy is willing to forward. */
type PurchaseMethod = "GET" | "POST" | "PUT";

/**
 * Method-independent shapes of the purchase API surface. A shape is only
 * "known"; whether it is reachable also depends on the HTTP method. Keeping the
 * two apart is what lets a known path reached with a wrong method answer with a
 * method refusal instead of being conflated with an unknown path.
 */
type PurchasePathShape = "list" | "item" | "cancel" | "receive";

/**
 * Method-aware allowlist for the purchase proxy (EPIC-11 PUR-003).
 *
 * The proxy is the ONLY browser-facing entrypoint to the private purchase API,
 * so it must not become a general-purpose tunnel. A request is forwarded only
 * when its `(method, shape)` pair is listed here; every other combination is
 * refused before any upstream call. The reachable surface is exactly what the
 * purchase API shipped (`PUR-001` draft plus `PUR-002` receiving):
 *
 * - `GET  /purchases`                    the caller tenant's purchases
 * - `POST /purchases`                    create a DRAFT purchase
 * - `GET  /purchases/:uuid`              one purchase (foreign/unknown ⇒ 404)
 * - `PUT  /purchases/:uuid`              update a DRAFT (whole line set)
 * - `POST /purchases/:uuid/cancel`       explicit DRAFT-only cancel command
 * - `POST /purchases/:uuid/receive`      explicit DRAFT-only receive command
 *
 * Deliberately absent (so the request is refused here, never smuggled upstream):
 * `PATCH` and `DELETE` anywhere — the API exposes neither, the lifecycle is
 * server-owned, and a draft line is dropped through the update command — plus a
 * caller-supplied `status`, which the transition commands alone may change.
 */
const ALLOWED_PURCHASE_ROUTES: Readonly<Record<PurchaseMethod, ReadonlySet<PurchasePathShape>>> = {
  GET: new Set<PurchasePathShape>(["list", "item"]),
  POST: new Set<PurchasePathShape>(["list", "cancel", "receive"]),
  PUT: new Set<PurchasePathShape>(["item"]),
};

/**
 * Query keys the `GET /purchases` list accepts, in canonical forward order. It
 * mirrors `purchaseListQuery` in `apps/api/src/purchases/purchases.zod.ts`
 * exactly: `status` narrows the list to one lifecycle value and there is no
 * implicit draft-only default. The API validates this query with `.strict()`, so
 * an unknown key is a `400` upstream; this boundary refuses it outright instead
 * of forwarding a parameter the browser invented.
 */
const PURCHASE_LIST_QUERY_KEYS = ["status"] as const;

/**
 * RequestInit with the `duplex` field required to stream a request body.
 * `duplex` is part of the fetch spec but is absent from the DOM lib types.
 */
type StreamingRequestInit = RequestInit & { duplex?: "half" };

/** Uniform not-found: this boundary never reveals whether a path exists. */
function notFound(): NextResponse {
  return NextResponse.json(
    { error: { code: "NOT_FOUND", message: "Purchase route was not found." } },
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
        message: "Purchase route does not support this method.",
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
    { error: { code: "VALIDATION_FAILED", message: "Invalid purchase request path." } },
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
 * Classifies validated segments into a known purchase path shape, or `null` when
 * the path is not part of the API surface at all. Method-independent, so the
 * caller can tell "unknown path" apart from "known path, wrong method".
 */
function purchasePathShape(segments: readonly string[]): PurchasePathShape | null {
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
      if (second === "receive") {
        return "receive";
      }
    }
  }
  return null;
}

/**
 * Rebuilds the upstream query string from the allowlist, or returns `null` when
 * the requested query is out of contract.
 *
 * Query policy: ONLY the `GET /purchases` list shape accepts a query, and only
 * its one contract key. A query on any other shape, or an unknown key on the
 * list, is refused (uniform not-found, never dropped silently) so the proxy
 * cannot become a query tunnel. The string is rebuilt from the allowlist rather
 * than forwarded verbatim, so a duplicate key collapses to its first value and a
 * value is always percent-encoded by `URLSearchParams`.
 */
function resolvePurchaseQuery(
  searchParams: URLSearchParams,
  shape: PurchasePathShape,
  method: PurchaseMethod
): string | null {
  if ([...searchParams.keys()].length === 0) {
    return "";
  }
  if (shape !== "list" || method !== "GET") {
    return null;
  }
  for (const key of searchParams.keys()) {
    if (!(PURCHASE_LIST_QUERY_KEYS as readonly string[]).includes(key)) {
      return null;
    }
  }
  const forwarded = new URLSearchParams();
  for (const key of PURCHASE_LIST_QUERY_KEYS) {
    const value = searchParams.get(key);
    if (value !== null && value.length > 0) {
      forwarded.set(key, value);
    }
  }
  const query = forwarded.toString();
  return query.length > 0 ? `?${query}` : "";
}

type PurchaseResolution =
  | { readonly ok: true; readonly path: string }
  | { readonly ok: false; readonly response: NextResponse };

/**
 * Resolves the browser pathname to a safe upstream path, or a rejection
 * response. The remainder after `/api/purchases` must match an allowlisted shape
 * for the request method, and every emitted segment is re-encoded, so traversal
 * and encoded-separator input can never reshape the upstream URL. Tenant
 * identity is deliberately NOT derived here: the upstream API resolves it from
 * the forwarded session cookie, so a cross-tenant purchase id stays a `404`
 * there and this proxy never becomes an authorization authority.
 */
function resolvePurchasePath(request: NextRequest, method: PurchaseMethod): PurchaseResolution {
  const { pathname } = request.nextUrl;
  if (pathname !== WEB_PURCHASES_PREFIX && !pathname.startsWith(`${WEB_PURCHASES_PREFIX}/`)) {
    return { ok: false, response: notFound() };
  }

  const remainder = pathname.slice(WEB_PURCHASES_PREFIX.length);
  // A legitimate route never contains a percent escape; reject any encoded byte
  // outright so a decoded separator cannot add or reshape a path segment.
  if (remainder.includes("%")) {
    return { ok: false, response: invalidPath() };
  }

  // The remainder is "" for the collection root (`/api/purchases`) or starts
  // with the single separator of a nested path. A trailing slash yields an empty
  // segment, which the check below refuses rather than normalizing away.
  const segments = remainder.length === 0 ? [] : remainder.slice(1).split("/");
  if (segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")) {
    return { ok: false, response: invalidPath() };
  }

  const shape = purchasePathShape(segments);
  if (shape === null) {
    return { ok: false, response: notFound() };
  }

  const query = resolvePurchaseQuery(request.nextUrl.searchParams, shape, method);
  if (query === null) {
    return { ok: false, response: notFound() };
  }

  if (!ALLOWED_PURCHASE_ROUTES[method].has(shape)) {
    return { ok: false, response: methodNotAllowed() };
  }

  const encoded = [API_PURCHASES_PREFIX.slice(1), ...segments].map((segment) =>
    encodeURIComponent(segment)
  );
  return { ok: true, path: `/${encoded.join("/")}${query}` };
}

/**
 * Proxies staff purchase API calls to the private NestJS purchase surface.
 *
 * `/api/purchases` maps to the upstream `/purchases`, and the nested shapes map
 * one-to-one (`/api/purchases/:id/cancel` → `/purchases/:id/cancel`,
 * `/api/purchases/:id/receive` → `/purchases/:id/receive`). An empty, unknown,
 * malformed or method-mismatched route is rejected here before any upstream
 * call.
 *
 * Browser headers cross through a strict allowlist: only the authenticated
 * staff session cookie (read server-side by name, never from the browser) and
 * `x-request-id`. No tenant, role or permission header is ever synthesized: the
 * API resolves tenant and permission authority from the session alone. For
 * mutating verbs the body is piped to the API as the caller's raw
 * `ReadableStream` instead of being buffered, so the API Zod validation sees the
 * exact input; the proxy declares the JSON media type itself because the
 * purchase surface is JSON-only. Upstream status, error envelope, `content-type`
 * and `x-request-id` are preserved and the upstream body is streamed back — so a
 * `400`, `403`, `404`, `405` or the stable `409` reaches the browser unchanged.
 */
async function proxyPurchaseRequest(
  request: NextRequest,
  method: PurchaseMethod
): Promise<NextResponse> {
  const resolution = resolvePurchasePath(request, method);
  if (!resolution.ok) {
    return resolution.response;
  }

  const cookieStore = await cookies();
  const session = cookieStore.get(STAFF_SESSION_COOKIE);
  // `cookies()` reads the browser's jar, but only the staff cookie is consulted:
  // a portal cookie cannot authenticate a purchase request, and an empty value
  // is no credential either.
  if (session === undefined || session.value.length === 0) {
    return unauthenticated();
  }

  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? DEFAULT_API_URL;
  const headers: Record<string, string> = {
    cookie: `${STAFF_SESSION_COOKIE}=${session.value}`,
  };

  const requestId = request.headers.get("x-request-id");
  if (requestId) {
    headers["x-request-id"] = requestId;
  }

  const hasBody = method === "POST" || method === "PUT";
  if (hasBody) {
    headers["content-type"] = "application/json";
  }

  const init: StreamingRequestInit = {
    method,
    headers,
    body: hasBody ? (request.body ?? undefined) : undefined,
    cache: "no-store",
    // undici requires `duplex: "half"` whenever the body is a stream, so it is
    // declared only for the verbs that carry one.
    ...(hasBody ? { duplex: "half" as const } : {}),
  };

  const response = await fetch(`${apiUrl}${resolution.path}`, init);

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
  return proxyPurchaseRequest(request, "GET");
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  return proxyPurchaseRequest(request, "POST");
}

export async function PUT(request: NextRequest): Promise<NextResponse> {
  return proxyPurchaseRequest(request, "PUT");
}
