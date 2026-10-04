import { randomBytes } from "node:crypto";

/**
 * Opaque secret-key factory. Keys are random 128-bit base64url strings with no
 * structure that would leak tenant, kind or purpose. They are identifiers, not
 * secrets: knowing a key name grants nothing without the master key and the
 * tenant scope.
 *
 * The short prefix keeps a key recognizable in an operator console without
 * exposing semantics.
 */
export function createOpaqueSecretKey(prefix: string): string {
  return `${prefix}_${randomBytes(16).toString("base64url")}`;
}

/** Prefixes used by the boundaries that own stored secrets. */
export const SECRET_KEY_PREFIXES = Object.freeze({
  fiscalSigningKey: "fsk",
});
