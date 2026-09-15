/**
 * First-party staff session cookie name.
 *
 * The value mirrors `STAFF_SESSION_COOKIE` in
 * `apps/api/src/auth/session-cookie.ts`. The web proxy boundary must forward
 * exactly this cookie to the private API — never the browser's full cookie jar —
 * so unrelated cookies (analytics, preferences, third-party) never cross into
 * the backend request.
 */
export const STAFF_SESSION_COOKIE = "ns_staff_session";
