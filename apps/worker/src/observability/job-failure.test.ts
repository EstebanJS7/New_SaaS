import { beforeEach, describe, expect, it, vi } from "vitest";

const captured: { error: unknown; context: unknown }[] = [];
vi.mock("@newsaas/observability", () => ({
  captureError: (error: unknown, context: unknown) => captured.push({ error, context }),
}));

const { reportJobFailure, reportWorkerError } = await import("./job-failure.js");

beforeEach(() => {
  captured.length = 0;
});

describe("job failure reporting (DEC-093)", () => {
  it("stays silent while BullMQ will still retry the job", () => {
    reportJobFailure(
      "fiscal-submission",
      { attemptsMade: 1, opts: { attempts: 3 } },
      new Error("x")
    );
    expect(captured).toHaveLength(0);
  });

  it("reports once the last attempt failed, with the queue name only", () => {
    const error = new Error("provider down");
    reportJobFailure("fiscal-submission", { attemptsMade: 3, opts: { attempts: 3 } }, error);
    reportJobFailure("imports", { attemptsMade: 1, opts: {} }, error);
    expect(captured).toEqual([
      { error, context: { job: "fiscal-submission" } },
      { error, context: { job: "imports" } },
    ]);
  });

  it("reports a worker-level error and a failure with no job", () => {
    reportWorkerError("notifications", new Error("redis"));
    reportJobFailure("notifications", undefined, new Error("lock"));
    expect(captured).toHaveLength(2);
  });
});
