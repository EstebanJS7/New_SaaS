import { Inject, Injectable } from "@nestjs/common";
import { PrismaService } from "@newsaas/database";
import {
  NOTIFICATION_CHANNELS,
  NOTIFICATION_DELIVERY_REASON,
  type NotificationChannel,
  type NotificationChannels,
  type NotificationRecipientPort,
  type NotificationEntitlementPort,
  type NotificationDeliveryJob,
  NOTIFICATION_ENTITLEMENT,
  NOTIFICATION_RECIPIENT,
} from "@newsaas/notifications";
import {
  NOTIFICATION_CONTENT_BUILDER,
  type NotificationContentBuilder,
} from "./notification-content.js";
import { UnsupportedRecipientTypeError } from "./notification-recipient.read.js";

/**
 * The delivery path: claim one delivery, resolve it, send it, record what
 * happened. The fiscal submission handler's shape, one domain over.
 *
 * The claim is a **compare-and-swap**, and the duplicate-delivery discipline is
 * the fiscal one: a settled row is never touched again, and a fresh `SENDING`
 * claim belongs to another worker, so this process returns rather than racing
 * it. A same-status update is not a transition — which is exactly why the
 * database guard admits `SENDING -> SENDING` without an edge ([[NOTIF-001]]).
 */

type NotificationStatus = "SCHEDULED" | "QUEUED" | "SENDING" | "SENT" | "FAILED" | "CANCELLED";

interface DeliveryRecord {
  readonly id: string;
  readonly tenantId: string;
  readonly channel: NotificationChannel;
  readonly status: NotificationStatus;
  readonly recipientType: "CUSTOMER";
  readonly recipientId: string;
  readonly attemptCount: number;
  readonly lastAttemptAt: Date | null;
}

interface DeliveryDelegate {
  findFirst(args: {
    readonly where: { readonly tenantId: string; readonly id: string };
  }): Promise<DeliveryRecord | null>;
  updateMany(args: {
    readonly where: {
      readonly id: string;
      readonly tenantId: string;
      readonly status: NotificationStatus | { readonly in: readonly NotificationStatus[] };
      readonly lastAttemptAt?: Date | null;
    };
    readonly data: Record<string, unknown>;
  }): Promise<{ count: number }>;
}

export interface NotificationDeliveryPrisma {
  notificationDelivery: DeliveryDelegate;
}

/** The statuses this handler must never touch: the row is resolved or frozen. */
const SETTLED_STATUSES: readonly NotificationStatus[] = ["SENT", "FAILED", "CANCELLED"];

/** The statuses a claim may start from. */
const CLAIMABLE_STATUSES: readonly NotificationStatus[] = ["SCHEDULED", "QUEUED"];

/**
 * How long a committed `SENDING` claim is honoured.
 *
 * The claim is committed before the provider call, so a worker that dies in
 * between — restart, OOM kill, reschedule — leaves the row claimed with no
 * writer. Past this age the claim is abandoned and a delivery may take it over
 * **in place**: the status is unchanged, so the database guard has nothing to
 * refuse, and the CAS is on the observed lease.
 */
const CLAIM_LEASE_MS = 5 * 60_000;

/** The channel-gate mapping from [[DEC-058]]: email ungated, WhatsApp gated. */
const CHANNEL_FEATURE_CODE: Readonly<Partial<Record<NotificationChannel, string>>> = {
  WHATSAPP: "whatsapp",
};

@Injectable()
export class NotificationDeliveryHandler {
  constructor(
    @Inject(PrismaService) private readonly prisma: NotificationDeliveryPrisma,
    @Inject(NOTIFICATION_CHANNELS) private readonly channels: NotificationChannels,
    @Inject(NOTIFICATION_RECIPIENT) private readonly recipients: NotificationRecipientPort,
    @Inject(NOTIFICATION_ENTITLEMENT) private readonly entitlements: NotificationEntitlementPort,
    @Inject(NOTIFICATION_CONTENT_BUILDER) private readonly content: NotificationContentBuilder
  ) {}

  async handle(job: NotificationDeliveryJob): Promise<void> {
    const delivery = await this.prisma.notificationDelivery.findFirst({
      where: { tenantId: job.tenantId, id: job.notificationDeliveryId },
    });
    if (!delivery) return;

    // A settled row is not editable state, and the database freezes SENT and
    // CANCELLED outright; returning here is what keeps a duplicate delivery from
    // turning into a second message to a real recipient.
    if (SETTLED_STATUSES.includes(delivery.status)) return;

    const reclaiming = delivery.status === "SENDING";
    if (reclaiming && !this.isLeaseAbandoned(delivery)) return;

    if (!(await this.claim(delivery, reclaiming))) return;

    await this.deliver(delivery);
  }

