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

/** Prefixes used by the shared object-storage boundaries. */
export const STORAGE_KEY_PREFIXES = Object.freeze({
  brandingAsset: "brand",
  /**
   * FISC-012: the signed fiscal document the worker stores before submission.
   * The key is written to `fiscal_document.xml_storage_key`; the bytes are the
   * exact signed XML the provider is asked to accept (ADR-009).
   */
  fiscalDocument: "fiscal-document",
});
