import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";

export const dynamic = "force-dynamic";

const DEFAULT_API_URL = "http://localhost:3001";

/**
 * Proxies staff customer API calls to the private NestJS customers surface.
 *
 * The optional catch-all handles both `/api/customers` (root) and nested routes
 * such as `/api/customers/:id/deactivate` or `/api/customers/:id/addresses`.
 * Only the authenticated session cookie and `x-request-id` are forwarded;
 * request bodies are streamed verbatim for mutating verbs.
 */
async function proxyCustomerRequest(
  request: NextRequest,
  method: "GET" | "POST" | "PUT"
): Promise<NextResponse> {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? DEFAULT_API_URL;
  const cookieStore = await cookies();

  const segments = request.nextUrl.pathname.replace(/^\/api\/customers\/?/, "");
  const upstreamPath = segments.length > 0 ? `/customers/${segments}` : "/customers";

  const headers: Record<string, string> = {
    cookie: cookieStore.toString(),
  };

  const requestId = request.headers.get("x-request-id");
  if (requestId) {
    headers["x-request-id"] = requestId;
  }

  let body: BodyInit | undefined;
  if (method === "POST" || method === "PUT") {
    const contentType = request.headers.get("content-type");
    if (contentType) {
      headers["content-type"] = contentType;
    }
    body = await request.text();
  }

  const response = await fetch(`${apiUrl}${upstreamPath}`, {
    method,
    headers,
    body,
    cache: "no-store",
  });

  const responseHeaders: Record<string, string> = {
    "content-type": response.headers.get("content-type") ?? "application/json",
  };

  const responseRequestId = response.headers.get("x-request-id");
  if (responseRequestId) {
    responseHeaders["x-request-id"] = responseRequestId;
  }

  const responseBody = await response.text();
  return new NextResponse(responseBody, {
    status: response.status,
    headers: responseHeaders,
  });
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  return proxyCustomerRequest(request, "GET");
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  return proxyCustomerRequest(request, "POST");
}

export async function PUT(request: NextRequest): Promise<NextResponse> {
  return proxyCustomerRequest(request, "PUT");
}
