import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Worker, type Job } from "bullmq";
import { Redis } from "ioredis";
import { NOTIFICATION_DELIVERY_QUEUE, type NotificationDeliveryJob } from "@newsaas/notifications";
import { NotificationDeliveryHandler } from "./notification-delivery.handler.js";

/** Exported so the consumer's contract is testable without a Redis. */
export function createNotificationDeliveryProcessor(
  handler: NotificationDeliveryHandler
): (job: Job<NotificationDeliveryJob>) => Promise<void> {
  return async (job) => handler.handle(job.data);
}

function sanitizeWorkerError(error: unknown): string {
  const message = error instanceof Error ? error.message : "Notification delivery worker failed";
  return message.replace(/[\r\n\t]+/g, " ").slice(0, 300);
}

/**
 * The BullMQ consumer for the notification delivery queue, the fiscal
 * submission consumer's shape: one queue name, one job name, one processor.
 *
 * `maxRetriesPerRequest: null` is correct HERE and would be wrong in a producer:
 * a worker's blocking command must not be killed by a retry limit, while an
 * HTTP-path producer must fail fast instead of holding a request open.
 */
@Injectable()
export class NotificationDeliveryConsumer implements OnModuleInit, OnModuleDestroy {
  private worker: Worker<NotificationDeliveryJob> | null = null;
  private connection: Redis | null = null;

  constructor(private readonly handler: NotificationDeliveryHandler) {}

  onModuleInit(): void {
    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl) throw new Error("REDIS_URL is not set");

    this.connection = new Redis(redisUrl, { maxRetriesPerRequest: null });
    this.worker = new Worker<NotificationDeliveryJob>(
      NOTIFICATION_DELIVERY_QUEUE,
      createNotificationDeliveryProcessor(this.handler),
      { connection: this.connection, concurrency: 1 }
    );
    this.worker.on("failed", (job, error) => {
      // No recipient, no address, no message body: ids and a sanitized reason.
      console.error("Notification delivery job failed", {
        notificationDeliveryId: job?.data.notificationDeliveryId ?? null,
        error: sanitizeWorkerError(error),
      });
    });
    this.worker.on("error", (error) => {
      console.error("Notification delivery worker error", sanitizeWorkerError(error));
    });
  }

  async onModuleDestroy(): Promise<void> {
    const worker = this.worker;
    this.worker = null;
    if (worker) await worker.close();

    const connection = this.connection;
    this.connection = null;
    if (connection) {
      try {
        await connection.quit();
      } catch {
        connection.disconnect();
      }
    }
  }
}
