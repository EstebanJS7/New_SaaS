import { z } from "zod";
import type { NotificationDeliveryStatus } from "@newsaas/notifications";

/**
 * The delivery read contract ([[NOTIF-004]]).
 *
 * Two properties are the DTO's whole job:
 *
 * 1. **It is an allowlist.** Every field below is named in the mapper, and the
 *    recipient is a REFERENCE (`recipientId`), never the contact datum the channel
 *    boundary resolves at send time (PRD §41). Nothing serializes a Prisma model,
 *    so a column added later cannot leak by appearing.
 * 2. **It carries no message content.** The message is built at send time and never
 *    stored ([[NOTIF-003]]), so there is nothing to expose — and the failure reason
 *    it does carry is the one already bounded and newline-flattened at write time.
 */

/** The list's default page size, and its ceiling. */
export const NOTIFICATION_DELIVERY_LIST_LIMIT_DEFAULT = 50;
export const NOTIFICATION_DELIVERY_LIST_LIMIT_MAX = 100;

/** The statuses a filter may name, spelled from the aggregate's own union. */
export const NOTIFICATION_DELIVERY_STATUSES = Object.freeze([
  "SCHEDULED",
  "QUEUED",
  "SENDING",
  "SENT",
  "FAILED",
  "CANCELLED",
] as const satisfies readonly NotificationDeliveryStatus[]);

export const NOTIFICATION_DELIVERY_CHANNELS = Object.freeze(["EMAIL", "WHATSAPP"] as const);

/** The sources a delivery can carry. The filter names the same union as the column. */
export const NOTIFICATION_DELIVERY_SOURCE_TYPES = Object.freeze([
  "APPOINTMENT",
  "FISCAL_DOCUMENT",
] as const);

/**
 * The list query, as a closed schema.
 *
 * `limit` is BOUNDED at the contract rather than left to the caller: [[TD-026]]
 * records unbounded list endpoints as open debt, and a new surface must not worsen
 * it. An oversized value is refused, not clamped silently.
 */
export const notificationDeliveryListQuerySchema = z
  .object({
    status: z.enum(NOTIFICATION_DELIVERY_STATUSES).optional(),
    channel: z.enum(NOTIFICATION_DELIVERY_CHANNELS).optional(),
    /**
     * The source reference: what this delivery was ABOUT. An operator asking "what
     * did we send for this appointment" is the surface's central question, and it is
     * answerable without a join because the reference is denormalised onto the row.
     */
    sourceType: z.enum(NOTIFICATION_DELIVERY_SOURCE_TYPES).optional(),
    sourceId: z.string().uuid().optional(),
    limit: z.coerce.number().int().min(1).max(NOTIFICATION_DELIVERY_LIST_LIMIT_MAX).optional(),
  })
  .strict();

export type NotificationDeliveryListQuery = z.infer<typeof notificationDeliveryListQuerySchema>;

/** The allowlisted delivery projection. */
export interface NotificationDeliveryResponse {
  readonly id: string;
  readonly channel: string;
  readonly status: string;
  readonly sourceType: string;
  readonly sourceId: string;
  readonly recipientType: string;
  /** A reference. The channel boundary resolves it; the datum is never read here. */
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

/** The columns the projection reads, and nothing else. */
export interface NotificationDeliveryRow {
  readonly id: string;
  readonly channel: string;
  readonly status: string;
  readonly sourceType: string;
  readonly sourceId: string;
  readonly recipientType: string;
  readonly recipientId: string;
  readonly scheduledAt: Date;
  readonly attemptCount: number;
  readonly lastAttemptAt: Date | null;
  readonly lastErrorCode: string | null;
  readonly lastErrorMessage: string | null;
  readonly providerReference: string | null;
  readonly sentAt: Date | null;
  readonly cancelledAt: Date | null;
  readonly cancellationReason: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/** Maps one row to the allowlisted projection. Every exposed field is named here. */
export function toNotificationDeliveryResponse(
  row: NotificationDeliveryRow
): NotificationDeliveryResponse {
  return {
    id: row.id,
    channel: row.channel,
    status: row.status,
    sourceType: row.sourceType,
    sourceId: row.sourceId,
    recipientType: row.recipientType,
    recipientId: row.recipientId,
    scheduledAt: row.scheduledAt.toISOString(),
    attemptCount: row.attemptCount,
    lastAttemptAt: row.lastAttemptAt?.toISOString() ?? null,
    lastErrorCode: row.lastErrorCode,
    lastErrorMessage: row.lastErrorMessage,
    providerReference: row.providerReference,
    sentAt: row.sentAt?.toISOString() ?? null,
    cancelledAt: row.cancelledAt?.toISOString() ?? null,
    cancellationReason: row.cancellationReason,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