  /**
   * Takes the attempt, and reports whether it was taken.
   *
   * A re-claim of an abandoned row KEEPS the status it observed — `SENDING`
   * re-claims as `SENDING` — because the guard admits no `SENDING -> SENDING`
   * edge and none is needed: the status does not change, so what the CAS pins is
   * the observed `last_attempt_at`. Only a row claimed from `SCHEDULED`/`QUEUED`
   * moves to `SENDING`.
   */
  private async claim(delivery: DeliveryRecord, reclaiming: boolean): Promise<boolean> {
    const claimed = await this.prisma.notificationDelivery.updateMany({
      where: reclaiming
        ? {
            id: delivery.id,
            tenantId: delivery.tenantId,
            status: delivery.status,
            lastAttemptAt: delivery.lastAttemptAt,
          }
        : {
            id: delivery.id,
            tenantId: delivery.tenantId,
            status: { in: CLAIMABLE_STATUSES },
          },
      data: {
        ...(reclaiming ? {} : { status: "SENDING" }),
        // Monotonic by construction, which the database also asserts.
        attemptCount: { increment: 1 },
        lastAttemptAt: new Date(),
      },
    });
    return claimed.count === 1;
  }

  /**
   * Everything between the claim and the provider call, in the order the gates
   * must run: a delivery the tenant is not entitled to, or whose recipient does
   * not exist, never reaches an adapter.
   *
   * **The claim is already committed when this runs**, and that is why every step
   * is inside one `try` (TD-041 R3-001). An unexpected throw — a reader that
   * cannot answer, a seam that throws — used to propagate with nothing written:
   * the row would keep `SENDING`, a fresh lease and an incremented attempt count,
   * so an operator would see an attempt in progress with no explanation and
   * nothing able to touch it until the lease expired. Now the delivery retries
   * AND the row says which gate failed. The step name is ours; no error text is
   * stored, because a driver's message is the field most likely to carry a row's
   * value.
   *
   * One exception settles rather than retrying: a recipient type with no reader
   * is a programming error, and a retry reaches the same absent reader.
   */
  private async deliver(delivery: DeliveryRecord): Promise<void> {
    let step = "entitlement";
    let prepared: {
      readonly address: string;
      readonly subject: string;
      readonly body: string;
      readonly parameters: readonly string[];
    };

    try {
      const entitlement = await this.checkEntitlement(delivery);
      if (entitlement !== null) return this.settleFailure(delivery, entitlement);

      step = "content";
      const content = await this.resolveContent(delivery);
      if ("reasonCode" in content) return this.settleFailure(delivery, content);

      step = "recipient";
      const recipient = await this.recipients.resolve({
        tenantId: delivery.tenantId,
        recipientType: delivery.recipientType,
        recipientId: delivery.recipientId,
        channel: delivery.channel,
      });
      if (recipient === null) {
        return this.settleFailure(delivery, {
          reasonCode: NOTIFICATION_DELIVERY_REASON.RECIPIENT_UNRESOLVED,
          reason: "The delivery's recipient reference names no active contact for this channel.",
        });
      }

      prepared = {
        address: recipient.address,
        subject: content.subject,
        body: content.body,
        parameters: content.parameters,
      };
    } catch (error) {
      if (error instanceof UnsupportedRecipientTypeError) {
        return this.settleFailure(delivery, {
          reasonCode: NOTIFICATION_DELIVERY_REASON.RECIPIENT_TYPE_UNSUPPORTED,
          reason: "The delivery's recipient type has no reader.",
        });
      }
      return this.recordRetryableFailure(delivery, {
        reasonCode: NOTIFICATION_DELIVERY_REASON.GATE_FAILED,
        reason: `The ${step} gate failed before the message could be sent.`,
      });
    }

    await this.send(delivery, prepared);
  }

  /** The provider call and its outcome. The adapters return outcomes; a throw is the boundary's. */
  private async send(
    delivery: DeliveryRecord,
    prepared: {
      readonly address: string;
      readonly subject: string;
      readonly body: string;
      readonly parameters: readonly string[];
    }
  ): Promise<void> {
    let outcome;
    try {
      outcome = await this.channels.for(delivery.channel).send({
        tenantId: delivery.tenantId,
        deliveryId: delivery.id,
        recipient: prepared.address,
        subject: prepared.subject,
        body: prepared.body,
        parameters: prepared.parameters,
      });
    } catch {
      // The adapters classify their own failures, so reaching here means the
      // BOUNDARY failed rather than the send. Retryable: nothing was proven
      // either way, and the message may not have left.
      return this.recordRetryableFailure(delivery, {
        reasonCode: "NOTIFICATION_CHANNEL_UNREACHABLE",
        reason: "The channel boundary threw before reporting an outcome.",
      });
    }

    if (outcome.outcome === "SENT") {
      await this.settleSent(delivery, outcome.providerReference);
      return;
    }
    if (outcome.retryable) {
      return this.recordRetryableFailure(delivery, {
        reasonCode: outcome.reasonCode,
        reason: outcome.reason,
      });
    }
    return this.settleFailure(delivery, {
      reasonCode: outcome.reasonCode,
      reason: outcome.reason,
    });
  }

