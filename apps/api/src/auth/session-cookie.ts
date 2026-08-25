import type { AuthConfig } from "./auth.config.js";

/** First-party staff session cookie (design D4). */
export const STAFF_SESSION_COOKIE = "ns_staff_session";

/**
 * Baseline cookie attributes for the staff session (transport security):
 * HttpOnly + SameSite=Lax always, Secure outside development. No Max-Age —
 * a browser session cookie; the SERVER's idle/absolute TTLs are authoritative
 * and any replay after expiry simply fails lookup with 401.
 */
export function staffSessionCookieOptions(config: Pick<AuthConfig, "cookieSecure">): {
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
