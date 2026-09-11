import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";

export const dynamic = "force-dynamic";

const DEFAULT_API_URL = "http://localhost:3001";

/**
 * RequestInit with the `duplex` field required to stream a request body.
 * `duplex` is part of the fetch spec but is absent from the DOM lib types.
 */
type StreamingRequestInit = RequestInit & { duplex?: "half" };

/**
 * Proxies staff patient API calls to the private NestJS patients surface.
 *
 * The optional catch-all handles both `/api/patients` (root) and nested routes
 * such as `/api/patients/:id/deactivate` or
 * `/api/patients/:patientId/guardians/:id/primary`.
 *
 * Browser headers are forwarded through a strict allowlist: only the
 * authenticated session cookie (read server-side, never from the browser) and
 * `x-request-id` cross the boundary. For mutating verbs the request body is
 * piped to the API as the caller's raw `ReadableStream` instead of being
 * buffered, so the API's Zod validation sees the exact input; the proxy
 * declares the JSON media type itself because the patients surface is
 * JSON-only and content-type is not a forwarded header. The upstream response
 * status, error envelope, `content-type`, and `x-request-id` are preserved and
 * the upstream body is streamed back to the caller.
 */
async function proxyPatientRequest(
  request: NextRequest,
  method: "GET" | "POST" | "PUT"
): Promise<NextResponse> {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? DEFAULT_API_URL;
  const cookieStore = await cookies();

  const segments = request.nextUrl.pathname.replace(/^\/api\/patients\/?/, "");
  const upstreamPath = segments.length > 0 ? `/patients/${segments}` : "/patients";

  const headers: Record<string, string> = {
    cookie: cookieStore.toString(),
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
    // undici requires `duplex: "half"` whenever the body is a stream.
    duplex: "half",
  };

  const response = await fetch(`${apiUrl}${upstreamPath}`, init);

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
  return proxyPatientRequest(request, "GET");
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  return proxyPatientRequest(request, "POST");
}

export async function PUT(request: NextRequest): Promise<NextResponse> {
  return proxyPatientRequest(request, "PUT");
}
