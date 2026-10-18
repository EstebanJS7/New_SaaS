import { Inject, Injectable, type OnModuleInit } from "@nestjs/common";
import type { Prisma } from "@newsaas/database";
import { PrismaService } from "@newsaas/database";
import { reminderDedupeKey, reminderScheduledAt } from "@newsaas/notifications";
import { NotificationIntentService } from "./notification-intent.service.js";
import type { ApplicationEvent, EventDispatcher } from "@newsaas/shared";
import { APPLICATION_EVENT_DISPATCHER } from "../events/application-events.module.js";
import { EntitlementsService } from "../entitlements/entitlements.service.js";
import { TenantSettingsService } from "../settings/tenant-settings.service.js";
import {
  NOTIFICATION_DELIVERY_PRODUCER,
  type NotificationDeliveryProducer,
} from "@newsaas/notifications";
import { loadNotificationsSettings } from "./notification-settings.read.js";
import {
  APPOINTMENT_RECIPIENT_PORT,
  type AppointmentRecipientPort,
} from "./appointment-recipient.port.js";

/**
 * The appointment reminder's scheduling and cancellation, as the FIRST production
 * subscriber of the in-process dispatcher ([[DEC-059]]).
 *
 * Both reactions are registered here because they are one policy: PRD §24's
 * sentence binds them ("idempotent, and cancelled if the appointment is
 * cancelled"), and a scheduler and a canceller that lived apart could disagree
 * about which window they mean.
 *
 * The event payload carries ids only, and every reaction **re-reads the row**.
 * That is deliberate rather than an optimisation missed: an event built from a
 * snapshot would let a reschedule between the emit and the reaction schedule a
 * reminder for an instant the appointment no longer has.
 */

/** PRD §39's catalog names, spelled once so a publisher and a subscriber agree. */
export const APPOINTMENT_CONFIRMED = "AppointmentConfirmed";
export const APPOINTMENT_CANCELLED = "AppointmentCancelled";

/** The channel gate's feature code ([[DEC-058]]). */
const WHATSAPP_FEATURE_CODE = "whatsapp";

/** The reason a cancelled appointment's reminder carries. */
export const REMINDER_CANCELLATION_REASON = "APPOINTMENT_CANCELLED";

/**
 * The unique index that makes a repeated intent idempotent. A `P2002` naming
 * anything else is a different violation and must propagate —
 * `sales.service.ts`'s matcher is the precedent, and accepting a bare `P2002`
 * would swallow a tenant-ownership-key conflict as "already scheduled".
 */
interface AppointmentRow {
  readonly id: string;
  readonly patientId: string;
  readonly status: string;
  readonly startAt: Date;
}

/**
 * The narrow client this reaction needs, in Prisma's OWN arg types so the real
 * client fits by construction and a test can pass a stub.
 */
export interface NotificationReminderPrisma {
  appointment: {
    findFirst(args: Prisma.AppointmentFindFirstArgs): Promise<AppointmentRow | null>;
  };
  // There is deliberately NO `patientGuardian` member: the patient's responsible
  // customer is a VETERINARY fact reached through the port below, because this
  // module is Core and the boundary suite forbids a Core module naming it.
  notificationDelivery: {
    create(args: Prisma.NotificationDeliveryCreateArgs): Promise<{ id: string }>;
    findFirst(args: Prisma.NotificationDeliveryFindFirstArgs): Promise<{ id: string } | null>;
    findMany(args: Prisma.NotificationDeliveryFindManyArgs): Promise<{ id: string }[]>;
    updateMany(args: Prisma.NotificationDeliveryUpdateManyArgs): Promise<{ count: number }>;
  };
}

@Injectable()
export class NotificationReminderScheduler implements OnModuleInit {
  constructor(
    @Inject(APPLICATION_EVENT_DISPATCHER) private readonly events: EventDispatcher,
    @Inject(PrismaService) private readonly prisma: NotificationReminderPrisma,
    private readonly settings: TenantSettingsService,
    private readonly entitlements: EntitlementsService,
    @Inject(APPOINTMENT_RECIPIENT_PORT)
    private readonly recipients: AppointmentRecipientPort,
    @Inject(NOTIFICATION_DELIVERY_PRODUCER)
    private readonly producer: NotificationDeliveryProducer,
    private readonly intents: NotificationIntentService
  ) {}

  onModuleInit(): void {
    this.events.subscribe(APPOINTMENT_CONFIRMED, (event) => this.onConfirmed(event));
    this.events.subscribe(APPOINTMENT_CANCELLED, (event) => this.onCancelled(event));
  }

