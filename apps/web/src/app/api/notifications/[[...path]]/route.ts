import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { STAFF_SESSION_COOKIE } from "@/lib/session-cookie";

/**
 * The notification-delivery BFF (EPIC-17 [[NOTIF-004]]).
 *
 * **GET only.** The surface it serves is a read surface with no command route, so
 * there is no body to validate and no write verb to allowlist: a POST reaching here
 * is a not-found, not a validation failure.
 *
 * The query is re-allowlisted here (`status`, `channel`, `limit`) so a caller cannot
 * smuggle an unlisted key past the client, and every path segment is re-encoded
 * before it is forwarded.
 */
export const dynamic = "force-dynamic";
const DEFAULT_API_URL = "http://localhost:3001";
const WEB_NOTIFICATIONS_PREFIX = "/api/notifications";
/**
 * The API's own prefix, kept separate from the WEB one: the browser-facing path is
 * namespaced under `/api`, while the API's controller is mounted at `/notifications`
 * (pinned in the route-contract inventory). Dropping the prefix would forward
 * `/deliveries`, which no route serves.
 */
const API_NOTIFICATIONS_PREFIX = "/notifications";
type NotificationPathShape = "deliveryList" | "deliveryItem";
const NOTIFICATION_QUERY_KEYS: Readonly<Record<NotificationPathShape, readonly string[]>> = {
  deliveryList: ["status", "channel", "sourceType", "sourceId", "limit"],
  deliveryItem: [],
};

function error(code: string, message: string, status: number): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}
const notFound = () => error("NOT_FOUND", "Notification route was not found.", 404);
const invalidPath = () => error("VALIDATION_FAILED", "Invalid notification request path.", 400);
/**
 * A query key outside the allowlist ([[TD-047]], review R3-001).
 *
 * This used to answer `404`, matching the fiscal BFF's precedent, and the refusal
 * itself is unchanged: the key is never forwarded. What changed is the vocabulary, so
 * that the two layers of one request agree — the API behind this proxy answers `400
 * VALIDATION_FAILED` for the same class of mistake, and a caller who mistypes a filter
 * should not be told the route does not exist. The message deliberately does NOT name
 * the accepted keys: that would document the contract to whoever shapes requests.
 *
 * The fiscal BFF still answers `404` here; that divergence is pre-existing and recorded
 * in [[TD-047]] rather than fixed from this unit.
 */
const unsupportedQuery = () =>
  error("VALIDATION_FAILED", "This notification query is not supported.", 400);

function deliveryPathShape(segments: readonly string[]): NotificationPathShape | null {
  if (segments.length === 1 && segments[0] === "deliveries") return "deliveryList";
  if (segments.length === 2 && segments[0] === "deliveries") return "deliveryItem";
  return null;
}

type PathResolution = { ok: true; path: string } | { ok: false; response: NextResponse };

function resolveDeliveryPath(request: NextRequest): PathResolution {
  const { pathname } = request.nextUrl;
  if (pathname !== WEB_NOTIFICATIONS_PREFIX && !pathname.startsWith(`${WEB_NOTIFICATIONS_PREFIX}/`))
    return { ok: false, response: notFound() };
  const remainder = pathname.slice(WEB_NOTIFICATIONS_PREFIX.length);
  if (remainder.includes("%")) return { ok: false, response: invalidPath() };
  const segments = remainder.length === 0 ? [] : remainder.slice(1).split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === ".."))
    return { ok: false, response: invalidPath() };
  const shape = deliveryPathShape(segments);
  if (shape === null) return { ok: false, response: notFound() };

  const params = request.nextUrl.searchParams;
  if ([...params.keys()].some((key) => !NOTIFICATION_QUERY_KEYS[shape].includes(key)))
    return { ok: false, response: unsupportedQuery() };
  const forwarded = new URLSearchParams();
  for (const key of NOTIFICATION_QUERY_KEYS[shape]) {
    const value = params.get(key);
    if (value !== null && value.length > 0) forwarded.set(key, value);
  }
  const query = forwarded.toString();
  return {
    ok: true,
    path: `${API_NOTIFICATIONS_PREFIX}/${segments.map(encodeURIComponent).join("/")}${query ? `?${query}` : ""}`,
  };
}

async function proxyDeliveryRead(request: NextRequest): Promise<NextResponse> {
  const resolution = resolveDeliveryPath(request);
  if (!resolution.ok) return resolution.response;
  const cookieStore = await cookies();
  const session = cookieStore.get(STAFF_SESSION_COOKIE);
  if (session === undefined || session.value.length === 0)
    return error("UNAUTHENTICATED", "Authentication required.", 401);
  const headers: Record<string, string> = { cookie: `${STAFF_SESSION_COOKIE}=${session.value}` };
  const requestId = request.headers.get("x-request-id");
  if (requestId) headers["x-request-id"] = requestId;
  const response = await fetch(
    `${process.env.NEXT_PUBLIC_API_URL ?? DEFAULT_API_URL}${resolution.path}`,
    { method: "GET", headers, cache: "no-store" }
  );
  const responseHeaders: Record<string, string> = {
    "content-type": response.headers.get("content-type") ?? "application/json",
  };
  const responseRequestId = response.headers.get("x-request-id");
  if (responseRequestId) responseHeaders["x-request-id"] = responseRequestId;
  return new NextResponse(response.body, { status: response.status, headers: responseHeaders });
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  return proxyDeliveryRead(request);
}
