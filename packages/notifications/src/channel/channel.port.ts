/**
 * The notification channel boundary (EPIC-17 [[NOTIF-002]], [[DEC-061]]).
 *
 * PRD §24 names two channels, `EMAIL` and `WHATSAPP`, and they are two ways to
 * deliver one thing rather than two domains. This port is the whole division: a
 * channel is a provider behind one boundary, and the delivery aggregate, the
 * queue and the lifecycle stay channel-agnostic.
 *
 * The recipient arrives as a resolved datum and leaves with the call. Its
 * classification is RESTRICTED (PRD §41): `send` is the only function that ever
 * sees it, and neither a log, an error, the delivery record nor a job payload
 * may carry it ([[DEC-061]]).
 */

/** The two channels PRD §24 names, matching the `notification_channel` enum. */
export const NOTIFICATION_CHANNEL_VALUES = Object.freeze(["EMAIL", "WHATSAPP"] as const);

export type NotificationChannel = (typeof NOTIFICATION_CHANNEL_VALUES)[number];

/**
 * The provider ids a channel can be built from. The environment's strings are
 * deliberately different (`fake`, `smtp`, `whatsapp-cloud`): the two vocabularies
 * differ because the environment one is a deployment contract that renaming a
 * provider must not break (the `FISCAL_PROVIDER` precedent).
 */
export const NOTIFICATION_CHANNEL_PROVIDER_IDS = Object.freeze([
  "FAKE",
  "SMTP",
  "WHATSAPP_CLOUD",
] as const);

export type NotificationChannelProviderId = (typeof NOTIFICATION_CHANNEL_PROVIDER_IDS)[number];

/**
 * One send attempt's input.
 *
 * `parameters` exists because the two channels do not carry the same kind of
 * message and pretending otherwise would be a lie in the contract. An email is
 * rendered text; a business-initiated WhatsApp message must be an
 * operator-approved **template** with positional values, and an approved
 * template's text cannot be replaced at send time. So `subject` and `body` are
 * what a text channel renders, and `parameters` are the ordered values a
 * template channel substitutes. Each adapter documents which half it reads.
 */
export interface NotificationChannelRequest {
  readonly tenantId: string;
  /** The delivery's own id, so a failure correlates without carrying content. */
  readonly deliveryId: string;
  /** The resolved RESTRICTED datum. This call frame is the only place it lives. */
  readonly recipient: string;
  /** The rendered subject. Text channels only. */
  readonly subject: string;
  /** The rendered body. Text channels only. */
  readonly body: string;
  /** Ordered template values, for a channel whose message is a template. */
  readonly parameters: readonly string[];
}

/**
 * What one attempt produced, in the vocabulary the delivery lifecycle uses
 * ([[NOTIF-001]]): `SENT` is terminal, and a `FAILED` says whether the queue may
 * retry it or the record must settle on `FAILED`.
 *
 * A failure carries a bounded, sanitized `reasonCode` and `reason` — never a
 * provider payload, and never the recipient. `retryable` is the adapter's own
 * classification because only it knows whether the transport refused the attempt
 * or the provider rejected the message.
 */
export type NotificationChannelOutcome =
  | {
      readonly outcome: "SENT";
      /** The provider's handle, when it issues one. Never the message. */
      readonly providerReference: string | null;
    }
  | {
      readonly outcome: "FAILED";
      readonly retryable: boolean;
      readonly reasonCode: string;
      readonly reason: string;
    };

/** One channel provider. Implementations are selected by configuration alone. */
export interface NotificationChannelPort {
  readonly providerId: NotificationChannelProviderId;
  send(request: NotificationChannelRequest): Promise<NotificationChannelOutcome>;
}

/**
 * Resolves the provider for a channel.
 *
 * A resolver rather than two injection tokens, because the caller that sends a
 * delivery holds the channel as DATA — it read it from the row — so it must be
 * able to look the provider up by value. Two tokens would force that caller into
 * a `switch` that duplicates the selection rule.
 */
export interface NotificationChannels {
  for(channel: NotificationChannel): NotificationChannelPort;
}

/** Injection token for the resolver the composition root builds. */
export const NOTIFICATION_CHANNELS = Symbol("NOTIFICATION_CHANNELS");

/**
 * Stable reason codes for a failed attempt.
 *
 * Domain-local strings rather than `ERROR_CODES` entries: that registry is a
 * frozen HTTP-facing contract, and none of these reaches an HTTP response — they
 * land on the delivery record as its failure of record.
 */
export const NOTIFICATION_CHANNEL_REASON = Object.freeze({
  /** The transport could not carry the attempt. The queue may retry it. */
  TRANSPORT_FAILURE: "CHANNEL_TRANSPORT_FAILURE",
  /** The provider accepted the call and rejected the message. Not retryable. */
  REJECTED: "CHANNEL_REJECTED",
} as const);
