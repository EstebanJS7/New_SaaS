import { Module, type DynamicModule, type Provider } from "@nestjs/common";
import { EntitlementsModule } from "../entitlements/entitlements.module.js";
import { ContextModule } from "../context/context.module.js";
import { RbacModule } from "../rbac/rbac.module.js";
import { SettingsModule } from "../settings/settings.module.js";
import { NotificationDeliveryService } from "./notification-delivery.service.js";
import { NotificationsController } from "./notifications.controller.js";
import {
  createBullMqNotificationDeliveryProducer,
  NOTIFICATION_DELIVERY_PRODUCER,
} from "@newsaas/notifications";
import { NotificationIntentService } from "./notification-intent.service.js";
import { PasswordRecoveryScheduler } from "./password-recovery.scheduler.js";
import { PortalPasswordRecoveryScheduler } from "./portal-password-recovery.scheduler.js";
import { NotificationReminderScheduler } from "./notification-reminder.scheduler.js";
import {
  APPOINTMENT_RECIPIENT_PORT,
  createNullAppointmentRecipientPort,
} from "./appointment-recipient.port.js";

/**
 * The notifications composition root (EPIC-17 NOTIF-003 WU-D2).
 *
 * It registers the reminder scheduler and the queue producer the scheduler
 * enqueues through. The producer reads `REDIS_URL` at construction, the same way
 * the fiscal producer does, so the module fails loudly at boot when the
 * deployment that needs a queue has no queue rather than per reaction.
 *
 * It imports `EntitlementsModule` and `SettingsModule` for the two reads the
 * scheduling decision needs: the tenant's configured lead time and channel set,
 * and [[DEC-058]]'s per-channel grant.
 */
export interface NotificationsModuleOptions {
  /**
   * The provider for `APPOINTMENT_RECIPIENT_PORT`, replacing the fail-closed
   * default.
   *
   * A VETERINARY implementation is what a deployment supplies, because the
   * patient's responsible customer is a Veterinary fact; the composition root is
   * where the two are bound, so this module never names it (`forRoot` is the
   * `FiscalProviderModule` precedent).
   */
  readonly recipientPort?: Provider;
}

@Module({})
export class NotificationsModule {
  static forRoot(options: NotificationsModuleOptions = {}): DynamicModule {
    return {
      module: NotificationsModule,
      imports: [SettingsModule, EntitlementsModule, ContextModule, RbacModule],
      providers: [
        options.recipientPort ?? {
          provide: APPOINTMENT_RECIPIENT_PORT,
          useValue: createNullAppointmentRecipientPort(),
        },
        {
          provide: NOTIFICATION_DELIVERY_PRODUCER,
          useFactory: () => {
            const redisUrl = process.env.REDIS_URL;
            if (!redisUrl) throw new Error("REDIS_URL is not set");
            return createBullMqNotificationDeliveryProducer(redisUrl);
          },
        },
        NotificationIntentService,
        NotificationReminderScheduler,
        PasswordRecoveryScheduler,
        PortalPasswordRecoveryScheduler,
        NotificationDeliveryService,
      ],
      controllers: [NotificationsController],
      exports: [NOTIFICATION_DELIVERY_PRODUCER, APPOINTMENT_RECIPIENT_PORT],
    };
  }
}
