/**
 * Tenant secret-material port.
 *
 * Only opaque keys cross this boundary: a caller hands in a key and gets a
 * value, and the store never learns what a secret means. `tenantId` is a
 * scoping dimension, not semantics — it exists so a bug in key composition
 * cannot become a cross-tenant read.
 *
 * A wrong tenant and an absent row are deliberately indistinguishable: both
 * produce `null` from `get`, so a caller cannot probe for another tenant's key
 * names.
 */

/** Injection token for the runtime SecretStore implementation. */
export const SECRET_STORE = Symbol("SECRET_STORE");

/** The persisted shape of one sealed secret. Ciphertext only, never plaintext. */
export interface SecretRecordRow {
  algorithm: string;
  keyVersion: number;
  wrappedKey: Uint8Array;
  wrapIv: Uint8Array;
  wrapAuthTag: Uint8Array;
  ciphertext: Uint8Array;
  iv: Uint8Array;
  authTag: Uint8Array;
}

/**
 * Minimal structural persistence surface the envelope driver needs.
 *
 * The application implements it over its own client — a Prisma transaction
 * client satisfies it structurally — so this package never imports one. The
 * driver passes a caller-supplied `tx` through untouched and never inspects it.
 */
export interface SecretRecordClient {
  readonly tenantSecret: {
    create(args: { data: SecretRecordRow & { tenantId: string; key: string } }): Promise<unknown>;
    findFirst(args: { where: { tenantId: string; key: string } }): Promise<SecretRecordRow | null>;
    deleteMany(args: { where: { tenantId: string; key: string } }): Promise<{ count: number }>;
  };
}

export interface SecretStorePutArgs {
  tenantId: string;
  key: string;
  value: string;
  /** Optional caller transaction; the store passes it through and never inspects it. */
  tx?: SecretRecordClient;
}

export interface SecretStoreGetArgs {
  tenantId: string;
  key: string;
}

export interface SecretStoreDeleteArgs {
  tenantId: string;
  key: string;
  /** Optional caller transaction; the store passes it through and never inspects it. */
  tx?: SecretRecordClient;
}

export interface SecretStore {
  put(args: SecretStorePutArgs): Promise<{ key: string }>;
  /** `null` when the row is absent OR the tenant does not match. */
  get(args: SecretStoreGetArgs): Promise<string | null>;
  /** Idempotent: deleting an absent key is not an error. */
  delete(args: SecretStoreDeleteArgs): Promise<void>;
  has(args: SecretStoreGetArgs): Promise<boolean>;
}

/**
 * A row exists but cannot be opened — an unknown master-key version, or a
 * failed authentication tag. This is deliberately distinct from "absent": an
 * absent row is `null`, while a row we cannot open is a fault that must not be
 * reported as a missing secret.
 */
export class SecretStoreIntegrityError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "SecretStoreIntegrityError";
  }
}
