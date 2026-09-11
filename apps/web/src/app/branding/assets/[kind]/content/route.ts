import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";

export const dynamic = "force-dynamic";

const DEFAULT_API_URL = "http://localhost:3001";

const ALLOWED_KINDS = new Set(["logoLight", "logoDark", "favicon"]);

function isAllowedKind(kind: string): kind is "logoLight" | "logoDark" | "favicon" {
  return ALLOWED_KINDS.has(kind);
}

/**
 * Secure staff branding-asset content proxy.
 *
 * The private API signs staff asset URLs as relative paths against the staff
 * web origin (`/branding/assets/:kind/content?token=...`). Browsers can only
 * load those bytes if the web app proxies the request to the protected API
 * content route while forwarding the staff session cookie, so the API can
 * resolve the request-context tenant and verify the token.
 *
 * Only GET is exposed, only the three known asset kinds are accepted, and the
 * token is required. The upstream status, content type, cache-control, and
 * `x-request-id` are preserved; storage keys, buckets, and provider paths never
 * reach the client.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ kind: string }> }
): Promise<NextResponse> {
  const { kind } = await params;
  if (!isAllowedKind(kind)) {
    return NextResponse.json(
      { error: { code: "VALIDATION_FAILED", message: "Invalid asset kind." } },
      { status: 400 }
    );
  }

  const token = request.nextUrl.searchParams.get("token");
  if (!token) {
    return NextResponse.json(
      { error: { code: "VALIDATION_FAILED", message: "Missing asset URL token." } },
      { status: 400 }
    );
  }

  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? DEFAULT_API_URL;
  const cookieStore = await cookies();

  const headers: Record<string, string> = {
    cookie: cookieStore.toString(),
  };

  const requestId = request.headers.get("x-request-id");
  if (requestId) {
    headers["x-request-id"] = requestId;
  }

  const response = await fetch(
    `${apiUrl}/branding/assets/${kind}/content?token=${encodeURIComponent(token)}`,
    {
      method: "GET",
      headers,
      cache: "no-store",
    }
  );

  const responseHeaders: Record<string, string> = {
    "content-type":
      response.headers.get("content-type") ??
      (response.ok ? "application/octet-stream" : "application/json"),
  };

  const cacheControl = response.headers.get("cache-control");
  if (cacheControl) {
    responseHeaders["cache-control"] = cacheControl;
  }

  const responseRequestId = response.headers.get("x-request-id");
  if (responseRequestId) {
    responseHeaders["x-request-id"] = responseRequestId;
  }

  const body = response.ok ? await response.arrayBuffer() : await response.text();
  return new NextResponse(body, {
    status: response.status,
    headers: responseHeaders,
  });
}
