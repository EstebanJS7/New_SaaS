"use client";

import { formatEsPyInstant } from "@/lib/es-py-format";
import type { FiscalDocumentStatus } from "./fiscal-api";

export const fiscalInputClassName =
  "h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";
export const fiscalTextareaClassName =
  "h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";
export const FISCAL_STATUS_LABELS: Record<FiscalDocumentStatus, string> = {
  PENDING: "Pendiente",
  QUEUED: "En cola",
  // FISC-009 appended SIGNING to `fiscal_document_status`; this label map kept
  // nine entries until FISC-010 WU-D closed the drift, and the key order follows
  // the lifecycle rather than the enum's append order.
  SIGNING: "Firmando",
  SENDING: "Enviando a SIFEN",
  SUBMITTED: "Enviado a SIFEN",
  APPROVED: "Aprobado",
  REJECTED: "Rechazado",
  ERROR: "Error",
  CANCEL_PENDING: "Pendiente de cancelación",
  CANCELLED: "Cancelado",
};
export function shortId(id: string): string {
  return id.slice(0, 8);
}
/** An API instant in the clinic's es-PY local time; unknown literals are returned unchanged. */
export function formatTimestamp(iso: string): string {
  return formatEsPyInstant(iso);
}
