import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";

export const dynamic = "force-dynamic";

const DEFAULT_API_URL = "http://localhost:3001";

interface ProxyOptions {
  readonly method: "GET" | "PUT";
  readonly request: NextRequest;
}

async function proxyToBrandingCurrent({ method, request }: ProxyOptions): Promise<NextResponse> {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? DEFAULT_API_URL;
  const cookieStore = await cookies();

  const headers: Record<string, string> = {
    cookie: cookieStore.toString(),
  };

  const requestId = request.headers.get("x-request-id");
  if (requestId) {
    headers["x-request-id"] = requestId;
  }

  let body: BodyInit | undefined;
  if (method === "PUT") {
    const contentType = request.headers.get("content-type");
    if (contentType) {
      headers["content-type"] = contentType;
    }
    body = await request.text();
  }

  const response = await fetch(`${apiUrl}/branding/current`, {
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

/**
 * Proxies the staff session cookie to the private branding read endpoint.
 *
 * Keeping the call inside the web app avoids a broad CORS opening on the API
 * for a staff-authenticated route and reuses the existing health-route proxy
 * pattern.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  return proxyToBrandingCurrent({ method: "GET", request });
}

/**
 * Proxies PUT branding updates to the private mutation endpoint.
 */
export async function PUT(request: NextRequest): Promise<NextResponse> {
  return proxyToBrandingCurrent({ method: "PUT", request });
}
