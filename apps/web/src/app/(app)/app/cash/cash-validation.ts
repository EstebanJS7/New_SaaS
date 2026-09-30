"use client";

import {
  CASH_REGISTER_NAME_MAX_LENGTH,
  type CashMovementDirection,
  type CashMovementType,
} from "./cash-api";

/**
 * Field-level validation for the staff Cash forms (EPIC-13 CASH-004).
 *
 * These checks mirror the API's request contract in `apps/api/src/cash/cash.zod.ts`
 * so the operator gets an immediate, readable reason instead of a round trip that
 * can only end in the stable `400 VALIDATION_FAILED`. They are UX ONLY: the API
 * re-validates every field and stays the authority, and nothing here grants or
 * derives tenant authority — no check reads or sends a tenant id.
 *
 * The cross-field rules are the ones the API's `superRefine` owns and the ones
 * the proxy deliberately does not re-implement: the reason is required for every
 * movement kind but `INCOME`, and the direction is required EXACTLY for
 * `ADJUSTMENT` (DEC-030/032).
 */

/** The `cash_movement.reason` column upper bound (`VARCHAR(500)`). */
export const CASH_MOVEMENT_REASON_MAX_LENGTH = 500;

/**
 * Exact fixed-scale amount at the `Decimal(14, 2)` column scale: up to 12 integer
 * digits and at most 2 decimals, with no sign. The opening, counted and movement
 * amounts all use this shape; the movement amount additionally refuses the
 * literal zero (the `amount <> 0` database CHECK and DEC-030's positive-amount
 * convention).
 */
const CASH_WIRE_AMOUNT_PATTERN = /^\d{1,12}(?:\.\d{1,2})?$/;

/** The movement kinds whose reason is MANDATORY (DEC-032). */
export const CASH_REASON_REQUIRED_TYPES: readonly CashMovementType[] = [
  "REFUND",
  "EXPENSE",
  "WITHDRAWAL",
  "DEPOSIT",
  "ADJUSTMENT",
];

/** True when the movement kind requires a reason; `INCOME` is the only optional one. */
export function isCashReasonRequired(type: CashMovementType): boolean {
  return CASH_REASON_REQUIRED_TYPES.includes(type);
}

/** True when the movement kind requires an explicit direction (only `ADJUSTMENT`). */
export function isCashDirectionRequired(type: CashMovementType): boolean {
  return type === "ADJUSTMENT";
}

/** The register-name error, or `null` when the name is submittable. */
export function cashRegisterNameError(name: string): string | null {
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    return "A cash register name is required.";
  }
  if (trimmed.length > CASH_REGISTER_NAME_MAX_LENGTH) {
    return `A cash register name must be at most ${CASH_REGISTER_NAME_MAX_LENGTH} characters.`;
  }
  return null;
}

/** The opening-amount error, or `null`. Zero is accepted: a drawer may open empty. */
export function cashOpeningAmountError(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return "An opening amount is required.";
  }
  if (!CASH_WIRE_AMOUNT_PATTERN.test(trimmed)) {
    return "The opening amount must be an exact non-negative decimal with at most 2 decimals.";
  }
  return null;
}

/** The counted-amount error, or `null`. Zero is accepted: a drawer may be counted empty. */
export function cashCountedAmountError(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return "A counted amount is required.";
  }
  if (!CASH_WIRE_AMOUNT_PATTERN.test(trimmed)) {
    return "The counted amount must be an exact non-negative decimal with at most 2 decimals.";
  }
  return null;
}

/**
 * The movement-amount error, or `null`. The amount is POSITIVE — the movement
 * type owns the sign (DEC-030) — so the literal zero is refused exactly as the
 * API refuses it.
 */
export function cashMovementAmountError(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return "An amount is required.";
  }
  if (!CASH_WIRE_AMOUNT_PATTERN.test(trimmed)) {
    return "The movement amount must be an exact positive decimal with at most 2 decimals.";
  }
  if (/^0+(?:\.0+)?$/.test(trimmed)) {
    return "The movement amount must be greater than zero.";
  }
  return null;
}

/** The reason error for the chosen kind, or `null`. A blank optional reason is fine. */
export function cashMovementReasonError(type: CashMovementType, reason: string): string | null {
  const trimmed = reason.trim();
  if (trimmed.length === 0) {
    return isCashReasonRequired(type) ? "A reason is required for this movement kind." : null;
  }
  if (trimmed.length > CASH_MOVEMENT_REASON_MAX_LENGTH) {
    return `A reason must be at most ${CASH_MOVEMENT_REASON_MAX_LENGTH} characters.`;
  }
  return null;
}

/**
 * The direction error for the chosen kind, or `null`. A direction is required
 * exactly for `ADJUSTMENT` and forbidden for every other kind.
 */
export function cashMovementDirectionError(
  type: CashMovementType,
  direction: CashMovementDirection | ""
): string | null {
  if (type === "ADJUSTMENT") {
    return direction === "" ? "An adjustment direction is required." : null;
  }
  return direction === "" ? null : "A direction is only allowed for an adjustment.";
}

/** The locally held movement form, before it becomes a create payload. */
export interface CashMovementDraft {
  readonly type: CashMovementType;
  readonly amount: string;
  readonly reason: string;
  /** Empty string means "no direction chosen yet"; only `ADJUSTMENT` uses it. */
  readonly direction: CashMovementDirection | "";
}

/**
 * The first error the movement draft carries, or `null` when it is submittable.
 * The order is stable (amount, reason, direction) so the operator is told about
 * one thing at a time.
 */
export function cashMovementDraftError(draft: CashMovementDraft): string | null {
  return (
    cashMovementAmountError(draft.amount) ??
    cashMovementReasonError(draft.type, draft.reason) ??
    cashMovementDirectionError(draft.type, draft.direction)
  );
}
