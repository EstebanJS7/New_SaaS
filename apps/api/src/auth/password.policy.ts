import { DomainError } from "@newsaas/shared";

/**
 * The staff password policy (DAT-007, [[TD-048]]).
 *
 * **It lives in the credential boundary rather than in an endpoint**, and that is the
 * decision this module exists to record: a rule enforced by one caller is a rule the
 * other callers do not have. `CredentialService.hash` applies it, so every path that
 * sets a password inherits it — today only the reset, tomorrow whatever else sets one.
 *
 * **Length, and nothing else.** The minimum is 8, the floor NIST SP 800-63B sets for a
 * password used alone, and there are deliberately **no composition rules**: requiring an
 * upper case, a digit and a symbol is explicitly discouraged by the same source, because
 * it pushes people toward `Password1!` and punishes the long passphrase that is actually
 * strong. Eight is the floor rather than a target — a longer phrase is always accepted.
 *
 * **What it does not do**, stated because a reader will assume a policy does more: it
 * cannot stop `aaaaaaaa`, and it does not consult a breached-password list. Both are
 * recorded in [[TD-048]]: the second needs a dependency and therefore an ADR, plus a
 * decision about what leaves the process.
 */
export const MIN_PASSWORD_LENGTH = 8;

/**
 * The ceiling, which is a bound rather than a policy: argon2 hashes the whole input, so
 * an unbounded field is a way to spend a server's CPU with one request. It mirrors the
 * login body's own bound, so a password that can be SET can always be TYPED.
 */
export const MAX_PASSWORD_LENGTH = 1024;

/** The one message, so a caller cannot describe the rule differently from the rule. */
export const PASSWORD_TOO_SHORT_MESSAGE = `The password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
export const PASSWORD_TOO_LONG_MESSAGE = `The password must be at most ${MAX_PASSWORD_LENGTH} characters.`;

/**
 * Refuses a password the policy rejects, or returns.
 *
 * A `DomainError` rather than a boolean: every caller of this boundary is a request
 * path, and both of them want the same `400 VALIDATION_FAILED` envelope with the same
 * message. A boolean would invite each caller to invent its own wording — which is how
 * one rule becomes two.
 */
export function assertPasswordAcceptable(password: unknown): asserts password is string {
  if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH) {
    throw new DomainError("VALIDATION_FAILED", PASSWORD_TOO_SHORT_MESSAGE);
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    throw new DomainError("VALIDATION_FAILED", PASSWORD_TOO_LONG_MESSAGE);
  }
}