  /** [[DEC-058]]: only a channel with a feature code is gated. Email is not. */
  private async checkEntitlement(
    delivery: DeliveryRecord
  ): Promise<{ reasonCode: string; reason: string } | null> {
    const featureCode = CHANNEL_FEATURE_CODE[delivery.channel];
    if (featureCode === undefined) return null;

    const entitled = await this.entitlements.has({ tenantId: delivery.tenantId, featureCode });
    if (entitled) return null;

    // Not retryable: a grant does not appear because time passed, and the
    // delivery record is where an operator sees what to fix.
    return {
      reasonCode: NOTIFICATION_DELIVERY_REASON.FEATURE_NOT_ENTITLED,
      reason: `The tenant is not entitled to the ${featureCode} channel.`,
    };
  }

  private async resolveContent(
    delivery: DeliveryRecord
  ): Promise<
    | { readonly subject: string; readonly body: string; readonly parameters: readonly string[] }
    | { readonly reasonCode: string; readonly reason: string }
  > {
    const built = await this.content.build({
      tenantId: delivery.tenantId,
      deliveryId: delivery.id,
      channel: delivery.channel,
    });
    return built.outcome === "READY"
      ? { subject: built.subject, body: built.body, parameters: built.parameters }
      : { reasonCode: built.reasonCode, reason: built.reason };
  }

  /**
   * `SENDING -> SENT`.
   *
   * `last_error_code` is cleared in the same write, which the table's own CHECK
   * requires of a `SENT` row: a delivery that succeeded after a retry must not
   * keep the previous attempt's error as if it were current.
   */
  private async settleSent(
    delivery: DeliveryRecord,
    providerReference: string | null
  ): Promise<void> {
    await this.prisma.notificationDelivery.updateMany({
      where: { id: delivery.id, tenantId: delivery.tenantId, status: "SENDING" },
      data: {
        status: "SENT",
        sentAt: new Date(),
        lastErrorCode: null,
        lastErrorMessage: null,
        // The provider's own handle, written only on entry to SENT: the row is
        // frozen from here, so it can never be rewritten or cleared.
        ...(providerReference === null ? {} : { providerReference }),
      },
    });
  }

  /** `SENDING -> FAILED`. Terminal, and the row keeps its reason. */
  private async settleFailure(
    delivery: DeliveryRecord,
    failure: { readonly reasonCode: string; readonly reason: string }
  ): Promise<void> {
    const code = truncate(failure.reasonCode);
    const message = truncate(failure.reason);
    await this.prisma.notificationDelivery.updateMany({
      // Exactly the claim state. If the claim was stolen, this writes nothing
      // and the owner decides — a settle that matched a wider set could clobber
      // an attempt somebody else is running.
      where: { id: delivery.id, tenantId: delivery.tenantId, status: "SENDING" },
      data: { status: "FAILED", lastErrorCode: code, lastErrorMessage: message },
    });
  }

  /**
   * Records a retryable failure and throws so BullMQ retries within its bounded
   * budget.
   *
   * The row STAYS `SENDING` — that is what a retryable failure is, and the
   * table's CHECK admits an error code exactly on `SENDING` and `FAILED`. The
   * lease is not touched, so the next attempt either re-claims after the lease
   * expires or, if this is the last attempt, the row keeps the reason of the
   * attempt that failed.
   */
  private async recordRetryableFailure(
    delivery: DeliveryRecord,
    failure: { readonly reasonCode: string; readonly reason: string }
  ): Promise<never> {
    await this.prisma.notificationDelivery.updateMany({
      where: { id: delivery.id, tenantId: delivery.tenantId, status: "SENDING" },
      data: {
        lastErrorCode: truncate(failure.reasonCode),
        lastErrorMessage: truncate(failure.reason),
      },
    });
    throw new Error(`Notification delivery ${delivery.id} failed and will be retried.`);
  }

  private isLeaseAbandoned(delivery: DeliveryRecord): boolean {
    if (delivery.lastAttemptAt === null) return true;
    return Date.now() - delivery.lastAttemptAt.getTime() > CLAIM_LEASE_MS;
  }
}

/**
 * The provider's handle for the accepted message, for support and for
 * correlating a complaint with a send.
 *
 * It is nullable because a provider is not required to issue one (the SMTP
 * adapter returns `null` when nodemailer reports no `messageId`), and its
 * absence is not a failure: the message was accepted.
 */

/** Bounded, newline-flattened: a reason is a coordinate, not a payload. */
function truncate(value: string): string {
  return value.replace(/[\r\n\t]+/g, " ").slice(0, 500);
}

/** Re-exported so the wiring and its tests name the same error. */
export { UnsupportedRecipientTypeError };
