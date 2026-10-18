import type { NotificationDeliveryStatus } from "./notifications-api";

/**
 * Presentation vocabulary for the notification surface. Semantic tokens only: no
 * tenant or product brand literal appears here, and the labels are plain words
 * rather than the enum's SCREAMING_CASE.
 */
export const NOTIFICATION_STATUS_LABELS: Readonly<Record<NotificationDeliveryStatus, string>> = {
  SCHEDULED: "Scheduled",
  QUEUED: "Queued",
  SENDING: "Sending",
  SENT: "Sent",
  FAILED: "Failed",
  CANCELLED: "Cancelled",
};

export const NOTIFICATION_CHANNEL_LABELS: Readonly<Record<string, string>> = {
  EMAIL: "Email",
  WHATSAPP: "WhatsApp",
};

export const NOTIFICATION_SOURCE_LABELS: Readonly<Record<string, string>> = {
  APPOINTMENT: "Appointment",
  FISCAL_DOCUMENT: "Fiscal document",
};

/** Shared input styling, token-based like every other surface. */
export const notificationInputClassName =
  "h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function shortId(id: string): string {
  return id.slice(0, 8);
}

export function formatTimestamp(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

/** A failed delivery shows a bounded reason; there is no raw provider message to offer. */
export function deliveryFailureReason(delivery: {
  readonly lastErrorCode: string | null;
  readonly lastErrorMessage: string | null;
}): string | null {
  if (delivery.lastErrorCode === null && delivery.lastErrorMessage === null) return null;
  return delivery.lastErrorMessage ?? delivery.lastErrorCode ?? "Delivery failed.";
}
