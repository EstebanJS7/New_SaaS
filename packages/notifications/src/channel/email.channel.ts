import { createTransport } from "nodemailer";
import {
  NOTIFICATION_CHANNEL_REASON,
  type NotificationChannelOutcome,
  type NotificationChannelPort,
  type NotificationChannelRequest,
} from "./channel.port.js";

/**
 * The `EMAIL` channel over SMTP, the only file that imports `nodemailer`
 * ([[ADR-011]], guardrail 7).
 *
 * SMTP is a protocol rather than a vendor, so this adapter works with a
 * provider, a corporate relay or a tenant's own server without any of their
 * request shapes entering our code.
 */

export interface SmtpEmailConfig {
  readonly host: string;
  readonly port: number;
  readonly secure: boolean;
  readonly user: string;
  readonly password: string;
  readonly from: string;
}

/** The slice of nodemailer's transport this adapter uses. */
export interface EmailTransport {
  sendMail(options: Record<string, unknown>): Promise<{ messageId?: string }>;
  close?(): void;
}

/**
 * Builds one transport. It is a seam rather than a detail because the adapter's
 * guardrails are about HOW a transport is obtained and used, and a test must be
 * able to prove them without a socket.
 */
export type EmailTransportFactory = (config: SmtpEmailConfig) => EmailTransport;

const defaultTransportFactory: EmailTransportFactory = (config) =>
  createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: { user: config.user, pass: config.password },
    /**
     * ADR-011 guardrail 2: never a shared transport.
     *
     * A process-global transport is how the library's own advisory
     * (GHSA-6vj9-mwq6-2f5v) disclosed SMTP credentials across tenants through a
     * shared DNS/TLS cache. `pool: false` keeps this connection to this send, and
     * the adapter builds a new transport per send on top of it. Our volume is
     * transactional — one reminder per appointment — so the connection cost is
     * affordable and correctness wins.
     */
    pool: false,
  });

export interface SmtpEmailChannelOptions {
  readonly config: SmtpEmailConfig;
  readonly transportFactory?: EmailTransportFactory;
}

/**
 * A conservative single-address check.
 *
 * It is deliberately stricter than RFC 5322 and it is **ours**, because the
 * address is the one string this adapter hands to a protocol implementation
 * whose parser has a history of advisories ([[ADR-011]]): the DoS issues require
 * an attacker-controlled address LIST, and the domain-bypass issues came from
 * RFC 5322 comment mis-parsing. Refusing whitespace, commas, semicolons,
 * angle brackets, every control character and a second `@` removes both classes
 * from reach before the library sees anything.
 *
 * A rejected address is a **caller** failure and never a retry: it settles the
 * delivery with a reason an operator can act on.
 */
