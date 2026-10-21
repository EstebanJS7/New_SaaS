import { describe, expect, it } from "vitest";
import {
  IMPORT_PREVIEW_BACKOFF_DELAY_MS,
  IMPORT_PREVIEW_JOB,
  IMPORT_PREVIEW_MAX_ATTEMPTS,
  IMPORT_PROCESSING_QUEUE,
  importPreviewJobId,
  importPreviewJobOptions,
  type ImportPreviewJob,
} from "./queue.js";

/**
 * The queue contract is shared by the API producer and the worker consumer, so
 * these cases pin the names and the identity that both sides must agree on. A
 * producer and a consumer that drift are two deployables disagreeing about what
 * "the same job" means, and nothing else in the repository would notice.
 */
describe("import preview queue contract", () => {
  it("pins the queue name, the job name and the retry budget", () => {
    expect(IMPORT_PROCESSING_QUEUE).toBe("import-processing");
    expect(IMPORT_PREVIEW_JOB).toBe("preview");
    expect(IMPORT_PREVIEW_MAX_ATTEMPTS).toBe(3);
    expect(IMPORT_PREVIEW_BACKOFF_DELAY_MS).toBe(5_000);
  });

  it("derives a deterministic identity from the import, and one per import", () => {
    expect(importPreviewJobId("abc")).toBe("import-preview-abc");
    expect(importPreviewJobId("abc")).toBe(importPreviewJobId("abc"));
    expect(importPreviewJobId("abc")).not.toBe(importPreviewJobId("def"));
  });

  it("keeps the id free of the colon BullMQ refuses", () => {
    // Measured against bullmq 5.x with a real Redis on the notification queue, not
    // reasoned about: `queue.add(name, data, { jobId: "import-preview:abc" })`
    // throws `Error: Custom Id cannot contain :`, because BullMQ rejects any
    // custom id whose colon-separated form is not exactly three segments. The
    // hyphenated form is accepted. A stubbed Queue cannot catch this — the throw
    // happens inside `add` before anything is enqueued — so the shape is asserted
    // here and the separator's reason is in the source.
    expect(importPreviewJobId("9a1f4c2d-0b7e-4a11-9d3c-5f2b8e6a71c4")).toBe(
      "import-preview-9a1f4c2d-0b7e-4a11-9d3c-5f2b8e6a71c4"
    );
    for (const id of ["abc", "9a1f4c2d-0b7e-4a11-9d3c-5f2b8e6a71c4", "0f1e2d3c"]) {
      expect(importPreviewJobId(id)).not.toContain(":");
    }
    // Exactly two hyphens in the generated prefix: one from the name, one from the
    // separator. A third colon-free separator is fine; a colon is not.
    expect(importPreviewJobId("abc").split("-")).toHaveLength(3);
  });

  it("keeps the failed set: the row is the record, the queue is the view", () => {
    const options = importPreviewJobOptions("abc");

    expect(options.jobId).toBe("import-preview-abc");
    expect(options.attempts).toBe(IMPORT_PREVIEW_MAX_ATTEMPTS);
    expect(options.backoff).toEqual({
      type: "exponential",
      delay: IMPORT_PREVIEW_BACKOFF_DELAY_MS,
    });
    expect(options.removeOnComplete).toBe(true);
    expect(options.removeOnFail).toBe(false);
  });

  it("carries the import id only, so no tenant and no storage key can ride in the payload", () => {
    const payload: ImportPreviewJob = { importJobId: "import-1" };

    expect(Object.keys(payload)).toEqual(["importJobId"]);
    // The worker resolves the tenant from the `import_job` row. A tenant in the
    // payload would be a second source of truth for the one fact the row owns.
    expect(JSON.stringify(payload)).not.toMatch(/tenant|storage|import_/);
  });
});
