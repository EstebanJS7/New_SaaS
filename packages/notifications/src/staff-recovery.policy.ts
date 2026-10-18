/**
 * The staff password-recovery message's identity (DAT-007, WU-C1).
 *
 * A pure policy, like the reminder's and the fiscal notice's, so the key is
 * derived the same way everywhere and the arithmetic is testable without a
 * database, a queue or a clock.
 *
 * **The channel is fixed and not configurable**, and the reason is the absence of
 * a decision rather than an omission: `appointmentReminderChannels` is named for
 * the reminder, and stretching it to cover this message would change the meaning
 * of a setting tenants have already stored. A reset link is also inherently an
 * email-shaped thing; a WhatsApp variant would need a template and a decision
 * nobody has taken.
 */
export const STAFF_RECOVERY_CHANNEL = "EMAIL" as const;

/**
 * The window a recovery request falls in: the instant truncated to the HOUR, UTC.
 *
 * The window exists because the delivery's dedupe key is unique per tenant and is
 * only released by `CANCELLED` — a spent message still holds its key. Without a
 * window, `fiscal`-style per-source keying would mean a profile could receive
 * **exactly one recovery email, ever**: the second request would find the key
 * still held by the `SENT` delivery and send nothing, and the user would wait
 * forever behind a message they may have deleted.
 *
 * It is an hour rather than a minute because the window is also the anti-abuse
 * budget: within one window a profile gets one message no matter how many times
 * the endpoint is called, so the endpoint cannot be turned into an email
 * amplifier against a known address. One message an hour is a defensible ceiling
 * for a form a person uses when they are stuck, and the requester who deletes the
 * mail is told to try again rather than silently getting nothing.
 */
export function staffRecoveryWindow(now: Date): string {
  return now.toISOString().slice(0, 13);
}

/** The delivery's logical identity: one recovery message per profile per hour. */
export function staffRecoveryDedupeKey(args: { userProfileId: string; now: Date }): string {
  return `staff-recovery:${args.userProfileId}:${staffRecoveryWindow(args.now)}`;
}
