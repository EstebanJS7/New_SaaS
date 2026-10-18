/**
 * The notification delivery lifecycle, mirrored from the database.
 *
 * The authoritative guard is `notification_delivery_transition_guard` in the
 * migration, and `notification_delivery_terminal_immutable` beside it. This
 * module exists so application code can refuse an illegal edge BY NAME before
 * reaching the database, and so a caller can ask what the aggregate permits
 * without a round trip — never so the database rule can be relaxed.
 *
 * The two must therefore move together. `NOTIFICATION_DELIVERY_TRANSITIONS`
 * lists the SAME edges the SQL guard admits, and the schema gate in
 * `packages/database/src/schema-notification-delivery.test.ts` asserts the SQL
 * side of every one of them, so a divergence fails a test rather than surfacing
 * as a `restrict_violation` in production.
 */

export const NOTIFICATION_DELIVERY_STATUSES = Object.freeze([
  "SCHEDULED",
  "QUEUED",
  "SENDING",
  "SENT",
  "FAILED",
  "CANCELLED",
] as const);

export type NotificationDeliveryStatus = (typeof NOTIFICATION_DELIVERY_STATUSES)[number];

/**
 * Every status CHANGE the database admits, keyed by the status being left.
 *
 * `SCHEDULED -> SENDING` is here on purpose, and it is not a convenience: the
 * producer records `QUEUED` after the enqueue succeeds, and if that write is
 * lost the job is in the queue anyway. Omitting the edge would leave a real
 * pending job whose claim the database rejects, which is a wedge rather than a
 * protection.
 *
 * `SENT`, `FAILED` and `CANCELLED` have no outgoing edge. `FAILED` is
 * deliberately still writable in place -- the database has no re-drive edge, but
 * it does not freeze the row either, so an approved re-drive is an added edge
 * plus a decision rather than a rewrite (the BILL-001 lesson).
 */
export const NOTIFICATION_DELIVERY_TRANSITIONS: Readonly<
  Record<NotificationDeliveryStatus, readonly NotificationDeliveryStatus[]>
> = Object.freeze({
  SCHEDULED: Object.freeze(["QUEUED", "SENDING", "CANCELLED"] as const),
  QUEUED: Object.freeze(["SENDING", "CANCELLED"] as const),
  SENDING: Object.freeze(["SENT", "FAILED"] as const),
  SENT: Object.freeze([] as const),
  FAILED: Object.freeze([] as const),
  CANCELLED: Object.freeze([] as const),
});

/**
 * The statuses the database FREEZES outright: no update of any kind, not even a
 * same-status one.
 *
 * `FAILED` is absent, and that absence is the difference between "no outgoing
 * edge" and "not editable state". This list is the SQL
 * `notification_delivery_terminal_immutable` list; keeping it here is what lets
 * {@link canTransitionNotificationDelivery} answer for BOTH database mechanisms
 * instead of only the edge graph.
 */
export const NOTIFICATION_DELIVERY_FROZEN_STATUSES = Object.freeze(["SENT", "CANCELLED"] as const);

/** Whether a delivery is settled: no further status is reachable from it. */
export function isNotificationDeliverySettled(status: NotificationDeliveryStatus): boolean {
  return NOTIFICATION_DELIVERY_TRANSITIONS[status].length === 0;
}

/** Whether a delivery is frozen: the row may not be updated at all. */
export function isNotificationDeliveryFrozen(status: NotificationDeliveryStatus): boolean {
  return (NOTIFICATION_DELIVERY_FROZEN_STATUSES as readonly string[]).includes(status);
}

/**
 * Whether the database would accept this write.
 *
 * An UNCHANGED status is admitted when the row is not frozen, and that is the
 * load-bearing case rather than an oversight: a same-status update is how the
 * claim's lease is refreshed and how a retryable failure records its reason
 * while the row stays `SENDING` for BullMQ's next attempt. The SQL transition
 * guard constrains status CHANGES only, which is why `SENDING -> SENDING` needs
 * no edge there -- and why freezing is a separate trigger instead of an absence
 * of edges.
 */
export function canTransitionNotificationDelivery(
  from: NotificationDeliveryStatus,
  to: NotificationDeliveryStatus
): boolean {
  if (from === to) {
    return !isNotificationDeliveryFrozen(from);
  }
  return NOTIFICATION_DELIVERY_TRANSITIONS[from].includes(to);
}

/** Stable code for a refused lifecycle edge, mirroring the database's reason. */
export const NOTIFICATION_DELIVERY_TRANSITION_NOT_ALLOWED =
  "NOTIFICATION_DELIVERY_TRANSITION_NOT_ALLOWED";

/**
 * A refused lifecycle write, raised before the database sees it.
 *
 * It is a domain-local error rather than a shared `ERROR_CODES` entry: the
 * shared registry is a frozen HTTP-facing contract, and this failure is a
 * persistence invariant, not an API status (the `DteSchemaError` precedent).
 */
export class NotificationDeliveryTransitionError extends Error {
  readonly code = NOTIFICATION_DELIVERY_TRANSITION_NOT_ALLOWED;
  readonly from: NotificationDeliveryStatus;
  readonly to: NotificationDeliveryStatus;

  constructor(from: NotificationDeliveryStatus, to: NotificationDeliveryStatus) {
    super(`notification delivery transition from ${from} to ${to} is not allowed`);
    this.name = "NotificationDeliveryTransitionError";
    this.from = from;
    this.to = to;
  }
}

/** Throws {@link NotificationDeliveryTransitionError} for an edge the guard refuses. */
export function assertNotificationDeliveryTransition(
  from: NotificationDeliveryStatus,
  to: NotificationDeliveryStatus
): void {
  if (!canTransitionNotificationDelivery(from, to)) {
    throw new NotificationDeliveryTransitionError(from, to);
  }
}
