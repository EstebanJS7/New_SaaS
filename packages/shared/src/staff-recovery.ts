import { createHash, randomBytes } from "node:crypto";

/**
 * The staff password-recovery token's primitives (DAT-007).
 *
 * They live in the shared kernel because **two deployables must agree on them**: the
 * API's request path and the worker's send path. The token is minted at send time
 * (the issuance model DAT-007 chose) and verified by the API when the reset is
 * submitted, so the entropy, the digest and the lifetime are one contract with two
 * implementations only if they are copied — and a copy is how the two would drift.
 *
 * **SHA-256, not argon2.** argon2 exists to make a LOW-entropy, human-chosen password
 * expensive to guess. This token is 256 bits from `randomBytes`: there is nothing to
 * guess, and hashing it with argon2 would only make the send path slow for no gain.
 * `StaffSession` reached the same conclusion for the same reason.
 */

/**
 * How long a delivered token stays usable.
 *
 * Thirty minutes sits between the two failure modes it separates: long enough that a
 * person can find the mail, open it on another device and choose a password without
 * racing a clock, and short enough that a link left in a shared inbox is worthless by
 * the time anyone else reads it. The clock starts when the message is SENT, because
 * that is when the token is minted — an SMTP delay does not eat the user's window.
 */
export const PASSWORD_RESET_TOKEN_TTL_MS = 30 * 60 * 1000;

/** 32 random bytes, base64url — the `generateSessionToken` convention. */
export function generatePasswordResetToken(): string {
  return randomBytes(32).toString("base64url");
}

/** The digest the table stores. Lookup always happens by digest, never by token. */
export function hashPasswordResetToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/**
 * The link a recovery message carries.
 *
 * `baseUrl` is deployment configuration rather than a constant: the app's origin
 * differs per environment, and a link that points at the wrong host is a link that
 * leaks a live token to whoever owns that host.
 */
export function staffRecoveryUrl(baseUrl: string, token: string): string {
  const trimmed = baseUrl.replace(/\/+$/, "");
  return `${trimmed}/reset-password?token=${encodeURIComponent(token)}`;
}
