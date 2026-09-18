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
type PortalPathShape = "collection" | "resource" | "profile" | "booking";

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
 * Rejections: unknown paths, any query string, percent-encoded segments
 * (which could hide a different upstream path), empty/`.`/`..` segments, nested
 * ids that are not UUIDs, and a known path reached with a method it does not
 * support. Nothing else from the browser crosses the boundary — only the portal
 * cookie and `x-request-id` are forwarded.
 */
const ALLOWED_PORTAL_ROUTES: Readonly<Record<PortalMethod, ReadonlySet<PortalPathShape>>> = {
  GET: new Set<PortalPathShape>(["collection", "resource", "profile"]),
  POST: new Set<PortalPathShape>(["booking"]),
  PUT: new Set<PortalPathShape>(["profile"]),
};

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
    return segments[0] === "profile" ? "profile" : null;
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
  const { pathname, search } = request.nextUrl;
  // Portal routes take no query parameters; anything present is out of contract.
  if (search.length > 0) {
    return null;
  }
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

  const response = await fetch(`${apiUrl}${API_PORTAL_PREFIX}/${segments.join("/")}`, init);

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
