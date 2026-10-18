/**
 * Why a delivery failed BEFORE it reached a channel.
 *
 * Separate from `NOTIFICATION_CHANNEL_REASON`, which names what an adapter
 * reported. These are the delivery path's own settle reasons, and the
 * distinction matters for an operator: "the customer has no phone number" and
 * "the provider rejected the message" call for different actions.
 *
 * Every one of them is **non-retryable**. A retry re-reads the same rows and
 * reaches the same conclusion, so retrying one would only delay the record that
 * says what is actually wrong.
 *
 * Domain-local strings rather than `ERROR_CODES` entries: none of them reaches
 * an HTTP response; they land on the delivery record as its failure of record.
 */
export const NOTIFICATION_DELIVERY_REASON = Object.freeze({
  /** The reference names no active contact of the channel's kind. */
  RECIPIENT_UNRESOLVED: "NOTIFICATION_RECIPIENT_UNRESOLVED",
  /** The recipient reference's type has no reader. A bug, not a data state. */
  RECIPIENT_TYPE_UNSUPPORTED: "NOTIFICATION_RECIPIENT_TYPE_UNSUPPORTED",
  /** The tenant does not hold the channel's feature grant ([[DEC-058]]). */
  FEATURE_NOT_ENTITLED: "NOTIFICATION_FEATURE_NOT_ENTITLED",
  /** The content seam is not wired (or could not build this delivery). */
  CONTENT_UNAVAILABLE: "NOTIFICATION_CONTENT_UNAVAILABLE",
  /** The channel named by the row has no provider in this process. */
  CHANNEL_UNAVAILABLE: "NOTIFICATION_CHANNEL_UNAVAILABLE",
  /**
   * The delivery's SOURCE row is gone, foreign or unnameable at send time.
   *
   * The send-time read is the guarantee, so a source that cannot be read is a
   * settled state: retrying reads the same rows.
   */
  SOURCE_UNAVAILABLE: "NOTIFICATION_SOURCE_UNAVAILABLE",
  /** The appointment is cancelled, missed or completed: no reminder (DEC-060). */
  APPOINTMENT_NOT_SENDABLE: "NOTIFICATION_APPOINTMENT_NOT_SENDABLE",
  /** The fiscal document is not APPROVED: no notice (PRD §36). */
  FISCAL_DOCUMENT_NOT_APPROVED: "NOTIFICATION_FISCAL_DOCUMENT_NOT_APPROVED",
  /**
   * A gate threw before the message could be sent (TD-041 R3-001).
   *
   * The claim is committed before the gates run, so an unexpected throw used to
   * leave the row `SENDING` with a fresh lease, an incremented attempt count and
   * NO reason — an operator would see an attempt in progress with no explanation
   * and nothing able to touch it until the lease expired. This code is what the
   * row says instead.
   */
  GATE_FAILED: "NOTIFICATION_DELIVERY_GATE_FAILED",
} as const);

export type NotificationDeliveryReason =
  (typeof NOTIFICATION_DELIVERY_REASON)[keyof typeof NOTIFICATION_DELIVERY_REASON];
