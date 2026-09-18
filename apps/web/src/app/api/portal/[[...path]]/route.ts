import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { PORTAL_SESSION_COOKIE } from "@/lib/session-cookie";

export const dynamic = "force-dynamic";

const DEFAULT_API_URL = "http://localhost:3001";

/** Root segment of the private API's isolated portal surface. */
const API_PORTAL_PREFIX = "/portal";

/** Web mount point of the portal proxy. */
const WEB_PORTAL_PREFIX = "/api/portal";

/**
 * UUID shape accepted for a nested portal resource. Kept as a plain pattern
 * (no dependency) so the boundary rejects anything that is not a plain
 * identifier before it can reach the API.
 */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** HTTP methods the portal API exposes and this proxy is willing to forward. */
type PortalMethod = "GET" | "POST" | "PUT";

/** Literal portal collections reachable as a bare `GET` read. */
const PORTAL_COLLECTIONS: ReadonlySet<string> = new Set(["me", "pets", "appointments"]);

/** Collections that may be followed by exactly one UUID path segment. */
const PORTAL_RESOURCE_COLLECTIONS: ReadonlySet<string> = new Set(["pets", "appointments"]);

/**
 * Method-independent shapes of the portal API surface. A shape is only
 * "known"; whether it is reachable also depends on the HTTP method.
 */
type PortalPathShape = "collection" | "resource" | "profile" | "booking" | "availability";

/**
 * Method-aware allowlist for the portal proxy (EPIC-08 WU4D).
 *
 * The proxy is the ONLY browser-facing entrypoint to the private portal API, so
 * it must not become a general-purpose tunnel. A path is forwarded only when
 * its `(method, shape)` pair is listed here; every other combination is
 * refused. The reachable surface is exactly what the API exposes to a holder:
 *
 * - `GET  /portal/me`
 * - `GET  /portal/pets`, `GET  /portal/pets/:uuid`
 * - `GET  /portal/appointments`, `GET  /portal/appointments/:uuid`
 * - `GET  /portal/availability` (DEC-007 A2a; the ONLY shape with a query)
 * - `GET  /portal/profile`, `PUT /portal/profile`
 * - `POST /portal/pets/:uuid/bookings`
 *
 * Deliberately absent (so the request is refused here, never smuggled
 * upstream): `POST`/`PUT`/`PATCH`/`DELETE` on any read shape, the API's
 * `POST /portal/login` and `POST /portal/logout`, the deferred surfaces
 * (invoices, documents, files, notifications, email, clinical subdomains) and
 * the staff booking-status routes (approve/reject), which are staff
 * `booking-requests`, not portal routes.
 *
 * QUERY POLICY: portal routes are query-free EXCEPT the availability read,
 * whose contract is exactly `date`, `durationMinutes` and `stepMinutes`. Any
 * query on another shape is refused, and an unknown availability query key is
 * refused too (uniform 404, never dropped silently) so the proxy cannot become
 * a query tunnel. The forwarded query is rebuilt from the allowlist, so
 * extra/duplicate values never reach the API.
 *
 * Rejections: unknown paths, a query on a query-free shape, an unknown
 * availability query key, percent-encoded segments (which could hide a
 * different upstream path), empty/`.`/`..` segments, nested ids that are not
 * UUIDs, and a known path reached with a method it does not support. Nothing
 * else from the browser crosses the boundary — only the portal cookie and
 * `x-request-id` are forwarded.
 */
const ALLOWED_PORTAL_ROUTES: Readonly<Record<PortalMethod, ReadonlySet<PortalPathShape>>> = {
  GET: new Set<PortalPathShape>(["collection", "resource", "profile", "availability"]),
  POST: new Set<PortalPathShape>(["booking"]),
  PUT: new Set<PortalPathShape>(["profile"]),
};

/**
 * The exact query keys the availability read accepts, in canonical forward
 * order. Every other key is out of contract and the request is refused.
 */
const AVAILABILITY_QUERY_KEYS = ["date", "durationMinutes", "stepMinutes"] as const;

/**
 * Classifies validated segments into a known portal path shape, or `null` when
 * the path is not part of the API surface at all. Method-independent, so the
 * caller can tell "unknown path" apart from "known path, wrong method".
 */
function portalPathShape(segments: readonly string[]): PortalPathShape | null {
  if (segments.length === 1) {
    if (PORTAL_COLLECTIONS.has(segments[0])) {
      return "collection";
    }
    if (segments[0] === "profile") {
      return "profile";
    }
    return segments[0] === "availability" ? "availability" : null;
  }
  if (segments.length === 2) {
    return PORTAL_RESOURCE_COLLECTIONS.has(segments[0]) && UUID_PATTERN.test(segments[1])
      ? "resource"
      : null;
  }
  if (segments.length === 3) {
    return segments[0] === "pets" && UUID_PATTERN.test(segments[1]) && segments[2] === "bookings"
      ? "booking"
      : null;
  }
  return null;
}

