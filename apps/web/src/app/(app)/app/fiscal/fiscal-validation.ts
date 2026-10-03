"use client";

import { FISCAL_CANCEL_REASON_MAX_LENGTH } from "./fiscal-api";

const FISCAL_INVOICE_ID_PATTERN =
  /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}|00000000-0000-0000-0000-000000000000)$/i;
export function fiscalInvoiceIdError(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return "An invoice id is required.";
  if (!FISCAL_INVOICE_ID_PATTERN.test(trimmed)) return "The invoice id must be a UUID.";
  return null;
}
export function fiscalCancelReasonError(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return "A fiscal document cancel reason is required.";
  if (trimmed.length > FISCAL_CANCEL_REASON_MAX_LENGTH)
    return `A fiscal document cancel reason must be at most ${FISCAL_CANCEL_REASON_MAX_LENGTH} characters.`;
  return null;
}
