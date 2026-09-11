/**
 * Dependency-injection tokens and constants for the storage boundary.
 *
 * Storage is a platform capability; Core/Veterinary domains consume the
 * abstract port and never reach for a concrete driver.
 */

/** Injection token for the runtime StoragePort implementation. */
export const STORAGE_PORT = Symbol("STORAGE_PORT");

/** Injection token for optional S3 configuration. */
export const S3_STORAGE_CONFIG = Symbol("S3_STORAGE_CONFIG");

/** Default signed-URL lifetime in seconds (5 minutes). */
export const DEFAULT_SIGNED_URL_TTL_SECONDS = 300;
