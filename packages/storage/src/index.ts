/**
 * Shared object-storage boundary for NewSaaS.
 *
 * Extracted from `apps/api` so both the API deployable and the worker
 * deployable consume the SAME port, drivers, and key factory. Domains depend
 * only on the abstract {@link StoragePort}; provider details stay in the
 * drivers.
 */
export {
  DEFAULT_SIGNED_URL_TTL_SECONDS,
  S3_STORAGE_CONFIG,
  STORAGE_PORT,
} from "./storage.constants.js";
export type { StoragePort } from "./storage.port.js";
export { InMemoryStorageDriver } from "./in-memory-storage.driver.js";
export { S3StorageDriver, type S3StorageConfig } from "./s3-storage.driver.js";
export { createOpaqueStorageKey, STORAGE_KEY_PREFIXES } from "./storage-keys.js";
export { StorageModule } from "./storage.module.js";
