import { describe, expect, it, vi } from "vitest";
import type { Job } from "bullmq";
import {
  IMPORT_PREVIEW_JOB,
  IMPORT_PROCESSING_QUEUE,
  type ImportPreviewJob,
} from "@newsaas/imports";
import { createImportPreviewProcessor, ImportPreviewConsumer } from "./preview.consumer.js";
import { ImportPreviewHandler } from "./preview.handler.js";
import { WorkerModule } from "../worker.module.js";

const job: ImportPreviewJob = {
  importJobId: "00000000-0000-4000-8000-000000000001",
};

describe("import preview consumer", () => {
  it("names the queue the producer and the consumer share", () => {
    // The contract is the package's, so the two deployables cannot disagree about
    // which queue a preview is enqueued on and consumed from.
    expect(IMPORT_PROCESSING_QUEUE).toBe("import-processing");
    expect(IMPORT_PREVIEW_JOB).toBe("preview");
  });

  it("hands the job's payload to the handler and nothing else", async () => {
    const handle = vi.fn(() => Promise.resolve());
    const processor = createImportPreviewProcessor({
      handle,
    } as unknown as ImportPreviewHandler);

    await processor({ data: job } as Job<ImportPreviewJob>);

    // The payload, not the BullMQ job: the handler knows nothing about the queue,
    // and a job's internals never reach a domain decision.
    expect(handle).toHaveBeenCalledExactlyOnceWith(job);
  });

  it("propagates a handler failure so BullMQ owns the retry", async () => {
    const handle = vi.fn(() => Promise.reject(new Error("retry me")));
    const processor = createImportPreviewProcessor({
      handle,
    } as unknown as ImportPreviewHandler);

    await expect(processor({ data: job } as Job<ImportPreviewJob>)).rejects.toThrow(/retry me/);
  });

  /**
   * Wired through DI rather than constructed by hand, so the composition root is
   * what supplies the handler's storage port. Asserted against the module's own
   * metadata (the notification consumer's pattern), which is what catches a
   * registration that was written but never added to the module.
   */
  describe("the worker module's registration", () => {
    it("registers the preview handler and its consumer", () => {
      const providers: unknown = Reflect.getMetadata("providers", WorkerModule);

      expect(Array.isArray(providers)).toBe(true);
      if (!Array.isArray(providers)) {
        throw new Error("WorkerModule declares no providers metadata.");
      }

      expect(providers).toContain(ImportPreviewHandler);
      expect(providers).toContain(ImportPreviewConsumer);
    });
  });
});
