import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";

export const dynamic = "force-dynamic";

const DEFAULT_API_URL = "http://localhost:3001";

/**
 * Proxies staff patient API calls to the private NestJS patients surface.
 *
 * The optional catch-all handles both `/api/patients` (root) and nested routes
 * such as `/api/patients/:id/deactivate` or
 * `/api/patients/:patientId/guardians/:id/primary`.
 *
 * Browser headers are forwarded through a strict allowlist: only the
 * authenticated session cookie (read server-side, never from the browser) and
 * `x-request-id` cross the boundary. For mutating verbs the body is read as TEXT and
 * forwarded as a string (TD-050), so the API's Zod validation parses the caller's exact
 * JSON -- a string is not a re-serialization. The upstream response status, error envelope,
 * `content-type` and `x-request-id` are preserved and the upstream body is streamed back to
 * the caller.
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

  // THE BODY IS READ AS TEXT rather than piped as a stream (TD-050).
  //
  // The streamed form was this proxy's original choice and it was DELIBERATE -- clinical and
  // scheduling even had a test rejecting `request.text()` as "the regression under test" -- but
  // its rationale was never recorded, and the same pattern produced an unexplained 500 in the
  // portal proxy (TD-049: `expected non-null body source`, for a body the upstream handler read).
  // Every proxy written after EPIC-07 buffers, so the repo had already drifted this way; this
  // makes it one decision instead of two.
  //
  // A string is the same JSON rather than a re-serialization -- no whitespace or key order is
  // normalized -- so the API's Zod parses identical input.
  const bodyText = hasBody ? await request.text() : undefined;

  const init: RequestInit = {
    method,
    headers,
    body: bodyText,
    cache: "no-store",
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
