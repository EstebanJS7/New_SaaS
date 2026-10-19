import { Inject, Injectable, type OnModuleInit } from "@nestjs/common";
import {
  NOTIFICATION_DELIVERY_PRODUCER,
  PORTAL_RECOVERY_CHANNEL,
  portalRecoveryDedupeKey,
  type NotificationDeliveryProducer,
} from "@newsaas/notifications";
import type { ApplicationEvent, EventDispatcher } from "@newsaas/shared";
import { PORTAL_PASSWORD_RESET_REQUESTED } from "../portal/portal-password-recovery.service.js";
import { APPLICATION_EVENT_DISPATCHER } from "../events/application-events.module.js";
import { NotificationIntentService } from "./notification-intent.service.js";

/**
 * The portal's password-recovery message ([[PORTAL-002]]).
 *
 * A subscriber, exactly like the staff recovery's, and that is what keeps the portal module free of
 * the delivery aggregate: `PortalPasswordRecoveryService` publishes and knows nothing about queues,
 * producers or deliveries. It runs in the API deployable because the dispatcher is in-process, so a
 * reaction registered anywhere else would silently never fire.
 *
 * **The tenant comes from the EVENT**, not from a platform lookup like the staff one. A portal
 * recovery belongs to the clinic the holder is a customer of — the event carries that tenant — so
 * the delivery is tenant-scoped and its operators can see it, which is the opposite of the staff
 * recovery's platform-owned message and correct for the same reason: those customers are that
 * clinic's business.
 *
 * It needs NO read of its own: the source and the recipient are the access id the event carries, and
 * the WORKER's builder gates on the access's current state at send time. A subscriber that
 * pre-validated would need a second read to stay in step with the send-time one.
 */
@Injectable()
export class PortalPasswordRecoveryScheduler implements OnModuleInit {
  constructor(
    @Inject(APPLICATION_EVENT_DISPATCHER) private readonly events: EventDispatcher,
    private readonly intents: NotificationIntentService,
    @Inject(NOTIFICATION_DELIVERY_PRODUCER)
    private readonly producer: NotificationDeliveryProducer
  ) {}

  onModuleInit(): void {
    this.events.subscribe(PORTAL_PASSWORD_RESET_REQUESTED, (event) => this.onRequested(event));
  }

  async onRequested(event: ApplicationEvent<string, unknown>): Promise<void> {
    // The same guard as the staff recovery's, mirrored: that one refuses a TENANT-scoped event
    // because its message is platform-owned, and this one refuses an event with NO tenant because a
    // portal message must belong to a clinic. A tenant-less one would file a customer's recovery
    // mail under nobody.
    const tenantId = event.tenantId;
    if (tenantId === null) return;

    try {
      const now = new Date();
      const dedupeKey = portalRecoveryDedupeKey({ portalAccessId: event.aggregateId, now });
      const deliveryId = await this.intents.ensureIntent({
        tenantId,
        channel: PORTAL_RECOVERY_CHANNEL,
        sourceType: "PORTAL_ACCOUNT",
        // The source IS the access: the token row does not exist yet and is minted at send time.
        sourceId: event.aggregateId,
        recipientType: "PORTAL_HOLDER",
        recipientId: event.aggregateId,
        scheduledAt: now,
        dedupeKey,
      });
      // `null` means the window's message already exists and is no longer pending, so this request
      // has nothing to send; the requester is told to try again rather than silently getting nothing.
      if (deliveryId === null) return;

      await this.producer.enqueue({ notificationDeliveryId: deliveryId, tenantId }, now);
    } catch (error) {
      // The dispatcher is fire-and-forget, so nothing else can report this: an unreported failure
      // here is a customer told to check an inbox that will stay empty. The error's NAME only —
      // never its message, which is where a connection string with credentials lives.
      console.error("Portal password recovery could not be scheduled", {
        portalAccessId: event.aggregateId,
        error: error instanceof Error ? error.name : "UnknownError",
      });
    }
  }
}
