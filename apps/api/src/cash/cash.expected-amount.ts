// Value import (not `import type`): `Prisma` provides the exact `Decimal` type
// every cash money computation must use. A JavaScript float or `Number()` is
// never involved (DEC-031, PRD §20).
import { Prisma } from "@newsaas/database";
import type { CashMovementDirectionValue, CashMovementTypeValue } from "./cash.repository.js";

/**
 * Fixed scale of every cash money column (`Decimal(14, 2)`): the opening amount
 * and the three close-result amounts. It is the SINGLE scale constant of the
 * cash domain, so an arithmetic step and a DTO projection cannot disagree.
 */
export const CASH_MONEY_SCALE = 2;

/**
 * Minimal immutable-movement shape the expected-amount computation consumes.
 * `amount` is an exact `Decimal(14, 2)` — `Prisma.Decimal` at runtime, a plain
 * exact string in unit tests and the in-memory boundary — and is always
 * POSITIVE: the KIND owns the sign (DEC-030). `direction` is non-null exactly
 * for an `ADJUSTMENT`.
 */
export interface CashCloseMovementLike {
  readonly type: CashMovementTypeValue;
  readonly direction: CashMovementDirectionValue | null;
  readonly amount: Prisma.Decimal | string;
}

/** Inputs of one server-side expected-amount computation. */
export interface CashCloseInput {
  /** The session's stored opening float, exact at scale 2. */
  readonly openingAmount: Prisma.Decimal | string;
  /** The operator's counted amount, exact at scale 2. */
  readonly countedAmount: Prisma.Decimal | string;
  /** Every movement of the session, at any order (addition is commutative). */
  readonly movements: readonly CashCloseMovementLike[];
}

/** The two server-derived close amounts, exact at {@link CASH_MONEY_SCALE}. */
export interface CashCloseAmounts {
  readonly expectedAmount: Prisma.Decimal;
  /** `countedAmount - expectedAmount`; NEGATIVE when the drawer is short. */
  readonly differenceAmount: Prisma.Decimal;
}

/**
 * The sign the movement KIND contributes to the expected drawer amount
 * (DEC-030, Option A): `SALE`, `INCOME` and `DEPOSIT` add; `REFUND`, `EXPENSE`
 * and `WITHDRAWAL` subtract; `ADJUSTMENT` follows its explicit `direction`
 * (anything other than `DECREASE` adds, mirroring `INCREASE`). A `null`
 * direction on an `ADJUSTMENT` cannot occur — the migration's exclusive
 * `cash_movement_direction_required` CHECK forbids it — so the fallback never
 * silently reinterprets a stored row.
 */
export function cashMovementSign(
  type: CashMovementTypeValue,
  direction: CashMovementDirectionValue | null
): 1 | -1 {
  switch (type) {
    case "SALE":
    case "INCOME":
    case "DEPOSIT":
      return 1;
    case "REFUND":
    case "EXPENSE":
    case "WITHDRAWAL":
      return -1;
    case "ADJUSTMENT":
      return direction === "DECREASE" ? -1 : 1;
  }
}

/**
 * The ONLY place the close expected amount is computed (DEC-030/DEC-031):
 *
 *   expected   = openingAmount + SALE + INCOME + DEPOSIT
 *                             - REFUND - EXPENSE - WITHDRAWAL
 *                             ± ADJUSTMENT (INCREASE adds, DECREASE subtracts)
 *   difference = countedAmount - expectedAmount
 *
 * Confirmed movement amounts stay POSITIVE in the database and the KIND (or the
 * explicit `ADJUSTMENT` direction) owns the sign, so the same map that CASH-002
 * validated on write is the one close applies on read. A session with ZERO
 * movements closes with `expected === openingAmount`.
 *
 * Every step is `Prisma.Decimal` arithmetic and the result is re-quantized at
 * the column scale with `ROUND_HALF_UP`; because every input is already exact at
 * scale 2 the rounding is the identity, and it exists so a future non-scale-2
 * input can never leak a longer literal into the `Decimal(14, 2)` columns.
 */
export function computeCashCloseAmounts(input: CashCloseInput): CashCloseAmounts {
  let expectedAmount = new Prisma.Decimal(input.openingAmount);
  for (const movement of input.movements) {
    const amount = new Prisma.Decimal(movement.amount);
    expectedAmount =
      cashMovementSign(movement.type, movement.direction) === 1
        ? expectedAmount.plus(amount)
        : expectedAmount.minus(amount);
  }

  const expected = expectedAmount.toDecimalPlaces(CASH_MONEY_SCALE, Prisma.Decimal.ROUND_HALF_UP);
  const difference = new Prisma.Decimal(input.countedAmount)
    .minus(expected)
    .toDecimalPlaces(CASH_MONEY_SCALE, Prisma.Decimal.ROUND_HALF_UP);

  return { expectedAmount: expected, differenceAmount: difference };
}
