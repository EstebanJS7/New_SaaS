import { z } from "zod";
import { hslOrHex, remValue } from "./brand-theme.schema.js";
import type { BrandOverride } from "./types.js";

/**
 * Current contract version of the tenant-editable override schema.
 *
 * Bump when the accepted key set or value formats change; older payloads are
 * rejected with `BRAND_OVERRIDE_UNSUPPORTED_SCHEMA_VERSION` instead of being
 * silently reinterpreted.
 */
export const BRAND_OVERRIDE_SCHEMA_VERSION = 1;

/**
 * Versioned partial-override variant for the tenant-editable contract
 * (PRD 10.1). Strict camelCase subset per design D5; value formats reuse the
 * approved `brandThemeSchema` primitives. Unknown keys are rejected — this is
 * a distinct sibling schema, never a mutation of the shipped full-theme one.
 */
export const brandOverrideSchema = z
  .object({
    schemaVersion: z.literal(BRAND_OVERRIDE_SCHEMA_VERSION),
    primary: hslOrHex.optional(),
    accent: hslOrHex.optional(),
    radius: remValue.optional(),
    defaultAppearance: z.enum(["light", "dark", "system"]).optional(),
  })
  .strict();

/** Stable validation error codes surfaced by `validateBrandOverride`. */
export const BRAND_OVERRIDE_ERROR_CODES = {
  /** Payload contains keys outside the versioned contract. */
  UNKNOWN_KEY: "BRAND_OVERRIDE_UNKNOWN_KEY",
  /** Payload declares a schema version other than the current one. */
  UNSUPPORTED_VERSION: "BRAND_OVERRIDE_UNSUPPORTED_SCHEMA_VERSION",
  /** A known key carries a value in a non-approved format. */
  INVALID_VALUE: "BRAND_OVERRIDE_INVALID_VALUE",
} as const;

export type BrandOverrideErrorCode =
  (typeof BRAND_OVERRIDE_ERROR_CODES)[keyof typeof BRAND_OVERRIDE_ERROR_CODES];

/** Validation failure carrying a stable machine-readable code. */
export class BrandOverrideValidationError extends Error {
  readonly code: BrandOverrideErrorCode;

  constructor(code: BrandOverrideErrorCode, message: string) {
    super(message);
    this.name = "BrandOverrideValidationError";
    this.code = code;
  }
}

function errorCodeFor(issue: z.ZodIssue): BrandOverrideErrorCode {
  // Root-level path means strict() found unrecognized keys.
  if (issue.code === "unrecognized_keys") {
    return BRAND_OVERRIDE_ERROR_CODES.UNKNOWN_KEY;
  }
  if (issue.path[0] === "schemaVersion") {
    return BRAND_OVERRIDE_ERROR_CODES.UNSUPPORTED_VERSION;
  }
  return BRAND_OVERRIDE_ERROR_CODES.INVALID_VALUE;
}

/**
 * Validate an untrusted tenant override payload.
 *
 * Returns the parsed `BrandOverride` on success; throws
 * `BrandOverrideValidationError` with a stable `code` on any rejection
 * (unknown key, unsafe value, wrong/missing schema version).
 */
export function validateBrandOverride(input: unknown): BrandOverride {
  const result = brandOverrideSchema.safeParse(input);
  if (result.success) {
    return result.data;
  }
  const issue = result.error.issues[0];
  const detail = issue ? `${issue.path.join(".") || "<root>"}: ${issue.message}` : "unknown issue";
  throw new BrandOverrideValidationError(errorCodeFor(issue), `Invalid brand override (${detail})`);
}
