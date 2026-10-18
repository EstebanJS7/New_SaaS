import type { NotificationChannel } from "./channel/channel.port.js";

/**
 * The appointment reminder's policy, as pure functions.
 *
 * [[DEC-060]] fixed the policy: 24 h before the appointment by default,
 * configurable per tenant, a BullMQ delayed job, idempotent by a dedupe key per
 * (appointment, channel, window), and cancelling the appointment removes the
 * pending job. This module is the policy's arithmetic — the part that must be
 * testable without a database, a queue or a clock — so the setting, the
 * scheduler and the cancellation path all derive the SAME key from the same
 * inputs rather than each building one.
 */

/**
 * The configured lead time's bounds, in hours.
 *
 * Exported so the settings namespace's zod schema and any caller validate
 * against ONE list: a per-site copy is a copy that drifts, and a lead time the
 * schema accepts but the scheduler refuses would be a setting that cannot be
 * honoured.
 *
 * A week is the upper bound because a longer lead makes "24 h before" a
 * different feature, and the lower bound is one hour because zero or negative
 * would make the reminder's scheduling a race with its own delivery.
 */
export const NOTIFICATION_REMINDER_LEAD_HOURS_MIN = 1;
export const NOTIFICATION_REMINDER_LEAD_HOURS_MAX = 168;
export const NOTIFICATION_REMINDER_LEAD_HOURS_DEFAULT = 24;

/**
 * The channels a reminder is sent on when the tenant configures none.
 *
 * `EMAIL` alone: it is the ungated channel ([[DEC-058]]), so a default that
 * included `WHATSAPP` would silently require an entitlement the tenant may not
 * hold. The set is a tenant choice and its values are not validated for
 * entitlements here — the authoritative gate is the send path, and the
 * scheduler's own check is where an unentitled channel is refused before
 * anything is scheduled.
 */
export const NOTIFICATION_REMINDER_CHANNELS_DEFAULT = Object.freeze(["EMAIL"] as const);

/** The channels a reminder may be configured for. */
export const NOTIFICATION_REMINDER_CHANNELS = Object.freeze(["EMAIL", "WHATSAPP"] as const);

/**
 * The window a reminder belongs to, derived from the appointment's START INSTANT.
 *
 * Truncated to the minute so a reschedule that only moves a few seconds is the
 * same window, and so the key is stable across two reads of the same row. A
 * reschedule to a different instant is a DIFFERENT window on purpose: the
 * dedupe key must not suppress a legitimately new reminder ([[DEC-060]]).
 */
export function reminderWindowKey(startsAt: Date): string {
  const truncated = new Date(Math.floor(startsAt.getTime() / 60_000) * 60_000);
  return truncated.toISOString();
}

export interface ReminderDedupeKeyArgs {
  readonly appointmentId: string;
  readonly channel: NotificationChannel;
  readonly startsAt: Date;
}

/**
 * The dedupe key for one reminder: `(appointment, channel, window)`.
 *
 * This is the string the partial unique index on `(tenant_id, dedupe_key)`
 * enforces, so two schedulers racing the same reminder produce one row and one
 * job. It carries no contact datum and no tenant id — the tenant is the row's
 * own column, and a key that repeated it would be a key that could disagree with
 * it.
 */
export function reminderDedupeKey(args: ReminderDedupeKeyArgs): string {
  return `appointment:${args.appointmentId}:${args.channel}:${reminderWindowKey(args.startsAt)}`;
}

/**
 * When the reminder becomes due: the appointment's start minus the lead time.
 *
 * Pure, and takes the lead time rather than reading a setting: the caller owns
 * the tenant's configuration, and a policy function that fetched it would be one
 * that could not be tested without a database.
 */
export function reminderScheduledAt(startsAt: Date, leadHours: number): Date {
  // BOTH bounds, which TD-043 closed: the ceiling the module exports was not
  // enforced here, so a caller passing a very large lead would get a silently
  // wrong date from the function whose arithmetic is supposed to be the policy.
  if (
    !Number.isInteger(leadHours) ||
    leadHours < NOTIFICATION_REMINDER_LEAD_HOURS_MIN ||
    leadHours > NOTIFICATION_REMINDER_LEAD_HOURS_MAX
  ) {
    throw new Error(
      `A reminder lead time must be a whole number of hours between ${NOTIFICATION_REMINDER_LEAD_HOURS_MIN} and ${NOTIFICATION_REMINDER_LEAD_HOURS_MAX}.`
    );
  }
  return new Date(startsAt.getTime() - leadHours * 60 * 60 * 1_000);
}

/**
 * Whether a reminder's scheduled instant has already passed.
 *
 * A delivery scheduled in the past is enqueued with no delay rather than
 * refused, so a tenant that shortens its lead time on an appointment starting in
 * two hours gets a reminder now instead of an error (the job options clamp the
 * delay at zero for the same reason).
 */
export function isReminderOverdue(scheduledAt: Date, now: Date): boolean {
  return scheduledAt.getTime() <= now.getTime();
}