/** Uniform not-found: the portal boundary never reveals whether a path exists. */
function notFound(): NextResponse {
  return NextResponse.json(
    { error: { code: "NOT_FOUND", message: "Portal route was not found." } },
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
      error: { code: "METHOD_NOT_ALLOWED", message: "Portal route does not support this method." },
    },
    { status: 405 }
  );
}

/**
 * Splits the request path into validated portal segments, or returns null when
 * the request must be rejected before any upstream call. Shape validity is
 * resolved separately by `portalPathShape`, so a known path reached with the
 * wrong method is not conflated with an unknown path.
 */
function resolvePortalSegments(request: NextRequest): string[] | null {
  const { pathname } = request.nextUrl;
  if (pathname !== WEB_PORTAL_PREFIX && !pathname.startsWith(`${WEB_PORTAL_PREFIX}/`)) {
    return null;
  }

  const raw = pathname.slice(WEB_PORTAL_PREFIX.length).replace(/^\/+/, "");
  if (raw.length === 0) {
    return null;
  }
  // A percent-encoded segment could decode to something else upstream; reject.
  if (raw.includes("%")) {
    return null;
  }

  const segments = raw.split("/");
  if (segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")) {
    return null;
  }
  return segments;
}

/**
 * Rebuilds the availability query string from the allowlist, or returns null
 * when any requested key is out of contract. Duplicate values collapse to the
 * first occurrence because the string is rebuilt from the allowlist rather than
 * forwarded verbatim.
 */
function resolveAvailabilityQuery(search: string): string | null {
  const params = new URLSearchParams(search);
  for (const key of params.keys()) {
    if (!(AVAILABILITY_QUERY_KEYS as readonly string[]).includes(key)) {
      return null;
    }
  }
  const forwarded = new URLSearchParams();
  for (const key of AVAILABILITY_QUERY_KEYS) {
    const value = params.get(key);
    if (value !== null) {
      forwarded.set(key, value);
    }
  }
  const serialized = forwarded.toString();
  return serialized.length > 0 ? `?${serialized}` : "";
}

/**
 * RequestInit with the `duplex` field required to stream a request body.
 * `duplex` is part of the fetch spec but is absent from the DOM lib types.
 */
type StreamingRequestInit = RequestInit & { duplex?: "half" };

/**
 * Forwards an allowlisted portal request to the private NestJS `/portal/*` API.
 *
 * Browser headers are NOT copied: only the portal session cookie (read
 * server-side, never from the client) and `x-request-id` cross the boundary.
 * The staff cookie is never read here, so a staff session cannot reach the
 * portal API through this proxy. For `POST`/`PUT` the body is piped as the
 * caller's raw `ReadableStream` under the JSON media type instead of being
 * buffered, so the API's Zod validation sees the exact input. The upstream
 * status, error envelope, `content-type` and `x-request-id` are preserved and
 * the response body is streamed back.
 */
async function proxyPortalRequest(
  request: NextRequest,
  method: PortalMethod
): Promise<NextResponse> {
  const segments = resolvePortalSegments(request);
  if (!segments) {
    return notFound();
  }
  const shape = portalPathShape(segments);
  if (!shape) {
    return notFound();
  }

  // Query policy: only the availability shape accepts a query, and only its
  // three contract keys. Everything else is refused before the method check so
  // a query can never ride along on another route.
  const { search } = request.nextUrl;
  let query = "";
  if (search.length > 0) {
    if (shape !== "availability") {
      return notFound();
    }
    const availabilityQuery = resolveAvailabilityQuery(search);
    if (availabilityQuery === null) {
      return notFound();
    }
    query = availabilityQuery;
  }

  if (!ALLOWED_PORTAL_ROUTES[method].has(shape)) {
    return methodNotAllowed();
  }

  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? DEFAULT_API_URL;
  const cookieStore = await cookies();
  const token = cookieStore.get(PORTAL_SESSION_COOKIE)?.value;

  const headers: Record<string, string> = {};
  if (token) {
    headers.cookie = `${PORTAL_SESSION_COOKIE}=${token}`;
  }
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
    // undici requires `duplex: "half"` whenever the body is a stream, so a GET
    // keeps the exact initialization it had before this boundary widened.
    ...(hasBody ? { duplex: "half" as const } : {}),
  };

  const response = await fetch(`${apiUrl}${API_PORTAL_PREFIX}/${segments.join("/")}${query}`, init);

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
  return proxyPortalRequest(request, "GET");
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  return proxyPortalRequest(request, "POST");
}

export async function PUT(request: NextRequest): Promise<NextResponse> {
  return proxyPortalRequest(request, "PUT");
}
