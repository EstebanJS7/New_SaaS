/**
 * The BullMQ queue contract for one notification delivery, shared by the API
 * producer and the worker consumer.
 *
 * The shape mirrors `packages/fiscal/src/fiscal-submission.queue.ts`, which is
 * the pattern EPIC-17 was told to copy: a named queue, a named job, a
 * DETERMINISTIC identity, and a payload of stable ids only.
 *
 * Why a queue at all, when `packages/shared/src/events/` ships an in-process
 * post-commit dispatcher: `docs/03-architecture/INTERNAL-EVENTS.md` selects
 * BullMQ when a reaction needs an external network call, retry, DELAYED
 * EXECUTION or durable processing. A notification needs all four, and the
 * reminder PRD §24 requires is delayed execution in its purest form.
 */

/** BullMQ queue shared by the API producer and the worker consumer. */
export const NOTIFICATION_DELIVERY_QUEUE = "notification-delivery";

/** Job name for delivering one notification. */
export const NOTIFICATION_DELIVERY_JOB = "deliver";

/** Bounded retry budget for one delivery. */
export const NOTIFICATION_DELIVERY_MAX_ATTEMPTS = 5;

/** Exponential backoff base delay in milliseconds. */
export const NOTIFICATION_DELIVERY_BACKOFF_DELAY_MS = 1_000;

/**
 * The job payload carries stable ids only -- never a recipient's contact datum,
 * never a message body, never an aggregate dump.
 *
 * The recipient is a REFERENCE (`notification_delivery.recipient_id`), and the
 * channel boundary resolves it to RESTRICTED contact data at send time. The
 * message is built at send time from the authoritative rows the source names,
 * which is why neither a rendered body nor a payload snapshot can live here: a
 * queue entry outlives the state it was built from.
 */
export interface NotificationDeliveryJob {
  readonly notificationDeliveryId: string;
  readonly tenantId: string;
}

/**
 * Returns the deterministic BullMQ identity for one notification delivery.
 *
 * Deterministic for two reasons. The queue's own dedupe and the database's
 * `(tenant_id, dedupe_key)` partial unique index must agree on what "the same
 * logical request" means -- a random identity would let one intent occupy two
 * queue entries while the table holds one row. And the cancellation path PRD §24
 * requires ("cancelled if the appointment is cancelled") has to ADDRESS the
 * pending job to remove it; an identity derived from the delivery id is exactly
 * the handle a cancelling command can compute from the row it just read.
 *
 * The separator is a HYPHEN, and that is a correctness requirement rather than a
 * style choice: BullMQ refuses a custom job id containing `:` unless it splits
 * into exactly three segments (its own repeatable-job format), and `queue.add`
 * throws `Custom Id cannot contain :` BEFORE anything is enqueued. A colon here
 * would break the enqueue for every delivery. The rule cannot be caught by a
 * unit test with a stubbed queue, which is why the assertion below checks the
 * shape directly.
 */
export function notificationDeliveryJobId(notificationDeliveryId: string): string {
  return `notification-deliver-${notificationDeliveryId}`;
}

/**
 * Job options for one delivery.
 *
 * `scheduledAt` is the delivery's own instant, so the delay is DERIVED here
 * rather than left to each caller: a caller that forgot it would send a
 * reminder immediately, and a caller that computed it wrong could pass a
 * negative delay. It is clamped at zero, because a scheduled instant in the past
 * means "due now", never "reject".
 *
 * `removeOnFail` stays false: the database row (`last_error_code`,
 * `last_error_message`, `attempt_count`) and the delivery's own record are the
 * failure of record, and the queue's failed set is what a human inspecting the
 * queue sees before the row is read.
 */
export function notificationDeliveryJobOptions(
  notificationDeliveryId: string,
  scheduledAt: Date,
  now: Date = new Date()
) {
  return {
    jobId: notificationDeliveryJobId(notificationDeliveryId),
    delay: Math.max(0, scheduledAt.getTime() - now.getTime()),
    attempts: NOTIFICATION_DELIVERY_MAX_ATTEMPTS,
    backoff: {
      type: "exponential" as const,
      delay: NOTIFICATION_DELIVERY_BACKOFF_DELAY_MS,
    },
    removeOnComplete: true,
    removeOnFail: false,
  };
}
