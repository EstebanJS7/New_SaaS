import type { AuthConfig } from "../auth/auth.config.js";

/**
 * First-party PORTAL session cookie (EPIC-08 D1/D2).
 *
 * Deliberately a DIFFERENT cookie name from the staff session: the two session
 * families never share a cookie, so neither can ever authorize the other's
 * routes. The portal cookie is read ONLY by the PortalAuthGuard and the staff
 * cookie ONLY by the AuthGuard.
 */
export const PORTAL_SESSION_COOKIE = "ns_portal_session";

/**
 * Same transport baseline as the staff session cookie (see
 * `staffSessionCookieOptions`): HttpOnly + SameSite=Lax always, Secure outside
 * development. No Max-Age — the SERVER's idle/absolute TTLs are authoritative
 * and any replay after expiry simply fails lookup with 401.
 */
export function portalSessionCookieOptions(config: Pick<AuthConfig, "cookieSecure">): {
  httpOnly: true;
  sameSite: "lax";
  secure: boolean;
  path: "/";
} {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: config.cookieSecure,
    path: "/",
  };
}
