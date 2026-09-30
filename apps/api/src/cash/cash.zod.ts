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

/**
 * Movement kinds the standalone command accepts (PRD §20, DEC-020/DEC-033).
 * `SALE` is deliberately ABSENT: a `SALE` movement is written only by sale
 * completion (POS-003), so a caller cannot forge one through this command. The
 * tuple mirrors the `cash_movement_type` enum minus `SALE`.
 */
export const CASH_MOVEMENT_COMMAND_TYPES = [
  "REFUND",
  "INCOME",
  "EXPENSE",
  "WITHDRAWAL",
  "DEPOSIT",
  "ADJUSTMENT",
] as const;

/**
 * The command kinds whose reason is MANDATORY (DEC-032). `INCOME` is the only
 * accepted kind that may omit a reason, mirroring the `cash_movement_reason_required`
 * database CHECK and the service's defense-in-depth re-check.
 */
export const CASH_MOVEMENT_REASON_REQUIRED_TYPES = [
  "REFUND",
  "EXPENSE",
  "WITHDRAWAL",
  "DEPOSIT",
  "ADJUSTMENT",
] as const;

/**
 * Explicit `ADJUSTMENT` sign (DEC-030), pinned to the `cash_movement_direction`
 * enum. Required EXACTLY for `ADJUSTMENT` and forbidden for every other kind.
 */
export const CASH_MOVEMENT_DIRECTION_VALUES = ["INCREASE", "DECREASE"] as const;

/**
 * The `cash_movement.reason` column upper bound (`VARCHAR(500)` plus the
 * migration CHECK). The DTO mirrors the column exactly so Node and PostgreSQL
 * reject the same reasons.
 */
export const CASH_MOVEMENT_REASON_MAX_LENGTH = 500;

/**
 * Exact POSITIVE money at the `Decimal(14, 2)` column scale: up to 12 integer
 * digits and at most 2 decimals, with NO sign. The `amount <> 0` database CHECK
 * and DEC-030's positive-amount convention are mirrored here: the literal zero
 * is rejected by {@link isZeroMovementAmount} and a negative or non-decimal
 * literal by this pattern, both with the stable `400 VALIDATION_FAILED` BEFORE
 * any write reaches the database.
 */
export const CASH_MOVEMENT_AMOUNT_PATTERN = /^\d{1,12}(\.\d{1,2})?$/;

/** True when the literal is arithmetically zero in any accepted spelling (`"0"`, `"0.00"`). */
function isZeroMovementAmount(value: string): boolean {
  return /^0*(\.0*)?$/.test(value);
}

const cashMovementAmount = z
  .string()
  .regex(
    CASH_MOVEMENT_AMOUNT_PATTERN,
    "The movement amount must be an exact positive decimal string (max 14 digits, 2 decimals)."
  )
  .refine(
    (value) => !isZeroMovementAmount(value),
    "The movement amount must be greater than zero."
  );

/**
 * Movement reason: trimmed, non-empty and bounded to the column's 500-character
 * maximum. The trim runs before the length checks, so a whitespace-only reason
 * is rejected as empty rather than stored.
 */
const cashMovementReason = z
  .string()
  .trim()
  .min(1, "A cash movement reason is required.")
  .max(
    CASH_MOVEMENT_REASON_MAX_LENGTH,
    `A cash movement reason must be at most ${CASH_MOVEMENT_REASON_MAX_LENGTH} characters.`
  );

/**
 * Create payload for `POST /cash/movements`. `.strict()` rejects unknown keys,
 * explicitly including `tenantId` (resolved server-side from the request
 * context, never caller authority), `registerId` (derived from the resolved
 * session, never supplied), `id` and `createdAt` (server-owned).
 *
 * The cross-field rules that a per-field schema cannot express live in the
 * `superRefine`: `reason` is required for every kind but `INCOME` (DEC-032) and
 * `direction` is required EXACTLY for `ADJUSTMENT` (DEC-030). `type` is a closed
 * enum that excludes `SALE`, so a sale-generated movement cannot be forged here
 * (DEC-020/DEC-033). These two rules are re-asserted in the service as defense
 * in depth, because the in-memory test boundary cannot enforce the database
 * CHECK constraints that back them.
 */
export const createCashMovementBody = z
  .object({
    sessionId: z.string().uuid(),
    type: z.enum(CASH_MOVEMENT_COMMAND_TYPES),
    amount: cashMovementAmount,
    reason: cashMovementReason.optional(),
    direction: z.enum(CASH_MOVEMENT_DIRECTION_VALUES).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const reasonRequired = (CASH_MOVEMENT_REASON_REQUIRED_TYPES as readonly string[]).includes(
      value.type
    );
    if (reasonRequired && value.reason === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["reason"],
        message: "A cash movement reason is required for this movement kind.",
      });
    }
    if (value.type === "ADJUSTMENT") {
      if (value.direction === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["direction"],
          message: "An adjustment direction is required.",
        });
      }
    } else if (value.direction !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["direction"],
        message: "A direction is only allowed for an ADJUSTMENT movement.",
      });
    }
  });

export type CreateCashMovementInput = z.infer<typeof createCashMovementBody>;

/** The `Idempotency-Key` header REQUIRED by `POST /cash/movements` (DEC-024): a
 * movement has no state gate a retried submit could trip. 1..255 characters. */
export const cashMovementIdempotencyKey = z
  .string()
  .trim()
  .min(1, "An Idempotency-Key is required.")
  .max(255, "An Idempotency-Key must be at most 255 characters.");