  /**
   * Schedules one reminder per configured channel, idempotently.
   *
   * Order matters and is the reason this is documented rather than obvious:
   * **the row is written first and the job is enqueued second**. A lost enqueue
   * therefore leaves a `SCHEDULED` row with no job — the gap the epic records —
   * while the reverse order would leave a job pointing at nothing.
   */
  async onConfirmed(event: ApplicationEvent<string, unknown>): Promise<void> {
    const tenantId = event.tenantId;
    if (tenantId === null) return;

    const appointment = await this.prisma.appointment.findFirst({
      where: { id: event.aggregateId, tenantId },
      select: { id: true, patientId: true, status: true, startAt: true },
    });
    // A stale or foreign event is not an error: the row is the authority, and a
    // reminder is scheduled only for an appointment that is actually CONFIRMED.
    if (appointment?.status !== "CONFIRMED") return;

    const customerId = await this.recipients.primaryCustomerFor({
      tenantId,
      patientId: appointment.patientId,
    });
    if (customerId === null) return;

    const policy = await loadNotificationsSettings(this.settings);
    const scheduledAt = reminderScheduledAt(
      appointment.startAt,
      policy.appointmentReminderLeadHours
    );

    for (const channel of policy.appointmentReminderChannels) {
      // [[DEC-058]]'s per-VALUE gate: a channel the tenant is not entitled to is
      // refused BEFORE anything is scheduled, so an unentitled tenant never has a
      // pending WhatsApp reminder at all.
      if (
        channel === "WHATSAPP" &&
        !(await this.entitlements.has(tenantId, WHATSAPP_FEATURE_CODE))
      ) {
        continue;
      }

      const dedupeKey = reminderDedupeKey({
        appointmentId: appointment.id,
        channel,
        startsAt: appointment.startAt,
      });
      const deliveryId = await this.intents.ensureIntent({
        tenantId,
        channel,
        sourceType: "APPOINTMENT",
        sourceId: appointment.id,
        recipientType: "CUSTOMER",
        recipientId: customerId,
        scheduledAt,
        dedupeKey,
      });
      // `null` means the key is held by a delivery that is no longer pending — a
      // cancelled one, whose key the partial index releases — so the cancellation
      // path owns it and there is nothing to schedule here.
      if (deliveryId === null) continue;

      // Review R3-001, first window: a cancellation can run BETWEEN this intent's
      // creation and its enqueue, CAS the row and find no job to remove because
      // this one does not exist yet — and then this enqueue would produce a job
      // for an already-cancelled delivery.
      //
      // Review R3-001, second window, found by the targeted validator: the
      // cancellation can run BEFORE the intent existed at all, so its reaction
      // found nothing to cancel while this one still had the appointment as
      // CONFIRMED from its earlier read. Re-reading the APPOINTMENT — the
      // authority for whether a reminder may exist — closes that one, and the
      // send-time gate in NOTIF-003 WU-D3 closes the residual window between this
      // read and the enqueue.
      if (!(await this.isStillSchedulable(tenantId, appointment.id, deliveryId))) {
        await this.cancelDelivery(tenantId, deliveryId);
        continue;
      }

      // This runs for an intent that ALREADY existed too, and that is the point:
      // when the first attempt's enqueue failed, the row stayed `SCHEDULED` with no
      // job, and every later confirmation would otherwise take the conflict branch
      // and never enqueue it — a reminder stranded forever by a transient queue
      // failure. Re-adding is safe: the job id is deterministic, so BullMQ ignores
      // a duplicate, and a delivery that already settled is refused by the handler.
      //
      // The two properties that make re-adding safe are asserted, and NOT in this
      // file (TD-045, the validator's observation on review-a8f4b7d2bd6a83b4): the
      // deterministic identity in
      // `packages/notifications/src/notification-delivery.queue.test.ts`, "derives a
      // deterministic identity from the delivery, and one per delivery"; and the
      // settled-row refusal in
      // `apps/worker/src/notification-delivery/notification-delivery.handler.test.ts`,
      // "never touches a settled row, because a settled row is not editable state",
      // which covers SENT, FAILED and CANCELLED. Named here so the argument can be
      // followed instead of trusted.
      await this.producer.enqueue({ notificationDeliveryId: deliveryId, tenantId }, scheduledAt);

      // The same window, one step later: the cancellation landed between the
      // check above and the enqueue, and it already removed the job it could not
      // find. The row's status is what makes the reminder UNDELIVERABLE — the
      // handler refuses a settled row, which its own case asserts — but the job
      // would linger with nobody expecting it.
      if (!(await this.isStillSchedulable(tenantId, appointment.id, deliveryId))) {
        await this.cancelDelivery(tenantId, deliveryId);
      }
    }
  }

