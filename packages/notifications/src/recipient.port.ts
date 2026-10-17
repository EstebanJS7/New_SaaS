import type { NotificationChannel } from "./channel/channel.port.js";

/**
 * The recipient boundary: the delivery's stored REFERENCE resolved into the
 * RESTRICTED contact datum an adapter needs, at send time.
 *
 * It is a port rather than a Prisma call inside the handler for the reason
 * [[ADR-008]]'s credential port exists: the reader needs the application's own
 * database client, and this package deliberately depends on no persistence.
 *
 * **The datum is read at send time and never stored.** The delivery record keeps
 * the reference ([[NOTIF-001]]), the job payload carries no address, and the
 * adapter's call frame is the only place the value lives ([[DEC-061]], PRD §41).
 */

export interface NotificationRecipientReference {
  readonly tenantId: string;
  /** The delivery's `recipient_type`; today the enum has one member. */
  readonly recipientType: "CUSTOMER";
  /** The delivery's `recipient_id`. */
  readonly recipientId: string;
  /**
   * The channel decides WHICH contact datum is wanted: `EMAIL` reads the
   * customer's email contact, `WHATSAPP` the phone one. It is a required
   * argument rather than an optional hint so a caller cannot resolve "some"
   * contact and hand the wrong kind to an adapter.
   */
  readonly channel: NotificationChannel;
}

export interface NotificationRecipientPort {
  /**
   * Resolves the reference, or `null` when there is no deliverable contact.
   *
   * `null` is a settled, non-retryable outcome rather than an error: a customer
   * with no active contact of that kind is a data state a retry cannot change.
   */
  resolve(reference: NotificationRecipientReference): Promise<{ address: string } | null>;
}

/** Injection token for the recipient reader the composition root supplies. */
export const NOTIFICATION_RECIPIENT = Symbol("NOTIFICATION_RECIPIENT");

/**
 * The fail-closed default: it resolves nothing.
 *
 * A deployment or a test that wires no reader gets `null` for every reference,
 * so the delivery settles with `RECIPIENT_UNRESOLVED` instead of reaching an
 * adapter with an empty address — the shape the fiscal credential port uses for
 * a boundary it does not have.
 */
export function createNullNotificationRecipientPort(): NotificationRecipientPort {
  return {
    resolve: () => Promise.resolve(null),
  };
}
