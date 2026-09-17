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
 * Read-only UUID shape accepted for a nested portal resource. Kept as a plain
 * pattern (no dependency) so the boundary rejects anything that is not a plain
 * identifier before it can reach the API.
 */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Literal portal collections the proxy may forward (no nested id). */
const PORTAL_COLLECTIONS: ReadonlySet<string> = new Set(["me", "pets", "appointments"]);

/** Collections that may be followed by exactly one UUID path segment. */
const PORTAL_RESOURCE_COLLECTIONS: ReadonlySet<string> = new Set(["pets", "appointments"]);

/**
 * Strict allowlist for the portal proxy (EPIC-08 WU3).
 *
 * The proxy is the ONLY browser-facing entrypoint to the private portal API, so
 * it must not become a general-purpose tunnel. Only the read surface WU3 ships
 * is reachable: `/portal/me`, `/portal/pets[/:uuid]` and
 * `/portal/appointments[/:uuid]`. Booking/profile mutations, invoices,
 * documents, files and notifications are deliberately absent, so a request for
 * any of them is rejected here instead of being smuggled upstream.
 *
 * Rejections: unknown paths, any query string, percent-encoded segments
 * (which could hide a different upstream path), empty/`.`/`..` segments, and
 * nested ids that are not UUIDs. Nothing else from the browser crosses the
 * boundary — only the portal cookie and `x-request-id` are forwarded.
 */
function isAllowedPortalPath(segments: readonly string[]): boolean {
  if (segments.length === 1) {
    return PORTAL_COLLECTIONS.has(segments[0]);
  }
  if (segments.length === 2) {
    return PORTAL_RESOURCE_COLLECTIONS.has(segments[0]) && UUID_PATTERN.test(segments[1]);
  }
  return false;
}

/** Uniform rejection: the portal boundary never reveals whether a path exists. */
function notFound(): NextResponse {
  return NextResponse.json(
    { error: { code: "NOT_FOUND", message: "Portal route was not found." } },
    { status: 404 }
  );
}

/**
 * Splits the request path into validated portal segments, or returns null when
 * the request must be rejected before any upstream call.
 */
function resolvePortalSegments(request: NextRequest): string[] | null {
  const { pathname, search } = request.nextUrl;
  // Portal reads take no query parameters; anything present is out of contract.
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
  return isAllowedPortalPath(segments) ? segments : null;
}

/**
 * Forwards an allowlisted portal READ to the private NestJS `/portal/*` API.
 *
 * Browser headers are NOT copied: only the portal session cookie (read
 * server-side, never from the client) and `x-request-id` cross the boundary.
 * The staff cookie is never read here, so a staff session cannot reach the
 * portal API through this proxy. The upstream status, error envelope,
 * `content-type` and `x-request-id` are preserved and the body is streamed back.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const segments = resolvePortalSegments(request);
  if (!segments) {
    return notFound();
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

  const response = await fetch(`${apiUrl}${API_PORTAL_PREFIX}/${segments.join("/")}`, {
    method: "GET",
    headers,
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