export function isDeliverableEmailAddress(value: string): boolean {
  if (value.length === 0 || value.length > 254) return false;
  // No control characters at all: `\r` and `\n` are the header-injection pair,
  // and a codepoint loop states that without a regex the linter has to allow.
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) return false;
  }
  if (/[\s,;<>()[\]\\"]/.test(value)) return false;
  const parts = value.split("@");
  if (parts.length !== 2) return false;
  const [local, domain] = parts as [string, string];
  if (local.length === 0 || local.length > 64 || local.startsWith(".") || local.endsWith(".")) {
    return false;
  }
  if (!/^[A-Za-z0-9!#$%&'*+/=?^_`{|}~.-]+$/.test(local)) return false;
  if (
    !/^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)+$/.test(
      domain
    )
  ) {
    return false;
  }
  return domain.length <= 253;
}

/**
 * Classifies a transport failure without ever quoting the recipient.
 *
 * The classification is about what a retry can change:
 * - a connection-level failure is the transport's, and BullMQ may retry it;
 * - an SMTP `4xx` is a temporary refusal the provider invited us to repeat;
 * - an SMTP `5xx` is a decision that repeating cannot change;
 * - `EAUTH`, `EENVELOPE` and `EMESSAGE` without a response code are a
 *   configuration or message problem, not a transient one.
 *
 * The reason it reports is bounded and built from the error's own `code` and
 * `responseCode` only. The message text is deliberately not included: it is the
 * one field a library may have echoed the recipient into.
 */
export function classifyEmailFailure(error: unknown): {
  readonly retryable: boolean;
  readonly reasonCode: string;
  readonly reason: string;
} {
  const candidate = error as { code?: unknown; responseCode?: unknown } | null;
  const code = typeof candidate?.code === "string" ? candidate.code : null;
  const responseCode = typeof candidate?.responseCode === "number" ? candidate.responseCode : null;

  if (responseCode !== null && responseCode >= 500) {
    return {
      retryable: false,
      reasonCode: NOTIFICATION_CHANNEL_REASON.REJECTED,
      reason: `The SMTP server rejected the message (${responseCode}).`,
    };
  }
  if (responseCode !== null && responseCode >= 400) {
    return {
      retryable: true,
      reasonCode: NOTIFICATION_CHANNEL_REASON.TRANSPORT_FAILURE,
      reason: `The SMTP server deferred the message (${responseCode}).`,
    };
  }
  const transportCodes = new Set([
    "ECONNECTION",
    "ESOCKET",
    "ETIMEDOUT",
    "ECONNRESET",
    "EDNS",
    "EAI_AGAIN",
    "EPROTOCOL",
  ]);
  if (code !== null && transportCodes.has(code)) {
    return {
      retryable: true,
      reasonCode: NOTIFICATION_CHANNEL_REASON.TRANSPORT_FAILURE,
      reason: `The SMTP transport failed (${code}).`,
    };
  }
  return {
    retryable: false,
    reasonCode: NOTIFICATION_CHANNEL_REASON.REJECTED,
    reason:
      code === null
        ? "The SMTP transport refused the message."
        : `SMTP refused the message (${code}).`,
  };
}

export function createSmtpEmailChannel(options: SmtpEmailChannelOptions): NotificationChannelPort {
  const transportFactory = options.transportFactory ?? defaultTransportFactory;

  return {
    providerId: "SMTP",
    async send(request: NotificationChannelRequest): Promise<NotificationChannelOutcome> {
      if (!isDeliverableEmailAddress(request.recipient)) {
        // The address is never echoed, not even in a shape complaint: a reason
        // travels to the delivery record and from there into an operator's view.
        return {
          outcome: "FAILED",
          retryable: false,
          reasonCode: NOTIFICATION_CHANNEL_REASON.REJECTED,
          reason: "The resolved recipient is not a deliverable email address.",
        };
      }

      let transport: EmailTransport;
      try {
        // Per send, on purpose (guardrail 2).
        transport = transportFactory(options.config);
      } catch (error) {
        return { outcome: "FAILED", ...classifyEmailFailure(error) };
      }

      try {
        const result = await transport.sendMail({
          from: options.config.from,
          // Exactly one address, and ours (guardrail 5). Never a list, never a
          // caller-supplied header value.
          to: request.recipient,
          subject: request.subject,
          text: request.body,
          // ADR-011 guardrail 3: a message can never make the library read a
          // file or a URL (GHSA-8m3c-c648-2xjj).
          disableFileAccess: true,
          disableUrlAccess: true,
        });
        return {
          outcome: "SENT",
          providerReference: typeof result.messageId === "string" ? result.messageId : null,
        };
      } catch (error) {
        return { outcome: "FAILED", ...classifyEmailFailure(error) };
      } finally {
        // TD-040 R3-002. Guarded on purpose: an unguarded `close()` that throws
        // would turn a message that ALREADY LEFT into a recorded failure, and a
        // rejected `close()` promise would become an unhandled rejection. The
        // attempt's outcome is decided above; teardown cannot revise it.
        try {
          transport.close?.();
        } catch {
          // Deliberately swallowed for the reason above.
        }
      }
    },
  };
}
