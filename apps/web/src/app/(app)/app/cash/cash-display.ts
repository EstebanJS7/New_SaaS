"use client";

import { formatWireAmount } from "../sales/sales-api";
import type { CashMovementDirection, CashMovementType, CashSessionStatus } from "./cash-api";

/**
 * Presentation helpers for the staff Cash surface (EPIC-13 CASH-004).
 *
 * Everything here is display only: it labels the API's pinned lifecycle and
 * movement values and renders the API's exact decimal strings. No amount is ever
 * parsed into a JavaScript number — the money formatter is the sales surface's
 * {@link formatWireAmount}, which groups the digits textually, exactly as the
 * cash client's own header documents.
 *
 * The close result's `differenceAmount` is `countedAmount - expectedAmount` and
 * is legitimately NEGATIVE when the drawer is short (DEC-031). This module
 * therefore renders the SIGN explicitly instead of a bare magnitude, so a short
 * drawer reads as short and never as a malformed or failing amount. Nothing here
 * treats a negative difference as an error: it is an expected close outcome.
 */

/** The shared control class for the cash forms: semantic tokens only. */
export const cashInputClassName =
  "h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

/** The shared multi-line control class, for the free-text movement reason. */
export const cashTextareaClassName =
  "h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

/** Staff-facing label for each pinned `cash_session_status` value. */
export const CASH_SESSION_STATUS_LABELS: Record<CashSessionStatus, string> = {
  OPEN: "Open",
  CLOSED: "Closed",
};

/** Staff-facing label for each movement kind the standalone command accepts. */
export const CASH_MOVEMENT_TYPE_LABELS: Record<CashMovementType, string> = {
  REFUND: "Refund",
  INCOME: "Income",
  EXPENSE: "Expense",
  WITHDRAWAL: "Withdrawal",
  DEPOSIT: "Deposit",
  ADJUSTMENT: "Adjustment",
};

/** Staff-facing label for the explicit `ADJUSTMENT` sign (DEC-030). */
export const CASH_MOVEMENT_DIRECTION_LABELS: Record<CashMovementDirection, string> = {
  INCREASE: "Increase expected cash",
  DECREASE: "Decrease expected cash",
};

/** A short, stable fragment of a UUID, shown instead of a full identifier. */
export function shortId(id: string): string {
  return id.slice(0, 8);
}

/** The API's `createdAt`/`openedAt` are ISO timestamps; show the UTC date only. */
export function formatDate(iso: string): string {
  return iso.slice(0, 10);
}

/**
 * Renders an exact non-negative wire amount. The amount is never parsed:
 * {@link formatWireAmount} groups the digits textually.
 */
export function formatCashAmount(value: string): string {
  return formatWireAmount(value);
}

/** Exact signed decimal literal as the close result projects it. */
const SIGNED_WIRE_AMOUNT_PATTERN = /^-?\d+(?:\.\d+)?$/;

/** True when a sign-stripped magnitude is arithmetically zero in any spelling. */
function isZeroMagnitude(magnitude: string): boolean {
  return /^0+(?:\.0+)?$/.test(magnitude);
}

interface SignedWireAmount {
  readonly negative: boolean;
  /** The literal without its sign. */
  readonly magnitude: string;
}

/** Splits an exact signed decimal literal into its sign and its magnitude. */
function parseSignedWireAmount(value: string): SignedWireAmount | null {
  const trimmed = value.trim();
  if (!SIGNED_WIRE_AMOUNT_PATTERN.test(trimmed)) {
    return null;
  }
  const negative = trimmed.startsWith("-");
  return { negative, magnitude: negative ? trimmed.slice(1) : trimmed };
}

/** The sign the difference actually carries, or `null` for a literal the wire did not produce. */
export type CashDifferenceOutcome = "SHORT" | "OVER" | "BALANCED";

/**
 * Classifies the close difference. A negative difference is a SHORT drawer (a
 * real, expected outcome), a positive one is OVER, and an arithmetically zero
 * one is BALANCED regardless of its spelling. A literal the wire did not produce
 * yields `null` rather than a guessed outcome.
 */
export function cashDifferenceOutcome(difference: string): CashDifferenceOutcome | null {
  const parsed = parseSignedWireAmount(difference);
  if (parsed === null) {
    return null;
  }
  if (isZeroMagnitude(parsed.magnitude)) {
    return "BALANCED";
  }
  return parsed.negative ? "SHORT" : "OVER";
}

/**
 * Renders an exact signed decimal with its sign made explicit: `-1,500.00` for a
 * short drawer, `+1,500.00` for an over one and `0.00` for a balanced count. The
 * magnitude is grouped textually and never parsed. A literal the wire did not
 * produce is returned unchanged rather than mangled.
 */
export function formatSignedWireAmount(value: string): string {
  const parsed = parseSignedWireAmount(value);
  if (parsed === null) {
    return value;
  }
  if (isZeroMagnitude(parsed.magnitude)) {
    return formatWireAmount(parsed.magnitude);
  }
  return `${parsed.negative ? "-" : "+"}${formatWireAmount(parsed.magnitude)}`;
}

/**
 * The plain-language reading of the close difference, so the operator does not
 * have to interpret a signed number. A short drawer is described as short — it
 * is never phrased as a failure.
 */
export function cashDifferenceLabel(difference: string): string {
  const parsed = parseSignedWireAmount(difference);
  if (parsed === null) {
    return "Difference unavailable";
  }
  if (isZeroMagnitude(parsed.magnitude)) {
    return "Balanced";
  }
  return `${parsed.negative ? "Short" : "Over"} by ${formatWireAmount(parsed.magnitude)}`;
}
