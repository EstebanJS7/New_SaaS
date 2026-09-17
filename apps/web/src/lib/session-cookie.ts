/**
 * First-party session cookie names.
 *
 * Each value mirrors its API twin (`STAFF_SESSION_COOKIE` in
 * `apps/api/src/auth/session-cookie.ts`, `PORTAL_SESSION_COOKIE` in
 * `apps/api/src/portal/portal-session-cookie.ts`). The web proxy boundaries
 * must forward exactly the matching cookie to the private API — never the
 * browser's full cookie jar — so unrelated cookies (analytics, preferences,
 * third-party) never cross into the backend request.
 *
 * The two families are deliberately distinct: the staff proxy forwards only
 * `ns_staff_session` and the portal proxy only `ns_portal_session`, so a
 * portal cookie can never ride a staff request or vice versa.
 */
export const STAFF_SESSION_COOKIE = "ns_staff_session";

/** Portal session cookie; read ONLY by the portal proxy. */
export const PORTAL_SESSION_COOKIE = "ns_portal_session";
