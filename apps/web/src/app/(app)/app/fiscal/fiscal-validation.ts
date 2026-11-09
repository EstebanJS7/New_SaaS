"use client";

import { FISCAL_CANCEL_REASON_MAX_LENGTH } from "./fiscal-api";

const FISCAL_INVOICE_ID_PATTERN =
  /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}|00000000-0000-0000-0000-000000000000)$/i;
export function fiscalInvoiceIdError(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return "Ingresá el identificador de la factura.";
  if (!FISCAL_INVOICE_ID_PATTERN.test(trimmed))
    return "El identificador de la factura debe ser un UUID válido.";
  return null;
}
export function fiscalCancelReasonError(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return "Ingresá el motivo de la cancelación.";
  if (trimmed.length > FISCAL_CANCEL_REASON_MAX_LENGTH)
    return `El motivo de la cancelación puede tener hasta ${FISCAL_CANCEL_REASON_MAX_LENGTH} caracteres.`;
  return null;
}
