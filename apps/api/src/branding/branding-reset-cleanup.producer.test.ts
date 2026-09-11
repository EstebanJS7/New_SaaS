import { describe, expect, it, vi } from "vitest";
import type { Queue } from "bullmq";
import type { Redis } from "ioredis";
import { brandingResetCleanupJobOptions } from "@newsaas/shared";
import {
  BRANDING_RESET_CLEANUP_JOB,
  BullMqCleanupProducer,
} from "./branding-reset-cleanup.producer.js";

describe("BullMqCleanupProducer", () => {
  it("enqueues the intent id as payload, dedupe job id, and bounded retry policy", async () => {
    const add = vi.fn().mockResolvedValue({ id: "intent-1" });
    const queue = { add } as unknown as Queue;
    const producer = new BullMqCleanupProducer(queue);

    await producer.enqueue("intent-1");

    expect(add).toHaveBeenCalledTimes(1);
    expect(add).toHaveBeenCalledWith(
      BRANDING_RESET_CLEANUP_JOB,
      { intentId: "intent-1" },
      brandingResetCleanupJobOptions("intent-1")
    );
  });

  it("propagates queue errors so the caller can treat enqueue as non-fatal", async () => {
    const add = vi.fn().mockRejectedValue(new Error("redis down"));
    const queue = { add } as unknown as Queue;
    const producer = new BullMqCleanupProducer(queue);

    await expect(producer.enqueue("intent-2")).rejects.toThrow("redis down");
  });

  it("closes the queue and quits its owned connection exactly once on shutdown", async () => {
    const add = vi.fn().mockResolvedValue({ id: "intent-1" });
    const close = vi.fn().mockResolvedValue(undefined);
    const quit = vi.fn().mockResolvedValue("OK");
    const disconnect = vi.fn();
    const queue = { add, close } as unknown as Queue;
    const connection = { quit, disconnect } as unknown as Redis;
    const producer = new BullMqCleanupProducer(queue, connection);

    await producer.onModuleDestroy();

    expect(close).toHaveBeenCalledTimes(1);
    expect(quit).toHaveBeenCalledTimes(1);
    expect(disconnect).not.toHaveBeenCalled();

    // Idempotent: Nest may invoke the hook more than once across shutdown paths.
    await producer.onModuleDestroy();
    expect(close).toHaveBeenCalledTimes(1);
    expect(quit).toHaveBeenCalledTimes(1);
  });

  it("falls back to a hard disconnect when the graceful quit fails", async () => {
    const close = vi.fn().mockResolvedValue(undefined);
    const quit = vi.fn().mockRejectedValue(new Error("socket already gone"));
    const disconnect = vi.fn();
    const queue = { add: vi.fn(), close } as unknown as Queue;
    const connection = { quit, disconnect } as unknown as Redis;
    const producer = new BullMqCleanupProducer(queue, connection);

    await producer.onModuleDestroy();

    expect(disconnect).toHaveBeenCalledTimes(1);
  });
});
