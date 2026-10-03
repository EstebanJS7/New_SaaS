import { describe, expect, it, vi } from "vitest";
import type { Job } from "bullmq";
import type { FiscalSubmissionJob } from "@newsaas/fiscal";
import type { FiscalSubmissionHandler } from "./fiscal-submission.handler.js";
import { createFiscalSubmissionProcessor } from "./fiscal-submission.consumer.js";

describe("createFiscalSubmissionProcessor", () => {
  it("forwards job.data to the handler", async () => {
    const handle = vi.fn().mockResolvedValue(undefined);
    const handler = { handle } as unknown as FiscalSubmissionHandler;
    const processor = createFiscalSubmissionProcessor(handler);
    const payload = { fiscalDocumentId: "doc-1", tenantId: "tenant-1" };

    await processor({ data: payload } as Job<FiscalSubmissionJob>);

    expect(handle).toHaveBeenCalledExactlyOnceWith(payload);
  });

  it("propagates handler failures for BullMQ retry", async () => {
    const handle = vi.fn().mockRejectedValue(new Error("temporary failure"));
    const processor = createFiscalSubmissionProcessor({
      handle,
    } as unknown as FiscalSubmissionHandler);

    await expect(
      processor({
        data: { fiscalDocumentId: "doc-2", tenantId: "tenant-1" },
      } as Job<FiscalSubmissionJob>)
    ).rejects.toThrow("temporary failure");
  });
});
