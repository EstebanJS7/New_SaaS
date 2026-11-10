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
/**
 * The closed allowlist of attachment content types ([[DEC-098]]).
 *
 * One entry today: the KuDE, an HTML document. A new type is a contract change
 * that names its own filename extension in {@link ATTACHMENT_FILENAME_PATTERNS}.
 */
export const NOTIFICATION_ATTACHMENT_CONTENT_TYPES = Object.freeze([
  "text/html; charset=utf-8",
] as const);

export type NotificationAttachmentContentType =
  (typeof NOTIFICATION_ATTACHMENT_CONTENT_TYPES)[number];

/** At most one attachment per message: the fiscal notice carries its own KuDE only. */
export const NOTIFICATION_ATTACHMENT_MAX_COUNT = 1;

/**
 * The byte cap for one attachment: 512 KiB.
 *
 * A KuDE is a few kilobytes of HTML plus an inline SVG QR, so the cap is far
 * above any real document and far below what a relay refuses; anything larger is
 * not a KuDE the worker rendered.
 */
export const NOTIFICATION_ATTACHMENT_MAX_BYTES = 512 * 1024;

/**
 * Our own filename rule, per content type: a short `[A-Za-z0-9-]` stem and the
 * type's extension. No dot in the stem, no slash, no whitespace and no control
 * character, so a filename can never name a path or break a MIME header.
 */
const ATTACHMENT_FILENAME_PATTERNS: Readonly<Record<NotificationAttachmentContentType, RegExp>> = {
  "text/html; charset=utf-8": /^[A-Za-z0-9][A-Za-z0-9-]{0,63}\.html$/,
};

/**
 * One in-memory attachment ([[DEC-098]]).
 *
 * The bytes travel IN the request, never as a path or a URL: that is what keeps
 * [[ADR-011]] guardrail 3 (`disableFileAccess`, `disableUrlAccess`) intact. The
 * content is CONFIDENTIAL (a KuDE carries the receptor's data), so like the
 * recipient it lives in this call frame only — never in a log, an error, the
 * delivery record or a job payload.
 */
export interface NotificationChannelAttachment {
  readonly filename: string;
  readonly contentType: NotificationAttachmentContentType;
  /** The bytes themselves. A `Buffer` is a `Uint8Array`. */
  readonly content: Uint8Array;
}

/**
 * Whether one value is exactly an attachment the contract admits: the three keys
 * and no other (a `path` or `href` beside them is refused, not ignored), an
 * allowlisted type, a filename our pattern accepts, and 1..cap bytes.
 */
export function isAcceptableNotificationAttachment(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const keys = Object.keys(value).sort();
  if (keys.length !== 3 || keys.join(",") !== "content,contentType,filename") return false;
  const candidate = value as { filename: unknown; contentType: unknown; content: unknown };
  if (
    typeof candidate.contentType !== "string" ||
    !(NOTIFICATION_ATTACHMENT_CONTENT_TYPES as readonly string[]).includes(candidate.contentType)
  ) {
    return false;
  }
  const pattern =
    ATTACHMENT_FILENAME_PATTERNS[candidate.contentType as NotificationAttachmentContentType];
  if (typeof candidate.filename !== "string" || !pattern.test(candidate.filename)) return false;
  if (!(candidate.content instanceof Uint8Array)) return false;
  return (
    candidate.content.byteLength > 0 &&
    candidate.content.byteLength <= NOTIFICATION_ATTACHMENT_MAX_BYTES
  );
}

/**
 * Whether a request's attachment list is inside the contract. An absent or empty
 * list is: it is the message every channel sent before attachments existed.
 */
export function areAcceptableNotificationAttachments(attachments: unknown): boolean {
  if (attachments === undefined) return true;
  if (!Array.isArray(attachments)) return false;
  if (attachments.length > NOTIFICATION_ATTACHMENT_MAX_COUNT) return false;
  return attachments.every((attachment) => isAcceptableNotificationAttachment(attachment));
}

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
  /**
   * Optional in-memory attachments ([[DEC-098]]), inside the contract above. A
   * channel that cannot carry one refuses the send rather than dropping it.
   */
  readonly attachments?: readonly NotificationChannelAttachment[];
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
  /**
   * The request's attachment is outside the attachment contract. A caller's
   * programming error, so not retryable: a retry sends the same attachment.
   */
  ATTACHMENT_REJECTED: "CHANNEL_ATTACHMENT_REJECTED",
  /** The channel cannot carry attachments at all (WhatsApp). Not retryable. */
  ATTACHMENT_UNSUPPORTED: "CHANNEL_ATTACHMENT_UNSUPPORTED",
} as const);

/** The one failure an attachment outside the contract produces, shared by the channels. */
export const NOTIFICATION_ATTACHMENT_REJECTED_OUTCOME: NotificationChannelOutcome = Object.freeze({
  outcome: "FAILED",
  retryable: false,
  reasonCode: NOTIFICATION_CHANNEL_REASON.ATTACHMENT_REJECTED,
  reason: "The message's attachment is outside the channel's attachment contract.",
});
