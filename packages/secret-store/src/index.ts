/**
 * Tenant secret-material boundary for NewSaaS.
 *
 * A reusable platform capability, not a Fiscal module: it stores opaque
 * tenant-scoped secrets encrypted at rest and knows nothing about what they
 * mean. Only opaque keys cross the boundary.
 *
 * The application is the composition root. This package ships the port, the
 * drivers and the key-ring resolution, but no NestJS module and no persistence
 * client, because the persistent driver's record client belongs to the
 * application (ADR-005/D1, DEC-053/D7).
 */

export { SECRET_STORE, SecretStoreIntegrityError } from "./secret-store.port.js";
export type {
  SecretRecordClient,
  SecretRecordRow,
  SecretStore,
  SecretStoreDeleteArgs,
  SecretStoreGetArgs,
  SecretStorePutArgs,
} from "./secret-store.port.js";

export {
  generateDataKey,
  openPayload,
  sealPayload,
  SECRET_DATA_KEY_BYTES,
  SECRET_GCM_IV_BYTES,
  SECRET_STORE_ALGORITHM,
  unwrapDataKey,
  wrapDataKey,
} from "./secret-envelope.js";

export { parseSecretStoreKeyRing, resolveSecretStoreSelection } from "./secret-key-ring.js";
export type { SecretStoreKeyRing, SecretStoreSelection } from "./secret-key-ring.js";

export { EnvelopeSecretStore } from "./envelope-secret-store.js";
export { InMemorySecretStore } from "./in-memory-secret-store.js";
export { createOpaqueSecretKey, SECRET_KEY_PREFIXES } from "./secret-keys.js";
