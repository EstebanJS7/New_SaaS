import { z } from "zod";

/**
 * Current contract version of the cash DTO, carried in every cash audit row's
 * metadata. Bumped when the accepted key set or value formats change (the
 * catalog/inventory/purchase/sale convention).
 */
export const CASH_DTO_SCHEMA_VERSION = 1;

/**
 * Lifecycle values pinned by the schema enum `cash_session_status` (PRD §20).
 * Kept as a local literal tuple so this boundary stays decoupled from the
 * generated client namespace (structural compatibility only). The server owns
 * the lifecycle: no request contract accepts a caller-supplied status, `OPEN` is
 * the database default a new session takes, and `CLOSED` is reachable only
 * through the EPIC-13 close command, which this slice does not ship.
 */
export const CASH_SESSION_STATUS_VALUES = ["OPEN", "CLOSED"] as const;

/**
 * The `cash_register.name` column upper bound (`VARCHAR(200)` plus the
 * migration CHECK `char_length(name) BETWEEN 1 AND 200`). The DTO mirrors the
 * column exactly so Node and PostgreSQL reject the same names.
 */
export const CASH_REGISTER_NAME_MAX_LENGTH = 200;

/**
 * Exact NON-NEGATIVE money at the `Decimal(14, 2)` column scale: up to 12
 * integer digits and at most 2 decimals, with NO sign (the purchase/sale money
 * discipline). `"0"` and `"0.00"` are accepted because a register may open with
 * an empty drawer, and a negative literal is rejected by this pattern with the
 * stable `400 VALIDATION_FAILED` BEFORE any write reaches the database.
 */
export const CASH_OPENING_AMOUNT_PATTERN = /^\d{1,12}(\.\d{1,2})?$/;

/**
 * The register-create name: trimmed, non-empty and bounded to the column's
 * 200-character maximum. The trim runs before the length checks, so a
 * whitespace-only name is rejected as empty rather than stored.
 */
const cashRegisterName = z
  .string()
  .trim()
  .min(1, "A cash register name is required.")
  .max(
    CASH_REGISTER_NAME_MAX_LENGTH,
    `A cash register name must be at most ${CASH_REGISTER_NAME_MAX_LENGTH} characters.`
  );

/**
 * Create payload for `POST /cash/registers`. `.strict()` rejects unknown keys,
 * explicitly including `tenantId` (resolved server-side from the request context
 * and never caller authority), `isActive` (server-owned, defaults to true) and
 * any `branchId` (there is deliberately no Branch dimension, DEC-020).
 */
export const createCashRegisterBody = z.object({ name: cashRegisterName }).strict();

export type CreateCashRegisterInput = z.infer<typeof createCashRegisterBody>;

/**
 * Open payload for `POST /cash/sessions`. `.strict()` rejects unknown keys,
 * explicitly including `tenantId` (server-resolved), `status` (server-owned:
 * a new session is `OPEN`), `openedByMembershipId` (resolved server-side from
 * the authenticated request context, never the body), `currency` (cash has no
 * currency column, DEC-020) and `branchId` (no Branch dimension, DEC-020).
 */
export const openCashSessionBody = z
  .object({
    registerId: z.string().uuid(),
    openingAmount: z
      .string()
      .regex(
        CASH_OPENING_AMOUNT_PATTERN,
        "The opening amount must be an exact non-negative decimal string (max 14 digits, 2 decimals)."
      ),
  })
  .strict();

export type OpenCashSessionInput = z.infer<typeof openCashSessionBody>;

/**
 * Session list query. The optional `status` narrows the list to one lifecycle
 * value and is applied on top of the implicit tenant predicate; an omitted
 * status applies NO filter (there is deliberately no implicit open-only
 * default). `.strict()` rejects unknown query keys instead of ignoring them,
 * mirroring the catalog/stock-movement/supplier/purchase/sale filters.
 */
export const cashSessionListQuery = z
  .object({ status: z.enum(CASH_SESSION_STATUS_VALUES).optional() })
  .strict();

export type CashSessionListFiltersInput = z.infer<typeof cashSessionListQuery>;
