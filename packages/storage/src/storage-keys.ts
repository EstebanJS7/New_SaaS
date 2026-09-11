import { randomBytes } from "node:crypto";

/**
 * Opaque storage-key factory. Keys are random 128-bit base64url strings with
 * no structure that would leak tenant, kind, or filesystem layout.
 *
 * A small prefix keeps keys recognizable in logs and provider dashboards
 * without exposing semantics.
 */
export function createOpaqueStorageKey(prefix: string): string {
  const token = randomBytes(16).toString("base64url");
  return `${prefix}_${token}`;
}

/** Prefixes used by the branding asset boundary. */
export const STORAGE_KEY_PREFIXES = Object.freeze({
  brandingAsset: "brand",
});
