import { describe, expect, it, vi } from "vitest";
import type { Job } from "bullmq";
import type { BrandingResetCleanupJob } from "@newsaas/shared";
import type { BrandingResetCleanupHandler } from "./cleanup.handler.js";
import { createCleanupProcessor } from "./cleanup.consumer.js";

describe("createCleanupProcessor", () => {
  it("forwards the payload intent id to the handler", async () => {
    const handle = vi.fn().mockResolvedValue("completed");
    const handler = { handle } as unknown as BrandingResetCleanupHandler;
    const processor = createCleanupProcessor(handler);

    await processor({ data: { intentId: "intent-1" } } as Job<BrandingResetCleanupJob>);

    expect(handle).toHaveBeenCalledTimes(1);
    expect(handle).toHaveBeenCalledWith("intent-1");
  });

  it("propagates handler failures so BullMQ can retry", async () => {
    const handle = vi.fn().mockRejectedValue(new Error("storage down"));
    const handler = { handle } as unknown as BrandingResetCleanupHandler;
    const processor = createCleanupProcessor(handler);

    await expect(
      processor({ data: { intentId: "intent-2" } } as Job<BrandingResetCleanupJob>)
    ).rejects.toThrow("storage down");
  });
});
