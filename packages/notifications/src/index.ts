/**
 * The NewSaaS notification boundary (EPIC-17).
 *
 * It owns what a notification IS before anything sends one: the delivery
 * aggregate's statuses and lifecycle guard, and the BullMQ queue contract the
 * API producer and the worker consumer share. The channels themselves are
 * providers behind the boundary that [[NOTIF-002]] adds, and the appointment
 * reminder that schedules the first delivery is [[NOTIF-003]].
 *
 * `apps/api` and `apps/worker` consume the SAME contract, so a producer and a
 * consumer cannot disagree about the queue name, the job name or the job's
 * identity.
 */
export {
  assertNotificationDeliveryTransition,
  canTransitionNotificationDelivery,
  isNotificationDeliveryFrozen,
  isNotificationDeliverySettled,
  NOTIFICATION_DELIVERY_FROZEN_STATUSES,
  NOTIFICATION_DELIVERY_STATUSES,
  NOTIFICATION_DELIVERY_TRANSITION_NOT_ALLOWED,
  NOTIFICATION_DELIVERY_TRANSITIONS,
  NotificationDeliveryTransitionError,
} from "./notification-delivery.lifecycle.js";
export type { NotificationDeliveryStatus } from "./notification-delivery.lifecycle.js";
export {
  NOTIFICATION_DELIVERY_BACKOFF_DELAY_MS,
  NOTIFICATION_DELIVERY_JOB,
  NOTIFICATION_DELIVERY_MAX_ATTEMPTS,
  NOTIFICATION_DELIVERY_QUEUE,
  notificationDeliveryJobId,
  notificationDeliveryJobOptions,
} from "./notification-delivery.queue.js";
export type { NotificationDeliveryJob } from "./notification-delivery.queue.js";
export {
  BullMqNotificationDeliveryProducer,
  createBullMqNotificationDeliveryProducer,
  NOTIFICATION_DELIVERY_ENQUEUE_TIMEOUT_MS,
  NOTIFICATION_DELIVERY_PRODUCER,
  NOTIFICATION_DELIVERY_PRODUCER_REDIS_OPTIONS,
} from "./notification-delivery.producer.js";
export type { NotificationDeliveryProducer } from "./notification-delivery.producer.js";
export {
  NOTIFICATION_CHANNEL_PROVIDER_IDS,
  NOTIFICATION_CHANNEL_VALUES,
  NOTIFICATION_CHANNEL_REASON,
  NOTIFICATION_CHANNELS,
} from "./channel/channel.port.js";
export type {
  NotificationChannel,
  NotificationChannelOutcome,
  NotificationChannelPort,
  NotificationChannelProviderId,
  NotificationChannelRequest,
  NotificationChannels,
} from "./channel/channel.port.js";
export { createFakeNotificationChannel, FAKE_CHANNEL_OUTCOMES } from "./channel/fake.channel.js";
export type {
  FakeChannelAttempt,
  FakeChannelOutcome,
  FakeNotificationChannel,
  FakeNotificationChannelOptions,
} from "./channel/fake.channel.js";
export {
  classifyEmailFailure,
  createSmtpEmailChannel,
  isDeliverableEmailAddress,
} from "./channel/email.channel.js";
export type {
  EmailTransport,
  EmailTransportFactory,
  SmtpEmailChannelOptions,
  SmtpEmailConfig,
} from "./channel/email.channel.js";
export {
  classifyWhatsAppFailure,
  createWhatsAppCloudChannel,
  isDeliverablePhoneNumber,
  WHATSAPP_CLOUD_DEFAULT_BASE_URL,
} from "./channel/whatsapp.channel.js";
export type {
  WhatsAppCloudChannelOptions,
  WhatsAppCloudConfig,
  WhatsAppFetch,
} from "./channel/whatsapp.channel.js";
export {
  buildNotificationChannels,
  NOTIFICATION_EMAIL_ENV_VARS,
  NOTIFICATION_EMAIL_PROVIDER_ENV_VALUES,
  NOTIFICATION_PROVIDER_ENV_VARS,
  NOTIFICATION_WHATSAPP_ENV_VARS,
  NOTIFICATION_WHATSAPP_PROVIDER_ENV_VALUES,
  NotificationChannelsModule,
  resolveChannelProvider,
} from "./channel/channel.module.js";
export type {
  BuildNotificationChannelsArgs,
  NotificationChannelsModuleOptions,
  NotificationEmailProviderEnvValue,
  NotificationWhatsAppProviderEnvValue,
} from "./channel/channel.module.js";
export {
  createDenyAllNotificationEntitlementPort,
  NOTIFICATION_ENTITLEMENT,
} from "./entitlement.port.js";
export type { NotificationEntitlementPort } from "./entitlement.port.js";
export { createNullNotificationRecipientPort, NOTIFICATION_RECIPIENT } from "./recipient.port.js";
export type { NotificationRecipientType } from "./recipient.port.js";
export type {
  NotificationRecipientPort,
  NotificationRecipientReference,
} from "./recipient.port.js";
export { NOTIFICATION_DELIVERY_REASON } from "./delivery.reason.js";
export { FISCAL_NOTICE_CHANNEL, fiscalNoticeDedupeKey } from "./fiscal-notice.policy.js";
export {
  isReminderOverdue,
  NOTIFICATION_REMINDER_CHANNELS,
  NOTIFICATION_REMINDER_CHANNELS_DEFAULT,
  NOTIFICATION_REMINDER_LEAD_HOURS_DEFAULT,
  NOTIFICATION_REMINDER_LEAD_HOURS_MAX,
  NOTIFICATION_REMINDER_LEAD_HOURS_MIN,
  reminderDedupeKey,
  reminderScheduledAt,
  reminderWindowKey,
} from "./reminder.policy.js";
export type { ReminderDedupeKeyArgs } from "./reminder.policy.js";
export type { NotificationDeliveryReason } from "./delivery.reason.js";
export {
  PORTAL_RECOVERY_CHANNEL,
  portalRecoveryDedupeKey,
  portalRecoveryUrl,
  portalRecoveryWindow,
} from "./portal-recovery.policy.js";
export {
  STAFF_RECOVERY_CHANNEL,
  staffRecoveryDedupeKey,
  staffRecoveryWindow,
} from "./staff-recovery.policy.js";
