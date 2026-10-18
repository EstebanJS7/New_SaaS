import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { STAFF_SESSION_COOKIE } from "@/lib/session-cookie";

/**
 * The auth BFF ([[SHEL-001]], extending [[TD-048]]).
 *
 * It serves exactly three shapes, and they differ in the ONE way that matters: whether a
 * session crosses the hop.
 *
 * ```text
 * POST /api/auth/login            public, and RELAYS the API's Set-Cookie back
 * POST /api/auth/forgot-password  public, no session in either direction
 * POST /api/auth/password-reset   public, no session in either direction
 * ```
 *
 * `login` is the odd one and the reason this file is worth reading before changing: the
 * browser has no session yet (that is what it is asking for), so nothing is forwarded
 * inbound — and the API's `Set-Cookie` must be relayed outbound with its attributes intact.
 * The session cookie is `HttpOnly`, so this hop is the ONLY way it can reach the browser:
 * get it wrong and nobody can sign in, get it loose and the cookie is a bearer token in a
 * body or a log.
 *
 * The other two are session-less by necessity — the caller is locked out — and every OTHER
 * auth route is refused outright. `logout` in particular: it revokes a session, and a proxy
 * that forwards no credentials has no business reaching it.
 */
export const dynamic = "force-dynamic";
const DEFAULT_API_URL = "http://localhost:3001";
const WEB_AUTH_PREFIX = "/api/auth";
const API_AUTH_PREFIX = "/auth";

/** The body keys each route accepts, so the proxy cannot forward a field the API ignores. */
const BODY_KEYS: Readonly<Record<string, readonly string[]>> = {
  login: ["email", "password"],
  "forgot-password": ["email"],
  "password-reset": ["token", "password"],
};

/** The only header of the API's response this proxy passes on beyond content-type. */
const RELAYED_RESPONSE_HEADER = "set-cookie";

function error(code: string, message: string, status: number): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}
const notFound = () => error("NOT_FOUND", "Auth route was not found.", 404);

/** The route's name, or `null` when this proxy does not serve it. */
function allowedRoute(request: NextRequest): string | null {
  const { pathname } = request.nextUrl;
  if (!pathname.startsWith(`${WEB_AUTH_PREFIX}/`)) return null;
  const route = pathname.slice(WEB_AUTH_PREFIX.length + 1);
  return Object.hasOwn(BODY_KEYS, route) ? route : null;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const route = allowedRoute(request);
  if (route === null) return notFound();

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
  const allowed = BODY_KEYS[route] ?? [];
  if (Object.keys(parsed).some((key) => !allowed.includes(key))) {
    return error("VALIDATION_FAILED", "Invalid auth request body.", 400);
  }

  const headers: Record<string, string> = { "content-type": "application/json" };
  // Only the RECOVERY routes carry a session, and only when the caller has one: a locked-out
  // user asking for a reset from a signed-in browser should not have that session forwarded
  // to a route with no use for it. `login` forwards nothing at all.
  if (route !== "login") {
    const session = (await cookies()).get(STAFF_SESSION_COOKIE);
    if (session !== undefined && session.value.length > 0) {
      headers.cookie = `${STAFF_SESSION_COOKIE}=${session.value}`;
    }
  }

  const response = await fetch(
    `${process.env.NEXT_PUBLIC_API_URL ?? DEFAULT_API_URL}${API_AUTH_PREFIX}/${route}`,
    { method: "POST", headers, body: text, cache: "no-store" }
  );

  const responseHeaders: Record<string, string> = {
    "content-type": response.headers.get("content-type") ?? "application/json",
  };
  const requestId = response.headers.get("x-request-id");
  if (requestId) responseHeaders["x-request-id"] = requestId;

  // The relay, and the whole point of this file. Forwarded VERBATIM: the attributes
  // (`HttpOnly`, `Path`, `SameSite`, `Secure`) are the API's hardening decisions, and a
  // proxy that rebuilt the header could quietly drop one of them. Never read, never
  // rewritten, never logged.
  const setCookie = response.headers.get(RELAYED_RESPONSE_HEADER);
  if (setCookie !== null) responseHeaders[RELAYED_RESPONSE_HEADER] = setCookie;

  // The API's status passes through unchanged, including its 401 and its 429: the form's
  // whole job is to show that answer, and rewriting it here would hide it.
  return new NextResponse(response.body, { status: response.status, headers: responseHeaders });
}
