import { describe, expect, it } from "vitest";
import {
  FISCAL_SUBMISSION_JOB,
  SIFEN_BATCH_POLL_INTERVAL_MS,
  fiscalSubmissionJobId,
  fiscalSubmissionJobOptions,
  type FiscalQueryRequest,
  type FiscalQueryResult,
} from "@newsaas/fiscal";
import {
  DEFAULT_FISCAL_RECOVERY_MAX_ATTEMPTS,
  FISCAL_RECOVERY_BATCH_LIMIT,
} from "./fiscal-recovery.constants.js";
import {
  FISCAL_QUERY_CALL_FAILED_REASON_CODE,
  FISCAL_QUERY_CALL_FAILED_REASON,
  reconcileSubmittedFiscalDocuments,
  recoverStaleFiscalSubmissions,
  redriveFiscalSubmission,
  type FiscalRecoveryTransaction,
  type QueryDocumentDelegate,
  type QueryDocumentRow,
  type QueryFindManyArgs,
  type QueryUpdateManyArgs,
  type RecoverCountArgs,
  type RecoverDocumentDelegate,
  type RecoverDocumentRow,
  type RecoverFindManyArgs,
  type RedriveJob,
  type RedriveQueue,
} from "./fiscal-recovery.service.js";

const document: RecoverDocumentRow = {
  id: "00000000-0000-4000-8000-000000000001",
  tenantId: "00000000-0000-4000-8000-000000000002",
  status: "ERROR",
  attemptCount: 5,
};

