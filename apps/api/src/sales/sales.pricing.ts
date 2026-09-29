// Value import (not `import type`): `Prisma` provides the exact `Decimal` type
// and the `ROUND_HALF_UP` constant every money computation must use.
import { Prisma } from "@newsaas/database";
import { DomainError } from "@newsaas/shared";

/**
 * Currency minor-unit exponents supported by the sale aggregate (POS-001 W2,
 * DEC-021). The Decision requires half-up rounding "at the currency's minor
 * unit" but no currency-to-exponent source exists, so this is the single
 * explicit exponent map of the sales domain and **PYG -> 0 is the only
 * supported entry**. Extending it later is one entry.
 *
 * A tenant whose `sales.defaultCurrency` is not in this map MUST fail with the
 * stable `400 VALIDATION_FAILED` below instead of rounding with a guessed
 * exponent; a silently wrong rounding is a financial defect, not a default.
 */
export const SALES_MINOR_UNITS: Readonly<Record<string, number>> = Object.freeze({ PYG: 0 });

/** Single stable message behind every unsupported sale currency. */
export const SALE_UNSUPPORTED_CURRENCY_MESSAGE = "The sale currency is not supported.";

/**
 * Resolves the currency's minor-unit exponent, or fails with the stable
 * `VALIDATION_FAILED` for a currency the domain does not support. Never rounds
 * with a fallback exponent.
 */
export function resolveMinorUnit(currency: string): number {
  const minorUnit = SALES_MINOR_UNITS[currency];
  if (minorUnit === undefined) {
    throw new DomainError("VALIDATION_FAILED", SALE_UNSUPPORTED_CURRENCY_MESSAGE);
  }
  return minorUnit;
}

/** Inputs of one tax-included line computation. Decimals, never floats. */
export interface LineAmountInput {
  readonly unitPrice: Prisma.Decimal | string;
  readonly quantity: Prisma.Decimal | string;
  /** The frozen rate's percentage value, e.g. `0`, `5`, `10`. */
  readonly ratePercent: Prisma.Decimal | string;
  readonly minorUnit: number;
}

/** The derived per-line money amounts, exact at the minor unit. */
export interface LineAmounts {
  readonly lineTotal: Prisma.Decimal;
  readonly taxableBase: Prisma.Decimal;
  readonly taxAmount: Prisma.Decimal;
}

/**
 * The ONLY rounding site in the repository (DEC-021). Sale line prices are
 * TAX-INCLUDED, so the displayed price is what the customer pays; the tax split
 * is derived from it. Rounding is HALF-UP PER LINE at the currency's minor unit
 * (PYG -> 0 decimals) because that is the Decision's rule and the amount the
 * customer sees must be the amount charged:
 *
 *   lineTotal   = round(unitPrice * quantity)
 *   taxableBase = round(lineTotal / (1 + ratePercent / 100))
 *   taxAmount   = lineTotal - taxableBase
 *
 * `taxAmount` is a SUBTRACTION, not an independent division, so
 * `taxableBase + taxAmount === lineTotal` EXACTLY by construction — a future
 * invoice can never see a one-cent gap between the line and its split. Every
 * step uses `Prisma.Decimal` with `toDecimalPlaces(minorUnit,
 * ROUND_HALF_UP)`; a JavaScript float or `Math.round` is never involved.
 */
export function computeLineAmounts(input: LineAmountInput): LineAmounts {
  const unitPrice = new Prisma.Decimal(input.unitPrice);
  const quantity = new Prisma.Decimal(input.quantity);
  const ratePercent = new Prisma.Decimal(input.ratePercent);

  const lineTotal = unitPrice
    .times(quantity)
    .toDecimalPlaces(input.minorUnit, Prisma.Decimal.ROUND_HALF_UP);

  const divisor = new Prisma.Decimal(1).plus(ratePercent.dividedBy(100));
  const taxableBase = lineTotal
    .dividedBy(divisor)
    .toDecimalPlaces(input.minorUnit, Prisma.Decimal.ROUND_HALF_UP);

  const taxAmount = lineTotal.minus(taxableBase);

  return { lineTotal, taxableBase, taxAmount };
}

/** Minimal line shape the sale total consumes. */
export interface LineTotalLike {
  readonly lineTotal: Prisma.Decimal | string;
}

/**
 * The sale total: the sum of the line totals, re-rounded at the target money
 * scale. There is no `total` column (DEC-021) — the total is always derived from
 * the frozen line snapshots, never stored and never re-computed from the
 * catalog.
 */
export function sumLineTotals(lines: readonly LineTotalLike[], scale: number): Prisma.Decimal {
  let total = new Prisma.Decimal(0);
  for (const line of lines) {
    total = total.plus(new Prisma.Decimal(line.lineTotal));
  }
  return total.toDecimalPlaces(scale, Prisma.Decimal.ROUND_HALF_UP);
}
