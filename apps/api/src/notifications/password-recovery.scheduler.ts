import { Inject, Injectable, type OnModuleInit } from "@nestjs/common";
import type { Prisma } from "@newsaas/database";
import { PLATFORM_TENANT_SLUG, PrismaService } from "@newsaas/database";
import {
  NOTIFICATION_DELIVERY_PRODUCER,
  STAFF_RECOVERY_CHANNEL,
  staffRecoveryDedupeKey,
  type NotificationDeliveryProducer,
} from "@newsaas/notifications";
import type { ApplicationEvent, EventDispatcher } from "@newsaas/shared";
import { PASSWORD_RESET_REQUESTED } from "../auth/password-recovery.service.js";
import { APPLICATION_EVENT_DISPATCHER } from "../events/application-events.module.js";
import { NotificationIntentService } from "./notification-intent.service.js";

/**
 * The staff password-recovery message's scheduler (DAT-007, WU-C1).
 *
 * It is a subscriber, not a service the auth module calls, and that is what keeps
 * identity free of the delivery aggregate: the auth module publishes
 * `PasswordResetRequested` and knows nothing about queues, producers or the
 * delivery table. This module owns the message.
 *
 * **It runs in the API deployable**, because the event is published there and the
 * dispatcher is in-process — a subscriber registered anywhere else would silently
 * never fire ([[DEC-059]]'s rule).
 *
 * The order is the same as the reminder's and for the same reason: the row is
 * written first and the job is enqueued second, so a lost enqueue leaves a
 * diagnosable `SCHEDULED` row rather than a job pointing at nothing. And because
 * `ensureIntent` returns an existing pending intent as well as a new one, a later
 * event heals a first enqueue that failed instead of stranding the message behind
 * the dedupe key.
 */
export interface PasswordRecoverySchedulerPrisma {
  tenant: {
    findUnique(args: Prisma.TenantFindUniqueArgs): Promise<{ id: string } | null>;
  };
  notificationDelivery: {
    create(args: Prisma.NotificationDeliveryCreateArgs): Promise<{ id: string }>;
    findFirst(args: Prisma.NotificationDeliveryFindFirstArgs): Promise<{ id: string } | null>;
  };
}

@Injectable()
export class PasswordRecoveryScheduler implements OnModuleInit {
  constructor(
    @Inject(APPLICATION_EVENT_DISPATCHER) private readonly events: EventDispatcher,
    @Inject(PrismaService) private readonly prisma: PasswordRecoverySchedulerPrisma,
    private readonly intents: NotificationIntentService,
    @Inject(NOTIFICATION_DELIVERY_PRODUCER)
    private readonly producer: NotificationDeliveryProducer
  ) {}

  onModuleInit(): void {
    this.events.subscribe(PASSWORD_RESET_REQUESTED, (event) => this.onRequested(event));
  }

  /**
   * Creates the delivery intent under the PLATFORM tenant and enqueues it.
   *
   * The platform tenant is resolved here rather than published in the event: the
   * destination of a message is a notification concern, and an event that carried
   * it would make every publisher learn where its messages live.
   *
   * A missing platform tenant is logged and the reaction stops. It means the
   * deployment cannot deliver a recovery message at all — the seed writes that
   * tenant — and the alternative (creating the intent under some tenant picked from
   * the profile's memberships) would file a staff member's recovery mail under a
   * customer's records.
   */
  async onRequested(event: ApplicationEvent<string, unknown>): Promise<void> {
    // Platform-level by construction: a reset belongs to an identity. A tenant-scoped
    // event of this type would be a publisher bug, and refusing it here keeps the
    // delivery from being filed under a tenant that has nothing to do with it.
    if (event.tenantId !== null) return;

    try {
      const platform = await this.prisma.tenant.findUnique({
        where: { slug: PLATFORM_TENANT_SLUG },
        select: { id: true },
      });
      if (platform === null) {
        console.error("Password recovery cannot send: the platform tenant is not seeded", {
          userProfileId: event.aggregateId,
        });
        return;
      }

      const now = new Date();
      const dedupeKey = staffRecoveryDedupeKey({ userProfileId: event.aggregateId, now });
      const deliveryId = await this.intents.ensureIntent({
        tenantId: platform.id,
        channel: STAFF_RECOVERY_CHANNEL,
        sourceType: "STAFF_ACCOUNT",
        // The source IS the profile. The token does not exist yet: it is minted at
        // SEND time, because a plaintext token cannot be rebuilt from a digest.
        sourceId: event.aggregateId,
        recipientType: "STAFF",
        recipientId: event.aggregateId,
        scheduledAt: now,
        dedupeKey,
      });
      // `null` means the window's message already exists and is no longer pending,
      // so this request has nothing to send. The requester is told to try again
      // rather than silently getting nothing.
      if (deliveryId === null) return;

      await this.producer.enqueue(
        { notificationDeliveryId: deliveryId, tenantId: platform.id },
        now
      );
    } catch (error) {
      // The dispatcher is fire-and-forget, so nothing else can report this: an
      // unreported failure here is a user told to check an inbox that will stay
      // empty. Bounded and sanitized — the error's NAME only, never its message,
      // which is where a connection string with credentials lives.
      console.error("Password recovery could not be scheduled", {
        userProfileId: event.aggregateId,
        error: error instanceof Error ? error.name : "UnknownError",
      });
    }
  }
}
