import { describe, expect, it } from "vitest";
import {
  FISCAL_SUBMISSION_BACKOFF_DELAY_MS,
  FISCAL_SUBMISSION_MAX_ATTEMPTS,
  fiscalSubmissionJobOptions,
  type FiscalSubmissionJob,
} from "./fiscal-submission.queue.js";

describe("fiscal submission queue contract", () => {
  it("derives a stable job id from the fiscal document id", () => {
    expect(fiscalSubmissionJobOptions("document-1").jobId).toBe("fiscal-submit:document-1");
    expect(fiscalSubmissionJobOptions("document-1").jobId).toBe(
      fiscalSubmissionJobOptions("document-1").jobId
    );
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
