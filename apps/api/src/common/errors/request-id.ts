import { randomUUID } from "node:crypto";

/** Canonical request correlation header (design D7). */
export const REQUEST_ID_HEADER = "x-request-id";

/** Maximum accepted inbound request id length (design D7). */
export const MAX_REQUEST_ID_LENGTH = 128;

const PRINTABLE_ASCII = /^[\x20-\x7E]+$/;

/**
 * Resolves the authoritative request id for a request.
 *
 * Adopts the inbound candidate when it is a single value which, once trimmed,
 * is a non-empty run of at most {@link MAX_REQUEST_ID_LENGTH} printable ASCII
 * characters; otherwise mints a fresh UUID. Anything outside that contract
 * (missing, oversized, control characters, multi-value garbage) falls back to
 * generation so hostile headers cannot poison logs or envelopes.
 */
export function resolveRequestId(candidate: unknown): string {
  // Array.isArray narrows to any[], so pin the element type explicitly.
  const values: unknown[] = Array.isArray(candidate) ? candidate : [candidate];
  const value = values[0];
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (
      trimmed.length > 0 &&
      trimmed.length <= MAX_REQUEST_ID_LENGTH &&
      PRINTABLE_ASCII.test(trimmed)
    ) {
      return trimmed;
    }
  }
  return randomUUID();
}