function makeDocumentDelegate(rows: readonly RecoverDocumentRow[], cappedCount = 0) {
  const queries: RecoverFindManyArgs[] = [];
  const countQueries: RecoverCountArgs[] = [];
  const delegate: RecoverDocumentDelegate = {
    findMany: (args) => {
      queries.push(args);
      return Promise.resolve([...rows]);
    },
    count: (args) => {
      countQueries.push(args);
      return Promise.resolve(cappedCount);
    },
  };
  return { delegate, queries, countQueries };
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

const submittedRow: QueryDocumentRow = {
  id: "00000000-0000-4000-8000-000000000010",
  tenantId: "00000000-0000-4000-8000-000000000002",
  provider: "FAKE",
  cdc: "cdc-row-1",
  externalId: null,
  providerReference: "operation-1",
};

/** One query answer, with every field defaulted; cases override what they exercise. */
function queryResult(overrides: Partial<FiscalQueryResult> = {}): FiscalQueryResult {
  return {
    outcome: "APPROVED",
    cdc: "cdc-answer-1",
    externalId: "protocol-1",
    reasonCode: null,
    reason: null,
    retryAfterMs: null,
    providerRequest: { provider: "FAKE" },
    providerResponse: { provider: "FAKE" },
    resolvedAt: "2026-10-03T12:00:00.000Z",
    ...overrides,
  };
}

function makeQueryDelegate(rows: readonly QueryDocumentRow[]) {
  const queries: QueryFindManyArgs[] = [];
  const updates: QueryUpdateManyArgs[] = [];
  const delegate: QueryDocumentDelegate = {
    findMany: (args) => {
      queries.push(args);
      return Promise.resolve([...rows]);
    },
    updateMany: (args) => {
      updates.push(args);
      return Promise.resolve({ count: 1 });
    },
  };
  return { delegate, queries, updates };
}

type AuditRow = Parameters<FiscalRecoveryTransaction["auditLog"]["create"]>[0]["data"];

/** A transaction double that runs the work inline and records what it wrote. */
function makeTransaction(updates: QueryUpdateManyArgs[] = []) {
  const audits: AuditRow[] = [];
  const tx: FiscalRecoveryTransaction = {
    fiscalDocument: {
      updateMany: (args) => {
        updates.push(args);
        return Promise.resolve({ count: 1 });
      },
    },
    auditLog: {
      create: (args) => {
        audits.push(args.data);
        return Promise.resolve({ id: "audit-1" });
      },
    },
  };
  return {
    transaction: <R>(work: (transaction: FiscalRecoveryTransaction) => Promise<R>) => work(tx),
    updates,
    audits,
  };
}

/** The query double: a scripted list of answers whose last entry repeats. */
function makeQuery(script: readonly FiscalQueryResult[]) {
  const calls: FiscalQueryRequest[] = [];
  const query = (request: FiscalQueryRequest): Promise<FiscalQueryResult> => {
    calls.push(request);
    const result = script[Math.min(calls.length - 1, script.length - 1)];
    if (result === undefined) throw new Error("the query script is empty");
    return Promise.resolve(result);
  };
  return { query, calls };
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

    expect(result).toEqual({ scanned: 2, requeued: 2, failed: 0, capped: 0 });
    expect(seen).toEqual(rows.map((row) => row.id));
  });

  it("queries the coalesce staleness predicate, the batch limit and the attempt cap", async () => {
    const { delegate, queries } = makeDocumentDelegate([]);

    await recoverStaleFiscalSubmissions({
      fiscalDocument: delegate,
      redrive: () => Promise.resolve(),
      now: new Date("2026-10-03T12:00:00.000Z"),
      staleMs: 300_000,
      batchLimit: 25,
      maxAttempts: 7,
    });

    const query = queries[0];
    // A QUEUED document has never been attempted, so `createdAt` is its only
    // staleness signal; an ERROR document carries `lastAttemptAt`.
    expect(query?.where.status).toEqual({ in: ["QUEUED", "ERROR"] });
    expect(query?.where.OR).toEqual([
      { lastAttemptAt: { lt: new Date("2026-10-03T11:55:00.000Z") } },
      { lastAttemptAt: null, createdAt: { lt: new Date("2026-10-03T11:55:00.000Z") } },
    ]);
    // The cap: an ERROR row at or over the bound is not selected, so a permanent
    // failure stops being resubmitted. QUEUED is not an ERROR and is unaffected.
    expect(query?.where.NOT).toEqual({ status: "ERROR", attemptCount: { gte: 7 } });
    expect(query?.orderBy).toEqual({ createdAt: "asc" });
    expect(query?.take).toBe(25);
  });

  it("defaults the batch limit and the attempt cap", async () => {
    const { delegate, queries, countQueries } = makeDocumentDelegate([]);

    await recoverStaleFiscalSubmissions({
      fiscalDocument: delegate,
      redrive: () => Promise.resolve(),
      now: new Date(),
      staleMs: 1_000,
    });

    expect(queries[0]?.take).toBe(FISCAL_RECOVERY_BATCH_LIMIT);
    // Two BullMQ retry budgets: the first failed job's attempts plus one sweep
    // re-drive's. Pinned so a change to the operational bound is deliberate.
    expect(DEFAULT_FISCAL_RECOVERY_MAX_ATTEMPTS).toBe(10);
    expect(queries[0]?.where.NOT).toEqual({
      status: "ERROR",
      attemptCount: { gte: DEFAULT_FISCAL_RECOVERY_MAX_ATTEMPTS },
    });
    expect(countQueries[0]?.where).toEqual({
      status: "ERROR",
      attemptCount: { gte: DEFAULT_FISCAL_RECOVERY_MAX_ATTEMPTS },
    });
  });

  it("reports the ERROR rows the cap is holding back", async () => {
    const { delegate, countQueries } = makeDocumentDelegate([], 3);

    const result = await recoverStaleFiscalSubmissions({
      fiscalDocument: delegate,
      redrive: () => Promise.resolve(),
      now: new Date(),
      staleMs: 1_000,
      maxAttempts: 7,
    });

    // The selection excludes the capped rows on purpose, so without the count
    // the state would be invisible from the sweep's own result.
    expect(countQueries[0]?.where).toEqual({ status: "ERROR", attemptCount: { gte: 7 } });
    expect(result.capped).toBe(3);
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

    expect(result).toEqual({ scanned: 3, requeued: 2, failed: 1, capped: 0 });
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

    expect(result).toEqual({ scanned: 0, requeued: 0, failed: 0, capped: 0 });
  });
});

