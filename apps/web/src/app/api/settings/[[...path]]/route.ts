import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { STAFF_SESSION_COOKIE } from "@/lib/session-cookie";

export const dynamic = "force-dynamic";

const DEFAULT_API_URL = "http://localhost:3001";

const SETTINGS_PATH_PREFIX = "/api/settings";

/**
 * Namespaces the staff shell is allowed to reach through this proxy.
 *
 * This allowlist is the proxy's security boundary: the typed tenant-settings
 * service exposes many namespaces, but the browser surface only needs the
 * `scheduling` namespace (availability and one-off blocks). A namespace that is
 * not listed here — or any traversal/encoded segment — can never reach the
 * upstream URL.
 */
const SETTINGS_NAMESPACES: readonly string[] = ["scheduling"];

type SettingsMethod = "GET" | "PUT";

type UpstreamResolution =
  { readonly ok: true; readonly path: string } | { readonly ok: false; readonly status: 400 | 404 };

/**
 * Resolves the browser pathname to a safe upstream settings path.
 *
 * `/api/settings/scheduling` maps to the upstream `/settings/scheduling`. An
 * empty remainder is a malformed request (400); a namespace outside the
 * allowlist is reported as absent (404) so the proxy never reveals which
 * namespaces exist upstream.
 */
function resolveUpstreamPath(pathname: string): UpstreamResolution {
  const remainder = pathname.startsWith(SETTINGS_PATH_PREFIX)
    ? pathname.slice(SETTINGS_PATH_PREFIX.length)
    : "";
  if (remainder.includes("%")) {
    return { ok: false, status: 400 };
  }

  const segments = remainder.split("/").filter((segment) => segment.length > 0);
  if (segments.length !== 1) {
    return { ok: false, status: segments.length === 0 ? 400 : 404 };
  }

  const [namespace] = segments;
  if (namespace === undefined || !SETTINGS_NAMESPACES.includes(namespace)) {
    return { ok: false, status: 404 };
  }

  return { ok: true, path: `/settings/${encodeURIComponent(namespace)}` };
}

/** Stable JSON rejection envelope; no upstream call is made for a rejected path. */
function rejectionResponse(status: 400 | 404): NextResponse {
  const error =
    status === 400
      ? { code: "VALIDATION_FAILED", message: "Invalid settings request path." }
      : { code: "NOT_FOUND", message: "Settings namespace not found." };
  return new NextResponse(JSON.stringify({ error }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/**
 * RequestInit with the `duplex` field required to stream a request body.
 * `duplex` is part of the fetch spec but is absent from the DOM lib types.
 */
type StreamingRequestInit = RequestInit & { duplex?: "half" };

/**
 * Proxies staff typed-settings calls to the private NestJS settings surface.
 *
 * Reads require an authenticated session; writes are authenticated-only at the
 * proxy and the API enforces the namespace's registry permission key. Browser
 * headers cross through a strict allowlist: only the authenticated session
 * cookie (read server-side by name) and `x-request-id`. The `PUT` body is piped
 * as the caller's raw stream so the API sees the exact patch. Upstream status,
 * error envelope, `content-type` and `x-request-id` are preserved.
 */
async function proxySettingsRequest(
  request: NextRequest,
  method: SettingsMethod
): Promise<NextResponse> {
  const resolution = resolveUpstreamPath(request.nextUrl.pathname);
  if (!resolution.ok) {
    return rejectionResponse(resolution.status);
  }

  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? DEFAULT_API_URL;
  const cookieStore = await cookies();

  const headers: Record<string, string> = {};

  // Forward only the staff session cookie; unrelated cookies stay in the
  // browser instead of leaking into the private API request.
  const session = cookieStore.get(STAFF_SESSION_COOKIE);
  if (session !== undefined) {
    headers.cookie = `${STAFF_SESSION_COOKIE}=${session.value}`;
  }

  const requestId = request.headers.get("x-request-id");
  if (requestId) {
    headers["x-request-id"] = requestId;
  }

  const hasBody = method === "PUT";
  if (hasBody) {
    headers["content-type"] = "application/json";
  }

  const init: StreamingRequestInit = {
    method,
    headers,
    body: hasBody ? (request.body ?? undefined) : undefined,
    cache: "no-store",
    // undici requires `duplex: "half"` whenever the body is a stream.
    duplex: "half",
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
  return proxySettingsRequest(request, "GET");
}

export async function PUT(request: NextRequest): Promise<NextResponse> {
  return proxySettingsRequest(request, "PUT");
}
