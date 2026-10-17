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
