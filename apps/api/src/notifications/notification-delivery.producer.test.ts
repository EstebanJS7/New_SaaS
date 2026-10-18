import { describe, expect, it, vi } from "vitest";
import type { Queue } from "bullmq";
import type { Redis } from "ioredis";
import { NOTIFICATION_DELIVERY_JOB, notificationDeliveryJobId } from "@newsaas/notifications";
import {
  BullMqNotificationDeliveryProducer,
  NOTIFICATION_DELIVERY_PRODUCER_REDIS_OPTIONS,
} from "./notification-delivery.producer.js";

const job = {
  notificationDeliveryId: "11111111-1111-1111-1111-111111111111",
  tenantId: "22222222-2222-2222-2222-222222222222",
};
const scheduledAt = new Date("2026-10-17T12:00:00.000Z");

describe("the notification delivery producer", () => {
  it("enqueues the shared job name, payload and delayed options", async () => {
    const add = vi.fn((_name: string, _data: unknown, _options?: Record<string, unknown>) =>
      Promise.resolve({ id: "job-1" })
    );
    const producer = new BullMqNotificationDeliveryProducer({
      add,
      remove: vi.fn(),
    } as unknown as Queue);

    await producer.enqueue(job, scheduledAt);

    // Destructured rather than matched with `expect.any(Number)`: that matcher is
    // typed `any`, and the repo's lint forbids letting one into a checked shape.
    const [name, payload, options] = add.mock.calls[0] ?? [];
    expect(name).toBe(NOTIFICATION_DELIVERY_JOB);
    expect(payload).toEqual(job);
    expect(options).toMatchObject({
      jobId: notificationDeliveryJobId(job.notificationDeliveryId),
      attempts: 5,
      backoff: { type: "exponential", delay: 1_000 },
      removeOnComplete: true,
      removeOnFail: false,
    });
    // The delay is derived from the delivery's own instant and clamped at zero,
    // so a past instant means "due now" rather than a negative delay.
    expect(Number(options?.delay)).toBeGreaterThanOrEqual(0);
    expect(Number(options?.delay)).toBeLessThanOrEqual(
      Math.max(0, scheduledAt.getTime() - Date.now())
    );
  });

  it("removes a pending job by the deterministic identity the queue holds", async () => {
    const remove = vi.fn(() => Promise.resolve(1));
    const producer = new BullMqNotificationDeliveryProducer({
      add: vi.fn(),
      remove,
    } as unknown as Queue);

    await producer.cancel(job.notificationDeliveryId);

    expect(remove).toHaveBeenCalledExactlyOnceWith(
      notificationDeliveryJobId(job.notificationDeliveryId)
    );
  });

  it("treats a removal failure as success, because the row is the record", async () => {
    // A job that is already gone is exactly what a cancellation wants to find,
    // and a queue hiccup must not make a completed cancellation look failed.
    const remove = vi.fn(() => Promise.reject(new Error("job not found")));
    const producer = new BullMqNotificationDeliveryProducer({
      add: vi.fn(),
      remove,
    } as unknown as Queue);

    await expect(producer.cancel(job.notificationDeliveryId)).resolves.toBeUndefined();
  });

  it("bounds the enqueue so an unreachable Redis cannot hang a post-commit reaction", async () => {
    vi.useFakeTimers();
    try {
      const add = vi.fn(() => new Promise<never>(() => undefined));
      const producer = new BullMqNotificationDeliveryProducer({ add } as unknown as Queue);

      const pending = producer.enqueue(job, scheduledAt);
      const assertion = expect(pending).rejects.toThrow(/exceeded 2000ms/);
      await vi.advanceTimersByTimeAsync(2_100);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it("pins the fail-fast producer Redis options", () => {
    // `maxRetriesPerRequest: null` belongs to a worker; here it would keep
    // retrying instead of rejecting, which turns a Redis blip into a hung
    // reaction.
    expect(NOTIFICATION_DELIVERY_PRODUCER_REDIS_OPTIONS).toEqual({
      maxRetriesPerRequest: 2,
      enableOfflineQueue: false,
      connectTimeout: 2_000,
    });
  });

  it("closes its queue and its owned connection once", async () => {
    const close = vi.fn(() => Promise.resolve());
    const quit = vi.fn(() => Promise.resolve("OK"));
    const producer = new BullMqNotificationDeliveryProducer(
      { add: vi.fn(), remove: vi.fn(), close } as unknown as Queue,
      { quit, disconnect: vi.fn() } as unknown as Redis
    );

    await producer.onModuleDestroy();
    await producer.onModuleDestroy();

    expect(close).toHaveBeenCalledTimes(1);
    expect(quit).toHaveBeenCalledTimes(1);
  });
});
