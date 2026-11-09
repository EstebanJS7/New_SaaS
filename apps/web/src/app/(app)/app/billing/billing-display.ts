"use client";

import { formatEsPyDecimal, formatEsPyInstant, formatStaffMoney } from "@/lib/es-py-format";
import type { InvoiceStatus } from "./billing-api";

/**
 * Presentation helpers for the staff Billing surface (EPIC-14 BILL-004).
 *
 * Everything here is display only. It labels the API's pinned `invoice_status`
 * values and renders the API's exact decimal strings exactly as the wire
 * produced them, in es-PY. **No amount is ever parsed into a JavaScript
 * number**: the money formatter is the shared {@link formatStaffMoney}, which
 * groups the digits textually (no float, no rounding, no `parseFloat`, no
 * `Number()`), and the quantity formatter only strips redundant trailing zeros
 * from the string before grouping it with {@link formatEsPyDecimal}. Billing performs no money arithmetic anywhere, including the browser
 * (DEC-038), so this module never adds, subtracts or recomputes a total — the
 * server-computed `total`/`taxTotal` are rendered as returned.
 *
 * The invoice's fields are INTERNAL (PRD §41). Nothing here logs, copies or
 * emits one: these helpers only return strings for the screen.
 */

/** The shared control class for the billing forms: semantic tokens only. */
export const billingInputClassName =
  "h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

/** The shared multi-line control class, for the free-text cancel reason. */
export const billingTextareaClassName =
  "h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

/** Staff-facing label for each pinned `invoice_status` value (DEC-038/DEC-043). */
export const INVOICE_STATUS_LABELS: Record<InvoiceStatus, string> = {
  DRAFT: "Borrador",
  CONFIRMED: "Confirmada",
  CANCELLED: "Anulada",
};

/** A short, stable fragment of a UUID, shown instead of a full identifier. */
export function shortId(id: string): string {
  return id.slice(0, 8);
}

/**
 * Renders one of the API's ISO instants for staff in the clinic's es-PY local
 * time (`1 oct. 2026, 06:30 a. m.`) through the shared {@link formatEsPyInstant}.
 * A literal the API did not produce is returned unchanged.
 */
export function formatTimestamp(iso: string): string {
  return formatEsPyInstant(iso);
}

/**
 * Renders an exact wire amount in the invoice's own currency. The amount is
 * never parsed: {@link formatStaffMoney} groups the digits textually, so the
 * value the API returned stays the value the operator sees.
 */
export function formatInvoiceAmount(value: string, currency: string): string {
  return formatStaffMoney(value, currency);
}

/** Exact non-negative decimal literal as the API projects a quantity. */
const QUANTITY_PATTERN = /^(\d+)(?:\.(\d+))?$/;

/**
 * Renders an exact `quantity` literal. Quantity is not money, so this only
 * removes redundant trailing zeros from the string and groups it in es-PY
 * (`"2.000"` → `"2"`, `"0.500"` → `"0,5"`, `"1500.250"` → `"1.500,25"`); nothing
 * is parsed and no value is rounded. A literal the API did not produce is
 * returned unchanged.
 */
export function formatQuantity(value: string): string {
  const match = QUANTITY_PATTERN.exec(value);
  if (match === null) {
    return value;
  }
  const integer = match[1] ?? "";
  const decimals = match[2];
  const trimmed = (decimals ?? "").replace(/0+$/, "");
  return formatEsPyDecimal(trimmed.length === 0 ? integer : `${integer}.${trimmed}`);
}

/**
 * Renders the invoice's allocated identity: `"A-12"` once the number exists, and
 * an explicit «Sin número todavía» reading while the invoice is still a draft
 * (DEC-039 — allocation belongs to confirmation). The `series`/`number` pair is
 * the API's own and is never derived here.
 */
export function invoiceNumberLabel(series: string, number: number | null): string {
  return number === null ? "Sin número todavía" : `${series}-${number}`;
}
