"use client";

/**
 * Staff notification-delivery client. Every request uses the authenticated web
 * proxy; tenant authority stays server-side.
 *
 * The status and channel vocabularies MIRROR the database's enums and the API's
 * contract. `NOTIFICATION_DELIVERY_STATUSES` is listed in lifecycle order, which is
 * the order the filter renders.
 */
export type NotificationDeliveryStatus =
  "SCHEDULED" | "QUEUED" | "SENDING" | "SENT" | "FAILED" | "CANCELLED";
export const NOTIFICATION_DELIVERY_STATUSES = [
  "SCHEDULED",
  "QUEUED",
  "SENDING",
  "SENT",
  "FAILED",
  "CANCELLED",
] as const satisfies readonly NotificationDeliveryStatus[];

export type NotificationChannel = "EMAIL" | "WHATSAPP";
export const NOTIFICATION_CHANNELS = [
  "EMAIL",
  "WHATSAPP",
] as const satisfies readonly NotificationChannel[];

/** Allowlisted notification-delivery response; the contact datum and the message are never exposed. */
export interface NotificationDelivery {
  readonly id: string;
  readonly channel: string;
  readonly status: string;
  readonly sourceType: string;
  readonly sourceId: string;
  readonly recipientType: string;
  readonly recipientId: string;
  readonly scheduledAt: string;
  readonly attemptCount: number;
  readonly lastAttemptAt: string | null;
  readonly lastErrorCode: string | null;
  readonly lastErrorMessage: string | null;
  readonly providerReference: string | null;
  readonly sentAt: string | null;
  readonly cancelledAt: string | null;
  readonly cancellationReason: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export type NotificationSourceType = "APPOINTMENT" | "FISCAL_DOCUMENT";

/** One recorded attempt ([[TD-046]]). The DETAIL carries these; the list does not. */
export interface NotificationDeliveryAttempt {
  readonly attemptNumber: number;
  readonly outcome: string;
  readonly reasonCode: string | null;
  readonly reasonMessage: string | null;
  readonly occurredAt: string;
}

export interface NotificationDeliveryDetail extends NotificationDelivery {
  readonly attempts: readonly NotificationDeliveryAttempt[];
}

export interface NotificationDeliveryListFilters {
  readonly status?: NotificationDeliveryStatus;
  readonly channel?: NotificationChannel;
  /** The source reference: what the delivery was about. */
  readonly sourceType?: NotificationSourceType;
  readonly sourceId?: string;
}

interface ApiErrorEnvelope {
  readonly error?: { readonly code?: string; readonly message?: string };
}

export class ApiRequestError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = "ApiRequestError";
    this.code = code;
    this.status = status;
  }
}

async function parseError(response: Response): Promise<ApiRequestError> {
  const body = (await response.json().catch(() => ({}))) as ApiErrorEnvelope;
  return new ApiRequestError(
    body.error?.code ?? "UNKNOWN",
    body.error?.message ?? `Request failed (${response.status})`,
    response.status
  );
}

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(`/api/notifications${path}`, { cache: "no-store" });
  if (!response.ok) throw await parseError(response);
  return response.json() as Promise<T>;
}

export async function listNotificationDeliveries(
  filters: NotificationDeliveryListFilters = {}
): Promise<NotificationDelivery[]> {
  const params = new URLSearchParams();
  if (filters.status !== undefined) params.set("status", filters.status);
  if (filters.channel !== undefined) params.set("channel", filters.channel);
  if (filters.sourceType !== undefined) params.set("sourceType", filters.sourceType);
  if (filters.sourceId !== undefined) params.set("sourceId", filters.sourceId);
  const query = params.toString();
  const body = await getJson<{ deliveries: NotificationDelivery[] }>(
    `/deliveries${query ? `?${query}` : ""}`
  );
  return body.deliveries;
}

export function getNotificationDelivery(id: string): Promise<NotificationDeliveryDetail> {
  return getJson(`/deliveries/${id}`);
}

/** The permission denial is a first-class state, not an error to retry. */
export function isNotificationPermissionDenied(error: unknown): boolean {
  return error instanceof ApiRequestError && error.code === "FORBIDDEN";
}
