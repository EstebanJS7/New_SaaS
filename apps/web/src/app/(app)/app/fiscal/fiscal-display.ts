"use client";

import type { FiscalDocumentStatus } from "./fiscal-api";

export const fiscalInputClassName =
  "h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";
export const fiscalTextareaClassName =
  "h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";
export const FISCAL_STATUS_LABELS: Record<FiscalDocumentStatus, string> = {
  PENDING: "Pending",
  QUEUED: "Queued",
  // FISC-009 appended SIGNING to `fiscal_document_status`; this label map kept
  // nine entries until FISC-010 WU-D closed the drift, and the key order follows
  // the lifecycle rather than the enum's append order.
  SIGNING: "Signing",
  SENDING: "Sending",
  SUBMITTED: "Submitted",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  ERROR: "Error",
  CANCEL_PENDING: "Cancellation pending",
  CANCELLED: "Cancelled",
};
export function shortId(id: string): string {
  return id.slice(0, 8);
}
const ISO_TIMESTAMP_PATTERN = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(?::\d{2}(?:\.\d+)?)?Z$/;
export function formatTimestamp(iso: string): string {
  const match = ISO_TIMESTAMP_PATTERN.exec(iso);
  return match === null ? iso : `${match[1]} ${match[2]} UTC`;
}
