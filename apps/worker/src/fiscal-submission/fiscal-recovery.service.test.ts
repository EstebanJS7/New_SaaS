import { describe, expect, it } from "vitest";
import {
  FISCAL_SUBMISSION_JOB,
  fiscalSubmissionJobId,
  fiscalSubmissionJobOptions,
} from "@newsaas/fiscal";
import {
  recoverStaleFiscalSubmissions,
  redriveFiscalSubmission,
  type RecoverDocumentRow,
  type RedriveJob,
  type RedriveQueue,
  type RecoverDocumentDelegate,
} from "./fiscal-recovery.service.js";

type FindManyArgs = Parameters<RecoverDocumentDelegate["findMany"]>[0];

const document: RecoverDocumentRow = {
  id: "00000000-0000-4000-8000-000000000001",
  tenantId: "00000000-0000-4000-8000-000000000002",
  status: "ERROR",
  attemptCount: 5,
};

function makeDocumentDelegate(rows: readonly RecoverDocumentRow[]) {
  const queries: FindManyArgs[] = [];
  const delegate: RecoverDocumentDelegate = {
    findMany: (args) => {
      queries.push(args);
      return Promise.resolve([...rows]);
    },
  };
  return { delegate, queries };
}

/** Records every queue interaction so the removal-before-add order is observable. */
function makeRedriveQueue(state: string | undefined) {
  const calls: string[] = [];
  const added: { name: string; payload: unknown; options: unknown }[] = [];
  const job: RedriveJob = {
    getState: () => {
      calls.push("getState");
      return Promise.resolve(state ?? "unknown");
    },
    remove: () => {
      calls.push("remove");
      return Promise.resolve();
    },
  };
  const queue: RedriveQueue = {
    getJob: (jobId) => {
      calls.push(`getJob:${jobId}`);
      return Promise.resolve(state === undefined ? undefined : job);
    },
    add: (name, payload, options) => {
      calls.push("add");
      added.push({ name, payload, options });
      return Promise.resolve(undefined);
    },
  };
  return { queue, calls, added };
}

describe("recoverStaleFiscalSubmissions", () => {
  it("re-drives stale QUEUED and ERROR documents and reports counts", async () => {
    const rows: RecoverDocumentRow[] = [
      { ...document, status: "QUEUED", attemptCount: 0 },
      { ...document, id: "00000000-0000-4000-8000-000000000003" },
    ];
    const { delegate } = makeDocumentDelegate(rows);
    const seen: string[] = [];

    const result = await recoverStaleFiscalSubmissions({
      fiscalDocument: delegate,
      redrive: (row) => {
        seen.push(row.id);
        return Promise.resolve();
      },
      now: new Date("2026-10-03T12:00:00.000Z"),
      staleMs: 300_000,
    });

    expect(result).toEqual({ scanned: 2, requeued: 2, failed: 0 });
    expect(seen).toEqual(rows.map((row) => row.id));
  });

  it("queries the coalesce staleness predicate and the batch limit", async () => {
    const { delegate, queries } = makeDocumentDelegate([]);

    await recoverStaleFiscalSubmissions({
      fiscalDocument: delegate,
      redrive: () => Promise.resolve(),
      now: new Date("2026-10-03T12:00:00.000Z"),
      staleMs: 300_000,
      batchLimit: 25,
    });

    const query = queries[0];
    // A QUEUED document has never been attempted, so `createdAt` is its only
    // staleness signal; an ERROR document carries `lastAttemptAt`.
    expect(query?.where.status).toEqual({ in: ["QUEUED", "ERROR"] });
    expect(query?.where.OR).toEqual([
      { lastAttemptAt: { lt: new Date("2026-10-03T11:55:00.000Z") } },
      { lastAttemptAt: null, createdAt: { lt: new Date("2026-10-03T11:55:00.000Z") } },
    ]);
    expect(query?.orderBy).toEqual({ createdAt: "asc" });
    expect(query?.take).toBe(25);
  });

  it("defaults the batch limit", async () => {
    const { delegate, queries } = makeDocumentDelegate([]);

    await recoverStaleFiscalSubmissions({
      fiscalDocument: delegate,
      redrive: () => Promise.resolve(),
      now: new Date(),
      staleMs: 1_000,
    });

    expect(queries[0]?.take).toBe(100);
  });

  it("counts one re-drive failure without aborting the sweep", async () => {
    const rows: RecoverDocumentRow[] = [
      { ...document, id: "a" },
      { ...document, id: "b" },
      { ...document, id: "c" },
    ];
    const { delegate } = makeDocumentDelegate(rows);
    const seen: string[] = [];

    const result = await recoverStaleFiscalSubmissions({
      fiscalDocument: delegate,
      redrive: (row) => {
        if (row.id === "b") return Promise.reject(new Error("redis down"));
        seen.push(row.id);
        return Promise.resolve();
      },
      now: new Date(),
      staleMs: 1_000,
    });

    expect(result).toEqual({ scanned: 3, requeued: 2, failed: 1 });
    expect(seen).toEqual(["a", "c"]);
  });

  it("returns zeroes for an empty backlog", async () => {
    const { delegate } = makeDocumentDelegate([]);

    const result = await recoverStaleFiscalSubmissions({
      fiscalDocument: delegate,
      redrive: () => Promise.resolve(),
      now: new Date(),
      staleMs: 1_000,
    });

    expect(result).toEqual({ scanned: 0, requeued: 0, failed: 0 });
  });
});

describe("redriveFiscalSubmission", () => {
  it("removes a failed job before re-adding the deterministic identity", async () => {
    // Without the removal, BullMQ deduplicates the add by jobId and the sweep
    // silently does nothing — the whole point of this branch.
    const { queue, calls, added } = makeRedriveQueue("failed");

    const outcome = await redriveFiscalSubmission(queue, document);

    expect(outcome).toBe("requeued");
    expect(calls).toEqual([
      `getJob:${fiscalSubmissionJobId(document.id)}`,
      "getState",
      "remove",
      "add",
    ]);
    expect(added).toEqual([
      {
        name: FISCAL_SUBMISSION_JOB,
        payload: { fiscalDocumentId: document.id, tenantId: document.tenantId },
        options: fiscalSubmissionJobOptions(document.id),
      },
    ]);
  });

  it("removes a completed job too", async () => {
    const { queue, calls } = makeRedriveQueue("completed");

    expect(await redriveFiscalSubmission(queue, document)).toBe("requeued");
    expect(calls).toContain("remove");
    expect(calls).toContain("add");
  });

  it.each(["waiting", "active", "delayed"])("leaves a %s job alone", async (state) => {
    // A live delivery already exists, so re-adding would race the worker that
    // owns it.
    const { queue, calls, added } = makeRedriveQueue(state);

    expect(await redriveFiscalSubmission(queue, document)).toBe("skipped");
    expect(calls).not.toContain("remove");
    expect(calls).not.toContain("add");
    expect(added).toEqual([]);
  });

  it("adds plainly when no job exists", async () => {
    // The R4-1 path: the document was committed QUEUED and the enqueue failed,
    // so there is nothing to remove.
    const { queue, calls, added } = makeRedriveQueue(undefined);

    expect(await redriveFiscalSubmission(queue, document)).toBe("requeued");
    expect(calls).toEqual([`getJob:${fiscalSubmissionJobId(document.id)}`, "add"]);
    expect(added).toHaveLength(1);
  });
});
