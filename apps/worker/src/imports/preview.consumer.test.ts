import { describe, expect, it, vi } from "vitest";
import type { Job } from "bullmq";
import {
  IMPORT_COMMIT_JOB,
  IMPORT_PREVIEW_JOB,
  IMPORT_PROCESSING_QUEUE,
  type ImportCommitJob,
  type ImportPreviewJob,
} from "@newsaas/imports";
import { createImportProcessingProcessor, ImportProcessingConsumer } from "./preview.consumer.js";
import { ImportCommitHandler } from "./commit.handler.js";
import { ImportPreviewHandler } from "./preview.handler.js";
import { WorkerModule } from "../worker.module.js";

const previewJob: ImportPreviewJob = {
  importJobId: "00000000-0000-4000-8000-000000000001",
};
const commitJob: ImportCommitJob = {
  importJobId: "00000000-0000-4000-8000-000000000002",
};

function processor(handlers: {
  preview?: () => Promise<void>;
  commit?: () => Promise<void>;
}): (job: Job<ImportPreviewJob | ImportCommitJob>) => Promise<void> {
  return createImportProcessingProcessor(
    { handle: handlers.preview ?? (() => Promise.resolve()) } as unknown as ImportPreviewHandler,
    { handle: handlers.commit ?? (() => Promise.resolve()) } as unknown as ImportCommitHandler
  );
}

describe("import processing consumer", () => {
  it("names the queue the producer and the consumer share, and BOTH job names", () => {
    // The contract is the package's, so the two deployables cannot disagree about
    // which queue a phase is enqueued on and consumed from. Two names, one queue.
    expect(IMPORT_PROCESSING_QUEUE).toBe("import-processing");
    expect(IMPORT_PREVIEW_JOB).toBe("preview");
    expect(IMPORT_COMMIT_JOB).toBe("commit");
  });

  it("routes a PREVIEW job to the preview handler and nothing else", async () => {
    const preview = vi.fn(() => Promise.resolve());
    const commit = vi.fn(() => Promise.resolve());

    await processor({ preview, commit })({
      name: IMPORT_PREVIEW_JOB,
      data: previewJob,
    } as Job<ImportPreviewJob>);

    // The payload, not the BullMQ job: the handler knows nothing about the queue.
    expect(preview).toHaveBeenCalledExactlyOnceWith(previewJob);
    expect(commit).not.toHaveBeenCalled();
  });

  it("routes a COMMIT job to the commit handler and nothing else", async () => {
    const preview = vi.fn(() => Promise.resolve());
    const commit = vi.fn(() => Promise.resolve());

    await processor({ preview, commit })({
      name: IMPORT_COMMIT_JOB,
      data: commitJob,
    } as Job<ImportCommitJob>);

    // ONE consumer, dispatched by name: a second worker on this queue would have
    // received both kinds and had to drop half of them.
    expect(commit).toHaveBeenCalledExactlyOnceWith(commitJob);
    expect(preview).not.toHaveBeenCalled();
  });

  it("throws on a job name this deployment does not know, instead of acknowledging it", async () => {
    // A name from a newer deployment must not be silently marked processed.
    await expect(
      processor({})({
        name: "not-a-phase",
        data: previewJob,
      } as unknown as Job<ImportPreviewJob>)
    ).rejects.toThrow(/Unknown import job name: not-a-phase/);
  });

  it("propagates a handler failure so BullMQ owns the retry", async () => {
    const failing = (): Promise<void> => Promise.reject(new Error("retry me"));

    await expect(
      processor({ preview: failing })({
        name: IMPORT_PREVIEW_JOB,
        data: previewJob,
      } as Job<ImportPreviewJob>)
    ).rejects.toThrow(/retry me/);
    await expect(
      processor({ commit: failing })({
        name: IMPORT_COMMIT_JOB,
        data: commitJob,
      } as Job<ImportCommitJob>)
    ).rejects.toThrow(/retry me/);
  });

  /**
   * Wired through DI rather than constructed by hand, so the composition root is
   * what supplies the handlers' storage port. Asserted against the module's own
   * metadata (the notification consumer's pattern), which is what catches a
   * registration that was written but never added to the module.
   */
  describe("the worker module's registration", () => {
    it("registers both handlers and the ONE consumer of the import queue", () => {
      const providers: unknown = Reflect.getMetadata("providers", WorkerModule);

      expect(Array.isArray(providers)).toBe(true);
      if (!Array.isArray(providers)) {
        throw new Error("WorkerModule declares no providers metadata.");
      }

      expect(providers).toContain(ImportPreviewHandler);
      expect(providers).toContain(ImportCommitHandler);
      expect(providers).toContain(ImportProcessingConsumer);
    });
  });
});