  /**
   * Whether a reminder may still be sent: the APPOINTMENT is CONFIRMED and the
   * intent is still pending.
   *
   * Both halves are needed. The appointment is the authority — a cancelled
   * appointment must have no reminder — and the intent's own status catches the
   * case where the cancellation reaction already reached it.
   */
  private async isStillSchedulable(
    tenantId: string,
    appointmentId: string,
    deliveryId: string
  ): Promise<boolean> {
    const appointment = await this.prisma.appointment.findFirst({
      where: { id: appointmentId, tenantId },
      select: { id: true, patientId: true, status: true, startAt: true },
    });
    if (appointment?.status !== "CONFIRMED") return false;

    const delivery = await this.prisma.notificationDelivery.findFirst({
      where: { id: deliveryId, tenantId, status: { in: ["SCHEDULED", "QUEUED"] } },
      select: { id: true },
    });
    return delivery !== null;
  }

  /**
   * Cancels every pending reminder of an appointment and removes its job, one
   * delivery at a time through {@link cancelDelivery}.
   *
   * That helper does the two halves independently and reports rather than throws,
   * so one delivery's failure never stops the others.
   */
  async onCancelled(event: ApplicationEvent<string, unknown>): Promise<void> {
    const tenantId = event.tenantId;
    if (tenantId === null) return;

    const pending = await this.prisma.notificationDelivery.findMany({
      where: {
        tenantId,
        sourceType: "APPOINTMENT",
        sourceId: event.aggregateId,
        status: { in: ["SCHEDULED", "QUEUED"] },
      },
      select: { id: true },
    });

    for (const delivery of pending) {
      await this.cancelDelivery(tenantId, delivery.id);
    }
  }

  /**
   * Cancels one delivery's row if it is still pending, and removes its job.
   * **Total: it never throws.**
   *
   * The two halves are independent on purpose, and that is what two findings on
   * this file's first version established:
   *
   * - **The removal is UNCONDITIONAL.** It used to run only when this caller won
   *   the compare-and-swap, which broke the post-enqueue compensation exactly
   *   where it was needed: a cancellation that landed between the check and the
   *   enqueue had ALREADY cancelled the row, so the CAS lost and the job this
   *   reaction had just enqueued was left orphaned. `queue.remove` is idempotent —
   *   removing a job another caller already removed returns zero — so removing
   *   twice costs nothing and skipping it costs a live job.
   * - **A failed row write does not skip the removal.** The write used to sit in
   *   the same try as the removal, so a database failure logged and returned
   *   without touching the job. The row's status is what makes a reminder
   *   undeliverable, but a job left behind is precisely what this exists to
   *   prevent, so a write failure is reported and the removal still runs.
   *
   * Both halves are reported rather than thrown: an aborting failure would stop
   * the caller's loop and leave the REMAINING deliveries untouched, which a
   * targeted validator found worse than the problem it reported. And every report
   * carries ids and the error's NAME, never its text: a driver's message is where
   * a connection URL with a password lives.
   */
  private async cancelDelivery(tenantId: string, deliveryId: string): Promise<void> {
    try {
      await this.prisma.notificationDelivery.updateMany({
        where: { id: deliveryId, tenantId, status: { in: ["SCHEDULED", "QUEUED"] } },
        data: {
          status: "CANCELLED",
          cancelledAt: new Date(),
          // The table's CHECK requires a cancelled row to explain itself.
          cancellationReason: REMINDER_CANCELLATION_REASON,
        },
      });
    } catch (error) {
      // A row that stays pending is a worse state than a cancelled one, so it is
      // reported loudly; the removal below still runs either way.
      console.error("Notification delivery could not be cancelled", {
        notificationDeliveryId: deliveryId,
        error: describeError(error),
      });
    }

    try {
      await this.producer.cancel(deliveryId);
    } catch (error) {
      // The reminder cannot be delivered — the handler refuses a settled row — but
      // the job lingers, and an operator has to be able to see it.
      console.error("Notification delivery job could not be removed", {
        notificationDeliveryId: deliveryId,
        error: describeError(error),
      });
    }
  }
}

/**
 * A bounded, SANITIZED description of a failure: the error's constructor name and
 * nothing else.
 *
 * Never `message`: a driver's text is where a connection URL with credentials
 * lives, and a failure report travels to an operator's console.
 */
function describeError(error: unknown): string {
  return error instanceof Error ? error.name : "UnknownError";
}
