import { describe, expect, it, vi } from "vitest";
import type { Job } from "bullmq";
import {
  NOTIFICATION_DELIVERY_JOB,
  NOTIFICATION_DELIVERY_QUEUE,
  type NotificationDeliveryJob,
} from "@newsaas/notifications";
import {
  createNotificationDeliveryProcessor,
  NotificationDeliveryConsumer,
} from "./notification-delivery.consumer.js";
import type { NotificationDeliveryHandler } from "./notification-delivery.handler.js";

const job: NotificationDeliveryJob = {
  notificationDeliveryId: "00000000-0000-4000-8000-000000000001",
  tenantId: "00000000-0000-4000-8000-000000000002",
};

describe("notification delivery consumer", () => {
  it("names the queue the producer and the consumer share", () => {
    // The contract is the package's, so the two deployables cannot disagree about
    // which queue a job is enqueued on and consumed from.
    expect(NOTIFICATION_DELIVERY_QUEUE).toBe("notification-delivery");
    expect(NOTIFICATION_DELIVERY_JOB).toBe("deliver");
  });

  it("hands the job's payload to the handler and nothing else", async () => {
    const handle = vi.fn(() => Promise.resolve());
    const processor = createNotificationDeliveryProcessor({
      handle,
    } as unknown as NotificationDeliveryHandler);

    await processor({ data: job } as Job<NotificationDeliveryJob>);

    // The payload, not the BullMQ job: the handler knows nothing about the queue
    // and a job's internals never reach a domain decision.
    expect(handle).toHaveBeenCalledExactlyOnceWith(job);
  });

  it("propagates a handler failure so BullMQ owns the retry", async () => {
    const handle = vi.fn(() => Promise.reject(new Error("retry me")));
    const processor = createNotificationDeliveryProcessor({
      handle,
    } as unknown as NotificationDeliveryHandler);

    await expect(processor({ data: job } as Job<NotificationDeliveryJob>)).rejects.toThrow(
      /retry me/
    );
  });

  it("is a Nest provider the worker module can register", () => {
    // Wired through DI rather than constructed by hand, which is what lets the
    // composition root substitute the handler's four seams.
    expect(typeof NotificationDeliveryConsumer).toBe("function");
  });
});
