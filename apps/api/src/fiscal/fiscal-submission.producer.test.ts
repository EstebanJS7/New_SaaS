import { describe, expect, it, vi } from "vitest";
import type { Queue } from "bullmq";
import type { Redis } from "ioredis";
import { FISCAL_SUBMISSION_JOB, fiscalSubmissionJobOptions } from "@newsaas/fiscal";
import {
  BullMqFiscalSubmissionProducer,
  FISCAL_SUBMISSION_PRODUCER_REDIS_OPTIONS,
} from "./fiscal-submission.producer.js";

const document = { fiscalDocumentId: "document-1", tenantId: "tenant-1" };

describe("BullMqFiscalSubmissionProducer", () => {
  it("enqueues the job name, stable-id payload, job id, and full options", async () => {
    const add = vi.fn().mockResolvedValue({ id: "fiscal-submit:document-1" });
    const queue = { add } as unknown as Queue;
    const producer = new BullMqFiscalSubmissionProducer(queue);

    await producer.enqueue(document);

    expect(add).toHaveBeenCalledTimes(1);
    expect(add).toHaveBeenCalledWith(FISCAL_SUBMISSION_JOB, document, {
      ...fiscalSubmissionJobOptions(document.fiscalDocumentId),
    });
    expect(add.mock.calls[0]?.[2]).toEqual({
      jobId: "fiscal-submit:document-1",
      attempts: 5,
      backoff: { type: "exponential", delay: 1_000 },
      removeOnComplete: true,
      removeOnFail: false,
    });
  });

  it("bounds the enqueue so an unreachable Redis cannot hang the request", async () => {
    // The command awaits this on the HTTP path, so an `add` that never settles
    // must reject rather than hold a Nest handler and a Fastify connection open
    // until the client gives up.
    vi.useFakeTimers();
    try {
      const add = vi.fn(() => new Promise<never>(() => undefined));
      const producer = new BullMqFiscalSubmissionProducer({ add } as unknown as Queue);
      const pending = producer.enqueue(document);
      const assertion = expect(pending).rejects.toThrow(/enqueue exceeded/);
      await vi.advanceTimersByTimeAsync(5_000);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it("pins fail-fast producer connection options", () => {
    // `maxRetriesPerRequest: null` is the worker setting; for a producer on a
    // request path it keeps retrying indefinitely instead of rejecting, and an
    // offline queue would buffer commands against a connection that is not ready.
    expect(FISCAL_SUBMISSION_PRODUCER_REDIS_OPTIONS).toEqual({
      maxRetriesPerRequest: 2,
      enableOfflineQueue: false,
      connectTimeout: 2_000,
    });
  });

  it("propagates queue errors", async () => {
    const add = vi.fn().mockRejectedValue(new Error("redis down"));
    const producer = new BullMqFiscalSubmissionProducer({ add } as unknown as Queue);

    await expect(producer.enqueue(document)).rejects.toThrow("redis down");
  });

  it("closes the queue then quits the owned connection exactly once", async () => {
    const teardownOrder: string[] = [];
    const close = vi.fn().mockImplementation(() => {
      teardownOrder.push("close");
      return Promise.resolve();
    });
    const quit = vi.fn().mockImplementation(() => {
      teardownOrder.push("quit");
      return Promise.resolve("OK");
    });
    const disconnect = vi.fn();
    const producer = new BullMqFiscalSubmissionProducer(
      { add: vi.fn(), close } as unknown as Queue,
      { quit, disconnect } as unknown as Redis
    );

    await producer.onModuleDestroy();
    expect(close).toHaveBeenCalledTimes(1);
    expect(quit).toHaveBeenCalledTimes(1);
    expect(disconnect).not.toHaveBeenCalled();
    expect(teardownOrder).toEqual(["close", "quit"]);

    await producer.onModuleDestroy();
    expect(close).toHaveBeenCalledTimes(1);
    expect(quit).toHaveBeenCalledTimes(1);
  });

  it("falls back to disconnect when graceful quit rejects", async () => {
    const quit = vi.fn().mockRejectedValue(new Error("socket already gone"));
    const disconnect = vi.fn();
    const producer = new BullMqFiscalSubmissionProducer(
      { add: vi.fn(), close: vi.fn().mockResolvedValue(undefined) } as unknown as Queue,
      { quit, disconnect } as unknown as Redis
    );

    await producer.onModuleDestroy();

    expect(quit).toHaveBeenCalledTimes(1);
    expect(disconnect).toHaveBeenCalledTimes(1);
  });
});
