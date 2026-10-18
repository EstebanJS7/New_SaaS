import { describe, expect, it } from "vitest";
import {
  FISCAL_SUBMISSION_BACKOFF_DELAY_MS,
  FISCAL_SUBMISSION_MAX_ATTEMPTS,
  fiscalSubmissionJobOptions,
  type FiscalSubmissionJob,
} from "./fiscal-submission.queue.js";

describe("fiscal submission queue contract", () => {
  it("derives a stable job id from the fiscal document id", () => {
    expect(fiscalSubmissionJobOptions("document-1").jobId).toBe("fiscal-submit-document-1");
    expect(fiscalSubmissionJobOptions("document-1").jobId).toBe(
      fiscalSubmissionJobOptions("document-1").jobId
    );
  });

  it("keeps the id free of the colon BullMQ refuses", () => {
    // TD-039. Measured against bullmq 5.81.3 with a real Redis, not reasoned
    // about: `queue.add(name, data, { jobId: "fiscal-submit:abc" })` throws
    // `Error: Custom Id cannot contain :`, and this id used that separator
    // until the fix. A mocked Queue cannot reach the rule — it lives in BullMQ's
    // `Job` constructor — so the literal above stayed green while production
    // could not enqueue a single document. The shape is asserted here instead.
    for (const id of ["document-1", "9a1f4c2d-0b7e-4a11-9d3c-5f2b8e6a71c4", "0f1e2d3c"]) {
      expect(fiscalSubmissionJobOptions(id).jobId).not.toContain(":");
    }
  });

  it("gives different documents different job ids", () => {
    expect(fiscalSubmissionJobOptions("document-1").jobId).not.toBe(
      fiscalSubmissionJobOptions("document-2").jobId
    );
  });

  it("pins the bounded exponential retry policy", () => {
    const options = fiscalSubmissionJobOptions("document-1");
    expect(FISCAL_SUBMISSION_MAX_ATTEMPTS).toBe(5);
    expect(FISCAL_SUBMISSION_BACKOFF_DELAY_MS).toBe(1_000);
    expect(options.attempts).toBe(5);
    expect(options.backoff).toEqual({ type: "exponential", delay: 1_000 });
  });

  it("retains failed jobs but removes completed jobs", () => {
    expect(fiscalSubmissionJobOptions("document-1")).toMatchObject({
      removeOnComplete: true,
      removeOnFail: false,
    });
  });

  it("defines a payload containing exactly the two stable ids", () => {
    const payload: FiscalSubmissionJob = { fiscalDocumentId: "document-1", tenantId: "tenant-1" };
    expect(Object.keys(payload).sort()).toEqual(["fiscalDocumentId", "tenantId"]);
  });
});
