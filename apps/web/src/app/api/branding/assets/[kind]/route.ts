import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";

export const dynamic = "force-dynamic";

const DEFAULT_API_URL = "http://localhost:3001";

const ALLOWED_KINDS = new Set(["logoLight", "logoDark", "favicon"]);

function isAllowedKind(kind: string): kind is "logoLight" | "logoDark" | "favicon" {
  return ALLOWED_KINDS.has(kind);
}

/**
 * Proxies staff asset uploads to the private API multipart endpoint.
 *
 * The staff session cookie is forwarded so the API can resolve tenant,
 * permission, and entitlement context authoritatively.
 */
export async function POST(
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

  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? DEFAULT_API_URL;
  const cookieStore = await cookies();

  const headers: Record<string, string> = {
    cookie: cookieStore.toString(),
  };

  const requestId = request.headers.get("x-request-id");
  if (requestId) {
    headers["x-request-id"] = requestId;
  }

  const response = await fetch(`${apiUrl}/branding/assets/${kind}`, {
    method: "POST",
    headers,
    body: await request.formData(),
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
 * Proxies staff asset removal to the private API.
 */
export async function DELETE(
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

  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? DEFAULT_API_URL;
  const cookieStore = await cookies();

  const headers: Record<string, string> = {
    cookie: cookieStore.toString(),
  };

  const requestId = request.headers.get("x-request-id");
  if (requestId) {
    headers["x-request-id"] = requestId;
  }

  const response = await fetch(`${apiUrl}/branding/assets/${kind}`, {
    method: "DELETE",
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

  const responseBody = await response.text();
  return new NextResponse(responseBody, {
    status: response.status,
    headers: responseHeaders,
  });
}
