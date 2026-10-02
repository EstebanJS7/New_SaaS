"use client";

import { INVOICE_CANCEL_REASON_MAX_LENGTH } from "./billing-api";

/**
 * Field-level validation for the staff Billing forms (EPIC-14 BILL-004).
 *
 * These checks mirror the API's request contract in
 * `apps/api/src/billing/billing.zod.ts` so the operator gets an immediate,
 * readable reason instead of a round trip that can only end in the stable
 * `400 VALIDATION_FAILED`. They are UX ONLY: the API re-validates every field
 * and stays the authority, and nothing here grants or derives tenant authority —
 * no check reads or sends a tenant id.
 *
 * The create payload carries one field, so its check is {@link invoiceSaleIdError}
 * against the same UUID shape the API's `z.string().uuid()` accepts. The cancel
 * payload carries a required reason, so its check mirrors the cash movement
 * reason precedent the API follows: the value is TRIMMED before the length
 * checks, so a whitespace-only reason is refused as empty rather than sent.
 */

/**
 * Canonical UUID shape accepted by the API's `z.string().uuid()`: the standard
 * version/variant layout plus the nil UUID. Kept identical to zod's own pattern
 * so the client never refuses an id the API would accept, and never accepts one
 * the API would refuse.
 */
const INVOICE_SALE_ID_PATTERN =
  /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}|00000000-0000-0000-0000-000000000000)$/i;

/** The completed-sale-id error, or `null` when the id is submittable. */
export function invoiceSaleIdError(saleId: string): string | null {
  const trimmed = saleId.trim();
  if (trimmed.length === 0) {
    return "A completed sale id is required.";
  }
  if (!INVOICE_SALE_ID_PATTERN.test(trimmed)) {
    return "The sale id must be a UUID.";
  }
  return null;
}

/**
 * The cancel-reason error, or `null` when the reason is submittable. The reason
 * is required (the `invoice_cancel_reason_present` CHECK and DEC-043), so a
 * blank value is refused here exactly as the API refuses it; the trimmed value is
 * what the command persists.
 */
export function invoiceCancelReasonError(reason: string): string | null {
  const trimmed = reason.trim();
  if (trimmed.length === 0) {
    return "An invoice cancel reason is required.";
  }
  if (trimmed.length > INVOICE_CANCEL_REASON_MAX_LENGTH) {
    return `An invoice cancel reason must be at most ${INVOICE_CANCEL_REASON_MAX_LENGTH} characters.`;
  }
  return null;
}
