/**
 * Stable, centrally registered domain error codes.
 *
 * Every API error maps to exactly one code defined here, together with the
 * HTTP status it deterministically produces. The registry is FROZEN and
 * append-only across releases: existing codes are never renamed or
 * repurposed; evolution adds new entries.
 *
 * Contract ownership lives in the shared package so web consumers read the
 * exact same codes as the API (design D6).
 */
export const ERROR_CODES = Object.freeze({
  VALIDATION_FAILED: Object.freeze({ status: 400 }),
  UNAUTHENTICATED: Object.freeze({ status: 401 }),
  FORBIDDEN: Object.freeze({ status: 403 }),
  NOT_FOUND: Object.freeze({ status: 404 }),
  CONFLICT: Object.freeze({ status: 409 }),
  RATE_LIMITED: Object.freeze({ status: 429 }),
  INTERNAL: Object.freeze({ status: 500 }),
  FEATURE_NOT_ENTITLED: Object.freeze({ status: 403 }),
});

export type ErrorCode = keyof typeof ERROR_CODES;

export interface ErrorCodeEntry {
  readonly status: number;
}

export type ErrorRegistry = Readonly<Record<ErrorCode, ErrorCodeEntry>>;

/** Resolves the HTTP status a registered code deterministically maps to. */
export function getStatusForCode(code: ErrorCode): number {
  return ERROR_CODES[code].status;
}
