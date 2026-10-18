import { NextRequest, NextResponse } from "next/server";

/**
 * The PUBLIC auth BFF (DAT-007, [[TD-048]]).
 *
 * **It forwards no session, deliberately.** The routes it serves are the two recovery
 * endpoints, which are public by necessity — the caller is locked out, so there is no
 * session to forward — and the API authenticates them by the token in the body. Every
 * other BFF in this app attaches the staff cookie; this one must not, because attaching
 * it would send an unrelated session's authority to a route that has no use for it and
 * every reason not to receive it.
 *
 * Only the recovery route is allowlisted. It is a PROXY of one shape, not a general
 * passthrough to `/auth/*`: `login` sets a cookie with its own hardening, `logout`
 * revokes a session, and neither should become reachable through a proxy that forwards
 * no credentials at all.
 */
export const dynamic = "force-dynamic";
const DEFAULT_API_URL = "http://localhost:3001";
const WEB_AUTH_PREFIX = "/api/auth";
const API_AUTH_PREFIX = "/auth";
/** The one route this proxy serves. */
const ALLOWED_PATH = "password-reset";
/** The only body keys the API accepts. */
const ALLOWED_BODY_KEYS: readonly string[] = ["token", "password"];

function error(code: string, message: string, status: number): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}
const notFound = () => error("NOT_FOUND", "Auth route was not found.", 404);

export async function POST(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;
  if (pathname !== `${WEB_AUTH_PREFIX}/${ALLOWED_PATH}`) return notFound();

  const text = await request.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    return error("VALIDATION_FAILED", "Invalid auth request body.", 400);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return error("VALIDATION_FAILED", "Invalid auth request body.", 400);
  }
  const body = parsed as Record<string, unknown>;
  // The keys are allowlisted here as well as in the API, so a caller cannot use this
  // proxy to probe fields the API would ignore.
  if (Object.keys(body).some((key) => !ALLOWED_BODY_KEYS.includes(key))) {
    return error("VALIDATION_FAILED", "Invalid auth request body.", 400);
  }

  const response = await fetch(
    `${process.env.NEXT_PUBLIC_API_URL ?? DEFAULT_API_URL}${API_AUTH_PREFIX}/${ALLOWED_PATH}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: text,
      cache: "no-store",
    }
  );
  const responseHeaders: Record<string, string> = {
    "content-type": response.headers.get("content-type") ?? "application/json",
  };
  const requestId = response.headers.get("x-request-id");
  if (requestId) responseHeaders["x-request-id"] = requestId;
  // The API's status passes through unchanged, including its 401: the form's whole job
  // is to show that refusal, and rewriting it here would hide the one answer the caller
  // needs.
  return new NextResponse(response.body, { status: response.status, headers: responseHeaders });
}
