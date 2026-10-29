import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { STAFF_SESSION_COOKIE } from "@/lib/session-cookie";
export const dynamic = "force-dynamic";
const privateHeaders = { "cache-control": "private, no-store" };
function reject(status: number, code: string, message: string): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status, headers: privateHeaders });
}
/** Dedicated read-only route; the existing customer CRUD proxy stays unchanged. */
export async function POST(request: NextRequest): Promise<NextResponse> {
  if (request.nextUrl.search)
    return reject(400, "VALIDATION_FAILED", "Invalid customer search input.");
  const session = (await cookies()).get(STAFF_SESSION_COOKIE);
  if (!session?.value) return reject(401, "UNAUTHENTICATED", "Authentication required.");
  const body = await request.text();
  let input: unknown;
  try {
    input = JSON.parse(body);
  } catch {
    return reject(400, "VALIDATION_FAILED", "Invalid customer search input.");
  }
  if (
    typeof input !== "object" ||
    input === null ||
    Array.isArray(input) ||
    Object.keys(input).some((key) => !["q", "page", "status", "kind", "sort"].includes(key))
  )
    return reject(400, "VALIDATION_FAILED", "Invalid customer search input.");
  const headers: Record<string, string> = {
    cookie: `${STAFF_SESSION_COOKIE}=${session.value}`,
    "content-type": "application/json",
  };
  const requestId = request.headers.get("x-request-id");
  if (requestId) headers["x-request-id"] = requestId;
  const response = await fetch(
    `${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001"}/customers/search`,
    {
      method: "POST",
      headers,
      body,
      cache: "no-store",
      signal: request.signal,
    }
  );
  const responseHeaders: Record<string, string> = {
    ...privateHeaders,
    "content-type": response.headers.get("content-type") ?? "application/json",
  };
  const responseRequestId = response.headers.get("x-request-id");
  if (responseRequestId) responseHeaders["x-request-id"] = responseRequestId;
  return new NextResponse(response.body, { status: response.status, headers: responseHeaders });
}
