/**
 * Sanitizes provider snapshots before persistence (DEC-050, PRD §41).
 * The policy fails closed: unapproved or unsupported data is redacted, never
 * rejected, so sanitization cannot turn a safe submission into a failed one.
 */
export const PROVIDER_SNAPSHOT_ALLOWED_KEYS = Object.freeze([
  "provider",
  "externalId",
  "cdc",
  "state",
  "status",
  "statusCode",
  "reasonCode",
  "message",
  "timestamp",
  // ADR-009: the request now carries the signed document, so the SIFEN
  // adapter's snapshot is a **descriptor** of the operation — the service it
  // called and the byte count of the signed XML — never the document itself.
  // Neither a service name nor a byte count is personal data, so both are
  // allowed rather than redacted; the document's own keys stay unlisted and are
  // therefore redacted if one ever appears.
  "service",
  "xmlBytes",
] as const);

export const PROVIDER_SNAPSHOT_SECRET_KEY_PATTERNS = Object.freeze([
  /authorization/i,
  /certificate/i,
  /pin/i,
  /password/i,
  /privateKey/i,
  /secret/i,
  /token/i,
  /key|pem|cert/i,
] as const);

export const PROVIDER_SNAPSHOT_DEFAULT_MAX_DEPTH = 4;
export const PROVIDER_SNAPSHOT_DEFAULT_MAX_STRING_LENGTH = 512;
const REDACTED = "[redacted]";

export interface SanitizeProviderSnapshotOptions {
  readonly maxDepth?: number;
  readonly maxStringLength?: number;
}

export interface SanitizedProviderSnapshot {
  readonly snapshot: unknown;
  readonly redactedPaths: readonly string[];
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isSecretKey(key: string): boolean {
  return PROVIDER_SNAPSHOT_SECRET_KEY_PATTERNS.some((pattern) => pattern.test(key));
}

/** Returns an immutable, bounded representation of an untrusted provider payload. */
export function sanitizeProviderSnapshot(
  value: unknown,
  options: SanitizeProviderSnapshotOptions = {}
): SanitizedProviderSnapshot {
  const maxDepth = options.maxDepth ?? PROVIDER_SNAPSHOT_DEFAULT_MAX_DEPTH;
  const maxStringLength = options.maxStringLength ?? PROVIDER_SNAPSHOT_DEFAULT_MAX_STRING_LENGTH;
  const redactedPaths: string[] = [];

  const redact = (path: string): typeof REDACTED => {
    redactedPaths.push(path || "$");
    return REDACTED;
  };

  const visit = (current: unknown, path: string, depth: number, allowed: boolean): unknown => {
    if (!allowed) return redact(path);
    if (typeof current === "string") {
      if (current.length <= maxStringLength) return current;
      redactedPaths.push(`${path || "$"}#truncated`);
      return `${current.slice(0, maxStringLength)}…`;
    }
    if (current === null || typeof current === "boolean" || typeof current === "number")
      return current;
    if (typeof current !== "object") return redact(path);
    if (depth >= maxDepth) return redact(path);
    if (Array.isArray(current)) {
      return current.map((item, index) =>
        visit(item, path ? `${path}.${index}` : String(index), depth + 1, true)
      );
    }
    if (!isPlainRecord(current)) return redact(path);

    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(current)) {
      const childPath = path ? `${path}.${key}` : key;
      const keyAllowed = PROVIDER_SNAPSHOT_ALLOWED_KEYS.some((allowedKey) => allowedKey === key);
      result[key] = isSecretKey(key)
        ? redact(childPath)
        : visit(item, childPath, depth + 1, keyAllowed);
    }
    return result;
  };

  try {
    return { snapshot: visit(value, "", 0, true), redactedPaths };
  } catch {
    return { snapshot: redact("$"), redactedPaths };
  }
}
