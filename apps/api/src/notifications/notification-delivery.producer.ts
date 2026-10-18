import { Injectable, type OnModuleDestroy } from "@nestjs/common";
import { Queue } from "bullmq";
import { Redis } from "ioredis";
import {
  NOTIFICATION_DELIVERY_JOB,
  NOTIFICATION_DELIVERY_QUEUE,
  notificationDeliveryJobId,
  notificationDeliveryJobOptions,
  type NotificationDeliveryJob,
} from "@newsaas/notifications";

/**
 * The notification delivery producer, the fiscal submission producer's shape one
 * domain over: a port the caller depends on rather than BullMQ directly, a
 * fail-fast Redis configuration, and a deadline on the enqueue.
 *
 * It carries one capability the fiscal producer does not need: **`cancel`**.
 * PRD §24 requires that cancelling an appointment cancels its pending reminder,
 * and the only way to cancel a delayed job is to remove it by the deterministic
 * identity the queue already holds.
 */

/** Injection token for the producer port. */
export const NOTIFICATION_DELIVERY_PRODUCER = Symbol("NOTIFICATION_DELIVERY_PRODUCER");

/**
 * Hard deadline for one queue operation.
 *
 * The enqueue happens after an appointment's transaction committed and inside a
 * post-commit handler, so an unreachable Redis must fail the reaction rather than
 * hold a handler open until the client gives up.
 */
export const NOTIFICATION_DELIVERY_ENQUEUE_TIMEOUT_MS = 2_000;

/**
 * Producer connection options, deliberately stricter than a worker's:
 * `maxRetriesPerRequest: null` keeps a worker's blocking command alive forever
 * and turns a Redis blip into a hung reaction here, so the limit is set,
 * `enableOfflineQueue: false` refuses a command issued before the connection is
 * ready instead of buffering it, and `connectTimeout` bounds the connect.
 */
export const NOTIFICATION_DELIVERY_PRODUCER_REDIS_OPTIONS = Object.freeze({
  maxRetriesPerRequest: 2,
  enableOfflineQueue: false,
  connectTimeout: 2_000,
});

export interface NotificationDeliveryProducer {
  /**
   * Enqueues one delivery, delayed until its own instant.
   *
   * The row is written first and this follows, so a lost enqueue leaves a
   * `SCHEDULED` row with no job — the epic's declared, diagnosable gap — rather
   * than a job with no record.
   */
  enqueue(job: NotificationDeliveryJob, scheduledAt: Date): Promise<void>;

  /**
   * Removes a pending delivery's job.
   *
   * Idempotent by contract: removing a job that is gone (already ran, already
   * removed, or never enqueued) is success, not an error. The authoritative
   * record of "cancelled" is the row's status, so a failure here must not make a
   * cancellation look failed.
   */
  cancel(notificationDeliveryId: string): Promise<void>;
}

/** Resolves with `work`, or rejects once `timeoutMs` elapses first. */
function withDeadline<T>(work: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Notification delivery queue op exceeded ${timeoutMs}ms`)),
      timeoutMs
    );
    timer.unref();
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    );
  });
}

@Injectable()
export class BullMqNotificationDeliveryProducer
  implements NotificationDeliveryProducer, OnModuleDestroy
{
  private released = false;

  constructor(
    private readonly queue: Queue,
    private readonly connection?: Redis
  ) {}

  async enqueue(job: NotificationDeliveryJob, scheduledAt: Date): Promise<void> {
    await withDeadline(
      this.queue.add(
        NOTIFICATION_DELIVERY_JOB,
        job,
        notificationDeliveryJobOptions(job.notificationDeliveryId, scheduledAt)
      ),
      NOTIFICATION_DELIVERY_ENQUEUE_TIMEOUT_MS
    );
  }

  async cancel(notificationDeliveryId: string): Promise<void> {
    await withDeadline(
      this.queue.remove(notificationDeliveryJobId(notificationDeliveryId)),
      NOTIFICATION_DELIVERY_ENQUEUE_TIMEOUT_MS
    ).catch(() => {
      // Never surfaced: the row is the record of the cancellation, and a job
      // that is already gone is exactly what a cancellation wants to find.
    });
  }

  async onModuleDestroy(): Promise<void> {
    if (this.released) return;
    this.released = true;

    try {
      await this.queue.close();
    } catch {
      // Queue teardown is best-effort; release the owned connection below.
    }

    if (this.connection) {
      try {
        await this.connection.quit();
      } catch {
        this.connection.disconnect();
      }
    }
  }
}

export function createBullMqNotificationDeliveryProducer(
  redisUrl: string
): BullMqNotificationDeliveryProducer {
  const connection = new Redis(redisUrl, NOTIFICATION_DELIVERY_PRODUCER_REDIS_OPTIONS);
  const queue = new Queue(NOTIFICATION_DELIVERY_QUEUE, { connection });
  return new BullMqNotificationDeliveryProducer(queue, connection);
}
