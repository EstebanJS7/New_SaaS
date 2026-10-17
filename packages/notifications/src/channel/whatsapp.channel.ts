import {
  NOTIFICATION_CHANNEL_REASON,
  type NotificationChannelOutcome,
  type NotificationChannelPort,
  type NotificationChannelRequest,
} from "./channel.port.js";

/**
 * The `WHATSAPP` channel over the WhatsApp Business Cloud API (PRD §24).
 *
 * **No dependency**: a transactional send is an authenticated JSON POST, and
 * `fetch` is in Node. This is also why [[ADR-011]] chose SMTP for email rather
 * than reusing this shape — here there is no protocol to own, so a vendor's API
 * costs nothing extra; there, SMTP's portability is what money buys.
 *
 * **A business-initiated message must be an approved template.** WhatsApp allows
 * free-form text only inside an open customer-service window, and a reminder is
 * business-initiated. So this adapter sends the operator's approved template
 * with the request's ordered `parameters`, and the request's rendered `body` is
 * ignored by design: an approved template's text cannot be replaced at send
 * time. That is a policy constraint of the channel, not a gap in this adapter,
 * and it is why `NotificationChannelRequest` carries both halves.
 */

export interface WhatsAppCloudConfig {
  readonly token: string;
  readonly phoneNumberId: string;
  readonly templateName: string;
  readonly templateLanguage: string;
  /** Overridable for a test or a proxy; the Cloud API's host otherwise. */
  readonly baseUrl?: string | undefined;
}

export const WHATSAPP_CLOUD_DEFAULT_BASE_URL = "https://graph.facebook.com/v21.0";

/** The slice of `fetch` this adapter uses. */
export type WhatsAppFetch = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body: string;
    signal?: AbortSignal;
  }
) => Promise<{ status: number; text(): Promise<string> }>;

export interface WhatsAppCloudChannelOptions {
  readonly config: WhatsAppCloudConfig;
  readonly fetchImpl?: WhatsAppFetch;
  /** Bounds one attempt so a hanging provider cannot hold a worker slot. */
  readonly timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * A conservative E.164-shaped check.
 *
 * Same reasoning as the email adapter's: the recipient is the one string handed
 * to a third party, so it is validated to a shape that cannot carry a header, a
 * separator or a second recipient. A rejected number is a caller failure and
 * never a retry.
 */
export function isDeliverablePhoneNumber(value: string): boolean {
  if (!/^\+?[1-9][0-9]{6,14}$/.test(value)) return false;
  return true;
}

/** Maps an HTTP answer or a transport failure to the delivery lifecycle. */
export function classifyWhatsAppFailure(status: number | null): {
  readonly retryable: boolean;
  readonly reasonCode: string;
  readonly reason: string;
} {
  if (status === null) {
    return {
      retryable: true,
      reasonCode: NOTIFICATION_CHANNEL_REASON.TRANSPORT_FAILURE,
      reason: "The WhatsApp Cloud API could not be reached.",
    };
  }
  if (status === 429 || status >= 500) {
    return {
      retryable: true,
      reasonCode: NOTIFICATION_CHANNEL_REASON.TRANSPORT_FAILURE,
      reason: `The WhatsApp Cloud API returned ${status}.`,
    };
  }
  return {
    retryable: false,
    reasonCode: NOTIFICATION_CHANNEL_REASON.REJECTED,
    reason: `The WhatsApp Cloud API rejected the message (${status}).`,
  };
}

export function createWhatsAppCloudChannel(
  options: WhatsAppCloudChannelOptions
): NotificationChannelPort {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const baseUrl = options.config.baseUrl ?? WHATSAPP_CLOUD_DEFAULT_BASE_URL;

  return {
    providerId: "WHATSAPP_CLOUD",
    async send(request: NotificationChannelRequest): Promise<NotificationChannelOutcome> {
      if (!isDeliverablePhoneNumber(request.recipient)) {
        return {
          outcome: "FAILED",
          retryable: false,
          reasonCode: NOTIFICATION_CHANNEL_REASON.REJECTED,
          reason: "The resolved recipient is not a deliverable WhatsApp number.",
        };
      }
      if (request.parameters.length === 0) {
        // An approved template with unfilled placeholders is a template
        // violation the provider bills us for; refusing it here keeps the
        // failure attributable to us rather than to WhatsApp.
        return {
          outcome: "FAILED",
          retryable: false,
          reasonCode: NOTIFICATION_CHANNEL_REASON.REJECTED,
          reason: "A template message requires at least one parameter.",
        };
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      timer.unref();

      try {
        const response = await fetchImpl(`${baseUrl}/${options.config.phoneNumberId}/messages`, {
          method: "POST",
          headers: {
            // The token never enters a log, an error or the delivery record.
            Authorization: `Bearer ${options.config.token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            messaging_product: "whatsapp",
            to: request.recipient,
            type: "template",
            template: {
              name: options.config.templateName,
              language: { code: options.config.templateLanguage },
              components: [
                {
                  type: "body",
                  parameters: request.parameters.map((text) => ({ type: "text", text })),
                },
              ],
            },
          }),
          signal: controller.signal,
        });

        if (response.status < 200 || response.status >= 300) {
          return { outcome: "FAILED", ...classifyWhatsAppFailure(response.status) };
        }

        // The body is read only for the provider's message id, and a body that
        // does not carry one is not a failure: the message was accepted.
        const raw = await response.text();
        return { outcome: "SENT", providerReference: readMessageId(raw) };
      } catch {
        // No error text: a transport error's message is the one field that could
        // have echoed the recipient or the token.
        return { outcome: "FAILED", ...classifyWhatsAppFailure(null) };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

/** Reads `messages[0].id` without letting a malformed body throw. */
function readMessageId(raw: string): string | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    const messages = (parsed as { messages?: unknown }).messages;
    if (!Array.isArray(messages) || messages.length === 0) return null;
    const id = (messages[0] as { id?: unknown }).id;
    return typeof id === "string" && id.length > 0 ? id : null;
  } catch {
    return null;
  }
}
