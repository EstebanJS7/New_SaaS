import type { NotificationChannel } from "./channel/channel.port.js";

/**
 * The post-approval fiscal notice PRD §36's journey ends a step with: its channel
 * and its de-duplication key.
 */

/**
 * The channel a fiscal notice goes out on, and it is FIXED rather than
 * configurable.
 *
 * The reason is the absence of a decision rather than a preference: the
 * `notifications` settings namespace has `appointmentReminderChannels`, whose name
 * says what the tenant chose it FOR, and stretching it to cover fiscal notices
 * would change what a stored setting means without anybody deciding that. Email is
 * the ungated channel ([[DEC-058]]), so a fixed email notice is available to every
 * tenant today.
 *
 * A general transactional channel set is the honest answer once a second consumer
 * justifies the namespace version bump it needs; until then the notice is email
 * and says so here rather than inventing a tenant preference.
 */
export const FISCAL_NOTICE_CHANNEL: NotificationChannel = "EMAIL";

/**
 * The dedupe key for one fiscal notice: `(document, channel)`.
 *
 * No window, unlike the reminder's: a document is approved once, and the document
 * is the whole identity of the intent. The key carries no contact datum, and it
 * does not repeat the tenant — the row's own column is the tenant.
 */
export function fiscalNoticeDedupeKey(args: {
  readonly fiscalDocumentId: string;
  readonly channel: NotificationChannel;
}): string {
  return `fiscal:${args.fiscalDocumentId}:${args.channel}`;
}
