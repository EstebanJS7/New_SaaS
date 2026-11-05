import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { resolveBranchesPath } from "@/lib/branches-proxy-path";

export const dynamic = "force-dynamic";

const DEFAULT_API_URL = "http://localhost:3001";

async function proxy(request: NextRequest, method: "GET" | "POST" | "PUT"): Promise<NextResponse> {
  const upstreamPath = resolveBranchesPath(request.nextUrl.pathname, method);
  if (upstreamPath === null) {
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: "Ruta no disponible." } },
      { status: 404 }
    );
  }

  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? DEFAULT_API_URL;
  const cookieStore = await cookies();
  const headers: Record<string, string> = { cookie: cookieStore.toString() };

  const requestId = request.headers.get("x-request-id");
  if (requestId) headers["x-request-id"] = requestId;

  let body: string | undefined;
  if (method !== "GET") {
    headers["content-type"] = request.headers.get("content-type") ?? "application/json";
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
  if (responseRequestId) responseHeaders["x-request-id"] = responseRequestId;

  return new NextResponse(await response.text(), {
    status: response.status,
    headers: responseHeaders,
  });
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  return proxy(request, "GET");
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  return proxy(request, "POST");
}

/** MB-001: only `PUT /:id` resolves (see `resolveBranchesPath`). */
export async function PUT(request: NextRequest): Promise<NextResponse> {
  return proxy(request, "PUT");
}
