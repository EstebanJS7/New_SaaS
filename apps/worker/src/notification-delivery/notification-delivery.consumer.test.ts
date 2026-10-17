import { describe, expect, it, vi } from "vitest";
import type { Job } from "bullmq";
import {
  NOTIFICATION_DELIVERY_JOB,
  NOTIFICATION_DELIVERY_QUEUE,
  type NotificationDeliveryJob,
} from "@newsaas/notifications";
import { NotificationChannelsModule } from "@newsaas/notifications";
import {
  createNotificationDeliveryProcessor,
  NotificationDeliveryConsumer,
} from "./notification-delivery.consumer.js";
import { NotificationDeliveryHandler } from "./notification-delivery.handler.js";
import { WorkerModule } from "../worker.module.js";

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

  /**
   * Wired through DI rather than constructed by hand, which is what lets the
   * composition root substitute the handler's four seams.
   *
   * Asserted against the module's own metadata (the `fiscal.module.test.ts`
   * pattern) rather than with `expect(typeof X).toBe("function")`, which every
   * class satisfies and which therefore asserted nothing (TD-041 R3-003).
   */
  describe("the worker module's registration", () => {
    it("registers the channel selection, the handler and the consumer", () => {
      const imports: unknown = Reflect.getMetadata("imports", WorkerModule);
      const providers: unknown = Reflect.getMetadata("providers", WorkerModule);

      expect(Array.isArray(imports)).toBe(true);
      expect(Array.isArray(providers)).toBe(true);
      if (!Array.isArray(imports) || !Array.isArray(providers)) {
        throw new Error("WorkerModule declares no imports or providers metadata.");
      }

      const importedModules = imports
        .filter(
          (entry): entry is { readonly module: unknown } =>
            typeof entry === "object" && entry !== null && "module" in entry
        )
        .map((entry) => entry.module);
      expect(importedModules).toContain(NotificationChannelsModule);

      expect(providers).toContain(NotificationDeliveryHandler);
      expect(providers).toContain(NotificationDeliveryConsumer);
    });
  });
});