describe("reconcileSubmittedFiscalDocuments", () => {
  const now = new Date("2026-10-03T12:00:00.000Z");

  it("isolates a poisoned answer so the rest of the batch still reconciles", async () => {
    // The finding this case exists for: an answer the application cannot use used
    // to throw out of the loop with its marker unadvanced, so the row was
    // re-selected on every sweep and blocked every document behind it.
    const first: QueryDocumentRow = { ...submittedRow, id: "row-poisoned" };
    const second: QueryDocumentRow = { ...submittedRow, id: "row-healthy" };
    const { delegate, updates } = makeQueryDelegate([first, second]);
    const { query } = makeQuery([
      queryResult({ outcome: "APPROVED", resolvedAt: "" }),
      queryResult({ outcome: "APPROVED", resolvedAt: "2026-10-03T12:05:00.000Z" }),
    ]);
    // An unusable instant is rejected by the real client, so the double rejects
    // the first row's transaction: that is the path the guard exists for.
    let transactions = 0;
    const transaction = <R>(work: (tx: FiscalRecoveryTransaction) => Promise<R>): Promise<R> => {
      transactions += 1;
      if (transactions === 1) return Promise.reject(new Error("the database refused the write"));
      return work({
        fiscalDocument: {
          updateMany: (args) => {
            updates.push(args);
            return Promise.resolve({ count: 1 });
          },
        },
        auditLog: { create: () => Promise.resolve({ id: "audit-1" }) },
      });
    };

    const result = await reconcileSubmittedFiscalDocuments({
      fiscalDocument: delegate,
      query,
      transaction,
      now,
    });

    expect(result).toEqual({
      queried: 2,
      resolved: 1,
      processing: 0,
      unresolved: 0,
      unapplied: 1,
    });
    expect(updates[0]?.where).toEqual({
      id: "row-poisoned",
      tenantId: first.tenantId,
      status: "SUBMITTED",
    });
    expect(updates[0]?.data.lastErrorCode).toBe("QUERY_APPLICATION_FAILED");
    expect(String(updates[0]?.data.lastErrorMessage)).toContain("could not be applied");
    expect(updates[0]?.data.nextQueryAt).toBeInstanceOf(Date);
    expect(updates[1]?.data.status).toBe("APPROVED");
  });

  it("walks SUBMITTED rows whose marker is due or never set, bounded by the batch limit", async () => {
    const { delegate, queries } = makeQueryDelegate([submittedRow]);
    const { query } = makeQuery([queryResult()]);
    const { transaction } = makeTransaction();

    await reconcileSubmittedFiscalDocuments({
      fiscalDocument: delegate,
      query,
      transaction,
      now,
      batchLimit: 25,
    });

    expect(queries[0]).toEqual({
      where: {
        status: "SUBMITTED",
        OR: [{ nextQueryAt: { lte: now } }, { nextQueryAt: null }],
      },
      select: {
        id: true,
        tenantId: true,
        provider: true,
        cdc: true,
        externalId: true,
        providerReference: true,
      },
      orderBy: { nextQueryAt: "asc" },
      take: 25,
    });
  });

  it("defaults the batch limit", async () => {
    const { delegate, queries } = makeQueryDelegate([]);
    const { query } = makeQuery([queryResult()]);
    const { transaction } = makeTransaction();

    await reconcileSubmittedFiscalDocuments({
      fiscalDocument: delegate,
      query,
      transaction,
      now,
    });

    expect(queries[0]?.take).toBe(FISCAL_RECOVERY_BATCH_LIMIT);
  });

  it("asks the provider with the row's own identifiers", async () => {
    const { delegate } = makeQueryDelegate([submittedRow]);
    const { query, calls } = makeQuery([queryResult()]);
    const { transaction } = makeTransaction();

    await reconcileSubmittedFiscalDocuments({ fiscalDocument: delegate, query, transaction, now });

    // ADR-007 §2: the reference is the fast path and the CDC survives a lost
    // hand-over answer, so the port carries both and the adapter chooses.
    expect(calls[0]).toEqual({
      fiscalDocumentId: submittedRow.id,
      tenantId: submittedRow.tenantId,
      provider: submittedRow.provider,
      cdc: submittedRow.cdc,
      externalId: submittedRow.externalId,
      providerReference: submittedRow.providerReference,
    });
  });

  it("applies a terminal resolution with its identity and resolvedAt in one conditional update", async () => {
    const { delegate } = makeQueryDelegate([submittedRow]);
    const { query } = makeQuery([
      queryResult({ outcome: "APPROVED", cdc: "cdc-answer", externalId: "protocol-9" }),
    ]);
    const { transaction, updates, audits } = makeTransaction();

    const result = await reconcileSubmittedFiscalDocuments({
      fiscalDocument: delegate,
      query,
      transaction,
      now,
    });

    expect(result).toEqual({ queried: 1, resolved: 1, processing: 0, unresolved: 0, unapplied: 0 });
    // One update from SUBMITTED, in one transaction with the audit row: the
    // shape the handler's `persistResult` uses for the same resolution.
    expect(updates).toEqual([
      {
        where: { id: submittedRow.id, tenantId: submittedRow.tenantId, status: "SUBMITTED" },
        data: {
          status: "APPROVED",
          resolvedAt: new Date("2026-10-03T12:00:00.000Z"),
          cdc: "cdc-answer",
          externalId: "protocol-9",
          lastErrorCode: null,
          lastErrorMessage: null,
        },
      },
    ]);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      action: "fiscal.document.submitted",
      actorType: "SYSTEM",
      tenantId: submittedRow.tenantId,
      targetType: "fiscal_document",
      targetId: submittedRow.id,
      metadata: { outcome: "APPROVED", reasonCode: null },
    });
  });

  it("records a rejection's reason and never writes an absent identity as null", async () => {
    const { delegate } = makeQueryDelegate([submittedRow]);
    const { query } = makeQuery([
      queryResult({
        outcome: "REJECTED",
        cdc: null,
        externalId: null,
        reasonCode: "0362",
        reason: "rechazado",
      }),
    ]);
    const { transaction, updates, audits } = makeTransaction();

    const result = await reconcileSubmittedFiscalDocuments({
      fiscalDocument: delegate,
      query,
      transaction,
      now,
    });

    expect(result.resolved).toBe(1);
    expect(updates[0]?.data).toEqual({
      status: "REJECTED",
      resolvedAt: new Date("2026-10-03T12:00:00.000Z"),
      lastErrorCode: "0362",
      lastErrorMessage: "rechazado",
    });
    // A `null` write is a clearing attempt the guard refuses; an absent value
    // must write nothing.
    expect(updates[0]?.data).not.toHaveProperty("cdc");
    expect(updates[0]?.data).not.toHaveProperty("externalId");
    expect(audits[0]?.action).toBe("fiscal.document.submitted");
  });

  it("treats a FUNCTIONAL_REJECTION as a terminal rejection", async () => {
    // The query vocabulary carries it and the fake provider classifies it as a
    // resolved answer with an identity, so leaving it SUBMITTED would poll a
    // provider that already refused the document forever.
    const { delegate } = makeQueryDelegate([submittedRow]);
    const { query } = makeQuery([queryResult({ outcome: "FUNCTIONAL_REJECTION" })]);
    const { transaction, updates } = makeTransaction();

    const result = await reconcileSubmittedFiscalDocuments({
      fiscalDocument: delegate,
      query,
      transaction,
      now,
    });

    expect(result.resolved).toBe(1);
    expect(updates[0]?.data).toMatchObject({ status: "REJECTED" });
  });

  it("leaves a PROCESSING row SUBMITTED and moves the marker by the provider's hint", async () => {
    const { delegate, updates } = makeQueryDelegate([submittedRow]);
    const { query } = makeQuery([
      queryResult({ outcome: "PROCESSING", cdc: null, externalId: null, retryAfterMs: 120_000 }),
    ]);
    const { transaction, audits } = makeTransaction(updates);

    const result = await reconcileSubmittedFiscalDocuments({
      fiscalDocument: delegate,
      query,
      transaction,
      now,
    });

    expect(result).toEqual({ queried: 1, resolved: 0, processing: 1, unresolved: 0, unapplied: 0 });
    expect(updates).toEqual([
      {
        where: { id: submittedRow.id, tenantId: submittedRow.tenantId, status: "SUBMITTED" },
        data: { nextQueryAt: new Date(now.getTime() + 120_000) },
      },
    ]);
    // Never a resubmission and never a state change: the row keeps SUBMITTED and
    // the query phase owns no queue to resubmit through.
    expect(updates[0]?.data).not.toHaveProperty("status");
    expect(audits).toEqual([]);
  });

  it("uses §23.7's ten-minute interval when a PROCESSING answer carries no hint", async () => {
    const { delegate, updates } = makeQueryDelegate([submittedRow]);
    const { query } = makeQuery([queryResult({ outcome: "PROCESSING" })]);
    const { transaction } = makeTransaction(updates);

    await reconcileSubmittedFiscalDocuments({ fiscalDocument: delegate, query, transaction, now });

    expect(updates[0]?.data).toEqual({
      nextQueryAt: new Date(now.getTime() + SIFEN_BATCH_POLL_INTERVAL_MS),
    });
  });

  it("re-drives 0360 to ERROR while PROCESSING beside it only moves the marker", async () => {
    const other: QueryDocumentRow = {
      ...submittedRow,
      id: "00000000-0000-4000-8000-000000000011",
    };
    const { delegate, updates } = makeQueryDelegate([submittedRow, other]);
    const { query } = makeQuery([
      queryResult({
        outcome: "CONFIGURATION_ERROR",
        cdc: null,
        externalId: null,
        reasonCode: "0360",
        reason: "numero de lote inexistente",
      }),
      queryResult({ outcome: "PROCESSING", cdc: null, externalId: null }),
    ]);
    const { transaction, audits } = makeTransaction(updates);

    const result = await reconcileSubmittedFiscalDocuments({
      fiscalDocument: delegate,
      query,
      transaction,
      now,
    });

    expect(result).toEqual({ queried: 2, resolved: 0, processing: 1, unresolved: 1, unapplied: 0 });
    // DEC-055 Q3: 0360 says the lot does not exist, so the document was never
    // accepted. It goes to ERROR for the submission phase's existing re-drive.
    expect(updates[0]).toEqual({
      where: { id: submittedRow.id, tenantId: submittedRow.tenantId, status: "SUBMITTED" },
      data: {
        status: "ERROR",
        lastErrorCode: "0360",
        lastErrorMessage: "numero de lote inexistente",
      },
    });
    expect(audits[0]?.action).toBe("fiscal.document.submission_failed");
    // The guardrail beside it: PROCESSING never resubmits — no ERROR, no status
    // write, no audit — only the marker moves.
    expect(updates[1]).toEqual({
      where: { id: other.id, tenantId: other.tenantId, status: "SUBMITTED" },
      data: { nextQueryAt: new Date(now.getTime() + SIFEN_BATCH_POLL_INTERVAL_MS) },
    });
    expect(updates[1]?.data).not.toHaveProperty("status");
    expect(audits).toHaveLength(1);
  });

  it.each([
    {
      label: "another CONFIGURATION_ERROR",
      answer: queryResult({
        outcome: "CONFIGURATION_ERROR",
        cdc: null,
        externalId: null,
        reasonCode: "0421",
        reason: "certificate not authorized",
      }),
    },
    {
      label: "a TRANSIENT_FAILURE",
      answer: queryResult({
        outcome: "TRANSIENT_FAILURE",
        cdc: null,
        externalId: null,
        reasonCode: "FAKE_TRANSIENT_FAILURE",
        reason: "simulated",
      }),
    },
  ])("leaves the row SUBMITTED when the query answers $label", async ({ answer }) => {
    const { delegate, updates } = makeQueryDelegate([submittedRow]);
    const { query } = makeQuery([answer]);
    const { transaction, audits } = makeTransaction(updates);

    const result = await reconcileSubmittedFiscalDocuments({
      fiscalDocument: delegate,
      query,
      transaction,
      now,
    });

    expect(result).toEqual({ queried: 1, resolved: 0, processing: 0, unresolved: 1, unapplied: 0 });
    expect(updates[0]?.data).toEqual({
      nextQueryAt: new Date(now.getTime() + SIFEN_BATCH_POLL_INTERVAL_MS),
      lastErrorCode: answer.reasonCode,
      lastErrorMessage: answer.reason,
    });
    expect(updates[0]?.data).not.toHaveProperty("status");
    expect(audits).toEqual([]);
  });

  it("leaves the row SUBMITTED and records our own reason when the query call throws", async () => {
    const { delegate, updates } = makeQueryDelegate([submittedRow]);
    const { transaction } = makeTransaction(updates);
    const query = () => Promise.reject(new Error("socket hang up while sending <rDE Id=cdc>"));

    const result = await reconcileSubmittedFiscalDocuments({
      fiscalDocument: delegate,
      query,
      transaction,
      now,
    });

    expect(result).toEqual({ queried: 1, resolved: 0, processing: 0, unresolved: 1, unapplied: 0 });
    expect(updates[0]?.data).toEqual({
      nextQueryAt: new Date(now.getTime() + SIFEN_BATCH_POLL_INTERVAL_MS),
      lastErrorCode: FISCAL_QUERY_CALL_FAILED_REASON_CODE,
      lastErrorMessage: FISCAL_QUERY_CALL_FAILED_REASON,
    });
    // The thrown message could quote response bytes; it never reaches the row.
    expect(JSON.stringify(updates[0]?.data)).not.toContain("rDE");
  });

  it.each([
    { label: "APPROVED", answer: queryResult({ outcome: "APPROVED" }) },
    { label: "REJECTED", answer: queryResult({ outcome: "REJECTED" }) },
    { label: "FUNCTIONAL_REJECTION", answer: queryResult({ outcome: "FUNCTIONAL_REJECTION" }) },
    { label: "PROCESSING", answer: queryResult({ outcome: "PROCESSING" }) },
    {
      label: "0360",
      answer: queryResult({ outcome: "CONFIGURATION_ERROR", reasonCode: "0360" }),
    },
    {
      label: "another CONFIGURATION_ERROR",
      answer: queryResult({ outcome: "CONFIGURATION_ERROR", reasonCode: "0421" }),
    },
    { label: "TRANSIENT_FAILURE", answer: queryResult({ outcome: "TRANSIENT_FAILURE" }) },
  ])("never writes attempt_count for $label", async ({ answer }) => {
    const { delegate, updates } = makeQueryDelegate([submittedRow]);
    const { query } = makeQuery([answer]);
    const { transaction } = makeTransaction(updates);

    await reconcileSubmittedFiscalDocuments({ fiscalDocument: delegate, query, transaction, now });

    expect(updates.length).toBeGreaterThan(0);
    for (const update of updates) {
      expect(update.data).not.toHaveProperty("attemptCount");
      expect(update.data).not.toHaveProperty("attempt_count");
    }
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
