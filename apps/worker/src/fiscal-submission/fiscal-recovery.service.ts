import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Queue } from "bullmq";
import { Redis } from "ioredis";
import { appendAuditLog, PrismaService, type AuditAppendTx } from "@newsaas/database";
import {
  describeBatchQuery,
  FISCAL_PROVIDER,
  FISCAL_SUBMISSION_JOB,
  FISCAL_SUBMISSION_QUEUE,
  SIFEN_BATCH_POLL_INTERVAL_MS,
  fiscalSubmissionJobId,
  fiscalSubmissionJobOptions,
  type FiscalProviderId,
  type FiscalProviderPort,
  type FiscalQueryRequest,
  type FiscalQueryResult,
  type FiscalSubmissionJob,
} from "@newsaas/fiscal";
import {
  DEFAULT_FISCAL_RECOVERY_MAX_ATTEMPTS,
  FISCAL_RECOVERY_BATCH_LIMIT,
  resolveFiscalRecoveryTiming,
} from "./fiscal-recovery.constants.js";

export interface RecoverDocumentRow {
  readonly id: string;
  readonly tenantId: string;
  readonly status: "QUEUED" | "ERROR";
  readonly attemptCount: number;
}

export interface RecoverFindManyArgs {
  where: {
    status: { in: readonly string[] };
    OR: readonly [
      { lastAttemptAt: { lt: Date } },
      { lastAttemptAt: null; createdAt: { lt: Date } },
    ];
    /** Excludes `ERROR` rows at or over the attempt cap; `QUEUED` is unaffected. */
    NOT: { status: string; attemptCount: { gte: number } };
  };
  select: { id: true; tenantId: true; status: true; attemptCount: true };
  orderBy: { createdAt: "asc" };
  take: number;
}

export interface RecoverCountArgs {
  where: { status: string; attemptCount: { gte: number } };
}

export interface RecoverDocumentDelegate {
  findMany(args: RecoverFindManyArgs): Promise<RecoverDocumentRow[]>;
  count(args: RecoverCountArgs): Promise<number>;
}

export interface FiscalRecoveryDeps {
  readonly fiscalDocument: RecoverDocumentDelegate;
  readonly redrive: (document: RecoverDocumentRow) => Promise<void>;
  readonly now: Date;
  readonly staleMs: number;
  readonly batchLimit?: number;
  readonly maxAttempts?: number;
}

/** The submission phase's slice of the sweep's result. */
export interface FiscalSubmissionSweepResult {
  readonly scanned: number;
  readonly requeued: number;
  readonly failed: number;
  /** `ERROR` rows at or over the attempt cap, held back for an operator. */
  readonly capped: number;
}

/** The query phase's slice of the sweep's result. */
export interface FiscalQuerySweepResult {
  readonly queried: number;
  readonly resolved: number;
  readonly processing: number;
  readonly unresolved: number;
  /** Rows whose answer could not be applied: one row's failure is isolated. */
  readonly unapplied: number;
}

/** What one sweep reports, both phases together. */
export interface FiscalRecoveryResult extends FiscalSubmissionSweepResult, FiscalQuerySweepResult {}

/** The slice of a BullMQ job the re-drive needs. */
export interface RedriveJob {
  getState(): Promise<string>;
  remove(): Promise<void>;
}

/**
 * The slice of a BullMQ `Queue` the re-drive needs.
 *
 * Declared structurally so the removal-versus-dedupe logic is a plain exported
 * function over a fake queue, which is what makes it testable without Redis. The
 * branding template left its equivalent logic inside the Nest class and therefore
 * uncovered; this slice does not repeat that.
 */
export interface RedriveQueue {
  getJob(jobId: string): Promise<RedriveJob | undefined>;
  add(
    name: string,
    payload: FiscalSubmissionJob,
    options: ReturnType<typeof fiscalSubmissionJobOptions>
  ): Promise<unknown>;
}

export type RedriveOutcome = "requeued" | "skipped";

/**
 * Re-drives one stale document, or reports that a live delivery already exists.
 *
 * `jobId` is deterministic and `removeOnFail: false` keeps a failed job alive, so
 * a plain `add` would be a **silent BullMQ dedupe no-op** and the sweep would do
 * nothing at all. A job in a terminal state must therefore be removed first.
 *
 * A job in `waiting`, `active` or `delayed` is a live delivery and is left alone:
 * re-adding over it would race the worker that already owns it, and the handler's
 * claim compare-and-swap is the backstop, not the first line of defence.
 *
 * Removing a terminal job does not lose operator evidence — the failure of record
 * is the database row (`lastErrorCode`, `lastErrorMessage`, `attemptCount`) plus
 * the SYSTEM audit rows the handler writes per attempt.
 */
export async function redriveFiscalSubmission(
  queue: RedriveQueue,
  document: RecoverDocumentRow
): Promise<RedriveOutcome> {
  const jobId = fiscalSubmissionJobId(document.id);
  const existing = await queue.getJob(jobId);
  if (existing !== undefined) {
    const state = await existing.getState();
    if (state !== "failed" && state !== "completed") {
      return "skipped";
    }
    await existing.remove();
  }

  await queue.add(
    FISCAL_SUBMISSION_JOB,
    { fiscalDocumentId: document.id, tenantId: document.tenantId },
    fiscalSubmissionJobOptions(document.id)
  );
  return "requeued";
}

/**
 * The submission phase: re-drives stale `QUEUED`/`ERROR` documents.
 *
 * The staleness rule, the batch limit and the re-drive callback are the TD-028
 * sweep's, unchanged. The one addition is the attempt cap: an `ERROR` row whose
 * `attempt_count` has reached `maxAttempts` is **not selected**, so a failure the
 * data makes permanent stops being resubmitted and stays in `ERROR` with its code
 * and its count for an operator to read. The cap is a count and not a list of
 * reason codes for the reason `DEFAULT_FISCAL_RECOVERY_MAX_ATTEMPTS` states: the
 * result-code catalogue is open, and a list would rot.
 *
 * `capped` reports the rows the cap is holding back. It is a count query rather
 * than a field of the selection, because the selection excludes those rows on
 * purpose — without the count the state would be invisible from the sweep's own
 * result, and a permanently failing document would look like an empty backlog.
 */
export async function recoverStaleFiscalSubmissions(
  deps: FiscalRecoveryDeps
): Promise<FiscalSubmissionSweepResult> {
  const threshold = new Date(deps.now.getTime() - deps.staleMs);
  const maxAttempts = deps.maxAttempts ?? DEFAULT_FISCAL_RECOVERY_MAX_ATTEMPTS;
  const stale = await deps.fiscalDocument.findMany({
    where: {
      status: { in: ["QUEUED", "ERROR"] },
      OR: [
        { lastAttemptAt: { lt: threshold } },
        { lastAttemptAt: null, createdAt: { lt: threshold } },
      ],
      NOT: { status: "ERROR", attemptCount: { gte: maxAttempts } },
    },
    select: { id: true, tenantId: true, status: true, attemptCount: true },
    orderBy: { createdAt: "asc" },
    take: deps.batchLimit ?? FISCAL_RECOVERY_BATCH_LIMIT,
  });
  const capped = await deps.fiscalDocument.count({
    where: { status: "ERROR", attemptCount: { gte: maxAttempts } },
  });

  let requeued = 0;
  let failed = 0;
  for (const document of stale) {
    try {
      await deps.redrive(document);
      requeued += 1;
    } catch {
      failed += 1;
    }
  }
  return { scanned: stale.length, requeued, failed, capped };
}

/**
 * One `SUBMITTED` row, as the query phase selects it.
 *
 * The three identifiers are exactly what `FiscalQueryRequest` carries: the
 * document's own identity (`cdc`, `externalId`) and the operation's handle
 * (`providerReference`). Either identifier may be missing — a hand-over answer
 * that never arrived leaves no reference, and ADR-007 §2 makes the CDC the
 * fallback the query survives with — so all three travel and the provider
 * decides which to ask with.
 */
export interface QueryDocumentRow {
  readonly id: string;
  readonly tenantId: string;
  readonly provider: FiscalProviderId;
  readonly cdc: string | null;
  readonly externalId: string | null;
  readonly providerReference: string | null;
}

export interface QueryFindManyArgs {
  where: {
    status: "SUBMITTED";
    /** `null` is "never queried" and is eligible, like a due marker. */
    OR: readonly [{ nextQueryAt: { lte: Date } }, { nextQueryAt: null }];
  };
  select: {
    id: true;
    tenantId: true;
    provider: true;
    cdc: true;
    externalId: true;
    providerReference: true;
  };
  orderBy: { nextQueryAt: "asc" };
  take: number;
}

export interface QueryUpdateManyArgs {
  where: { id: string; tenantId: string; status: "SUBMITTED" };
  data: Record<string, unknown>;
}

export interface QueryDocumentDelegate {
  findMany(args: QueryFindManyArgs): Promise<QueryDocumentRow[]>;
  updateMany(args: QueryUpdateManyArgs): Promise<{ count: number }>;
}

/**
 * The transaction client the query phase writes through.
 *
 * A terminal resolution must apply the status, its identity and its audit row
 * atomically — mirroring the handler's `persistResult` shape — so the update and
 * the append run on the same client.
 */
export interface FiscalRecoveryTransaction extends AuditAppendTx {
  readonly fiscalDocument: {
    updateMany(args: QueryUpdateManyArgs): Promise<{ count: number }>;
  };
}

export interface FiscalQueryDeps {
  readonly fiscalDocument: QueryDocumentDelegate;
  readonly query: (request: FiscalQueryRequest) => Promise<FiscalQueryResult>;
  readonly transaction: <R>(work: (tx: FiscalRecoveryTransaction) => Promise<R>) => Promise<R>;
  readonly now: Date;
  readonly batchLimit?: number;
}

/**
 * `reasonCode` when the provider's query call threw instead of answering.
 *
 * **Ours, not the provider's.** A thrown error's own message can quote response
 * bytes, and `last_error_message` must never carry them; the code and the fixed
 * sentence below say what happened without repeating anything the provider sent.
 */
export const FISCAL_QUERY_CALL_FAILED_REASON_CODE = "QUERY_CALL_FAILED" as const;

/** `reason` for the same case: the document stays `SUBMITTED` (ADR-007 §5). */
export const FISCAL_QUERY_CALL_FAILED_REASON =
  "The provider query call failed; the document remains SUBMITTED and the reconciliation will " +
  "ask again.";

/** An answer the sweep could not apply: the provider answered, applying it failed. */
export const FISCAL_QUERY_APPLICATION_FAILED_REASON_CODE = "QUERY_APPLICATION_FAILED" as const;

/** Fixed, so no thrown message reaches a row. */
export const FISCAL_QUERY_APPLICATION_FAILED_REASON =
  "The provider's answer could not be applied; the document remains SUBMITTED and the " +
  "reconciliation will ask again.";

/** The same bound the handler applies to a persisted reason; bytes never enter a row. */
const MAX_ERROR_LENGTH = 500;

function truncateReason(value: string | null): string | null {
  return value === null ? null : value.replace(/[\r\n\t]+/g, " ").slice(0, MAX_ERROR_LENGTH);
}

/**
 * The query phase: reconciles documents the provider has not resolved yet.
 *
 * It walks `SUBMITTED` rows whose marker is due — or unset, which means "never
 * queried" — bounded by the same batch limit as the submission phase, and asks
 * the port's `query` once per row with the row's own identifiers. What it does
 * with the answer is the whole point of the phase:
 *
 * ```text
 * APPROVED / REJECTED      one conditional update from SUBMITTED: the status,
 *   (and FUNCTIONAL_       the identity the answer carries, `resolved_at` and
 *    REJECTION)            a SYSTEM audit row, in one transaction
 * PROCESSING               stays SUBMITTED; only the marker moves, by the
 *                          provider's `retryAfterMs` or §23.7's ten minutes.
 *                          It NEVER resubmits: the query phase owns no queue,
 *                          and the Guide's blocking rules punish duplicate
 *                          sends of a document still processing (DEC-055 Q3)
 * 0360 (the mapper's       the lot does not exist, so the document was never
 *  unknownLot)             accepted: back to ERROR with the reason, where the
 *                          submission phase's existing re-drive picks it up.
 *                          The attempt cap is what stops that re-drive if the
 *                          provider keeps answering 0360.
 * anything else            stays SUBMITTED with the reason recorded and the
 *                          marker moved forward. A failed query is not a failed
 *                          document (ADR-007 §5).
 * ```
 *
 * `attempt_count` counts submissions and never queries: no path here writes it,
 * and a test asserts that over every outcome.
 */
export async function reconcileSubmittedFiscalDocuments(
  deps: FiscalQueryDeps
): Promise<FiscalQuerySweepResult> {
  const pending = await deps.fiscalDocument.findMany({
    where: {
      status: "SUBMITTED",
      OR: [{ nextQueryAt: { lte: deps.now } }, { nextQueryAt: null }],
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
    take: deps.batchLimit ?? FISCAL_RECOVERY_BATCH_LIMIT,
  });

  let resolved = 0;
  let processing = 0;
  let unresolved = 0;
  let unapplied = 0;

  for (const document of pending) {
    let result: FiscalQueryResult;
    try {
      result = await deps.query({
        fiscalDocumentId: document.id,
        tenantId: document.tenantId,
        provider: document.provider,
        cdc: document.cdc,
        externalId: document.externalId,
        providerReference: document.providerReference,
      });
    } catch {
      await deps.fiscalDocument.updateMany({
        where: submittedWhere(document),
        data: {
          nextQueryAt: nextQueryInstant(deps.now, null),
          lastErrorCode: FISCAL_QUERY_CALL_FAILED_REASON_CODE,
          lastErrorMessage: FISCAL_QUERY_CALL_FAILED_REASON,
        },
      });
      unresolved += 1;
      continue;
    }

    // One guard for the whole application. A rejection escaping this loop would
    // abort the sweep with the row's marker unadvanced, so that row would be
    // re-selected on every sweep and block every other due document behind it —
    // and an unusable instant reaches the database as a rejected write, which is
    // how the date case is caught here rather than by a check of its own
    // (FISC-012 WU-F, finding R4-001).
    try {
      switch (result.outcome) {
        case "APPROVED":
        case "REJECTED":
        case "FUNCTIONAL_REJECTION": {
          const applied = await applyTerminalResolution(deps, document, result);
          if (applied === "applied") resolved += 1;
          else if (applied === "unapplied") unapplied += 1;
          else unresolved += 1;
          break;
        }
        case "PROCESSING": {
          const applied = await moveQueryMarker(deps, document, result);
          if (applied) processing += 1;
          else unresolved += 1;
          break;
        }
        case "CONFIGURATION_ERROR": {
          if (isUnknownLot(result.reasonCode)) {
            await returnUnknownLotToError(deps, document, result);
          } else {
            await recordUnresolvedAnswer(deps, document, result);
          }
          unresolved += 1;
          break;
        }
        case "TRANSIENT_FAILURE": {
          await recordUnresolvedAnswer(deps, document, result);
          unresolved += 1;
          break;
        }
      }
    } catch {
      // The marker moves forward so the row cannot block the batch, and the write
      // that records it is itself guarded: a database refusing writes is
      // transient, and the row must stay due for the next sweep.
      await recordQueryApplicationFailure(deps, document);
      unapplied += 1;
    }
  }

  return { queried: pending.length, resolved, processing, unresolved, unapplied };
}

/** The conditional predicate every query-phase write carries: still SUBMITTED. */
function submittedWhere(document: QueryDocumentRow): QueryUpdateManyArgs["where"] {
  return { id: document.id, tenantId: document.tenantId, status: "SUBMITTED" };
}

/**
 * The next instant a query is allowed.
 *
 * The provider's `retryAfterMs` bounds the next attempt; when it carries none,
 * §23.7's ten minutes do — the same interval the marker's first write uses and
 * the same one the mapper attaches to a `0361`.
 */
function nextQueryInstant(now: Date, retryAfterMs: number | null): Date {
  return new Date(now.getTime() + (retryAfterMs ?? SIFEN_BATCH_POLL_INTERVAL_MS));
}

/**
 * Whether a `CONFIGURATION_ERROR` is §23.7's `0360` ("número de lote
 * inexistente").
 *
 * The question goes through the mapper's own code table rather than a literal:
 * `describeBatchQuery` is where §23.7's codes live, so the worker names the
 * semantics ("the operation is unknown") instead of repeating a protocol string,
 * and a code the table does not know is not a re-drive. DEC-055 Q3 keeps the
 * mapping and the re-drive: `0360` says the lot does not exist, so the document
 * was never accepted and re-sending it is what the Guide asks for.
 */
function isUnknownLot(reasonCode: string | null): boolean {
  return reasonCode !== null && describeBatchQuery(reasonCode).outcome === "unknownLot";
}

/**
 * Records that one row's answer could not be applied, and never throws: the marker
 * moves forward so a row whose answer can never be applied stops blocking the
 * batch, and a refused write leaves it due for the next sweep.
 */
async function recordQueryApplicationFailure(
  deps: FiscalQueryDeps,
  document: QueryDocumentRow
): Promise<void> {
  try {
    await deps.fiscalDocument.updateMany({
      where: submittedWhere(document),
      data: {
        nextQueryAt: nextQueryInstant(deps.now, null),
        lastErrorCode: FISCAL_QUERY_APPLICATION_FAILED_REASON_CODE,
        lastErrorMessage: FISCAL_QUERY_APPLICATION_FAILED_REASON,
      },
    });
  } catch {
    // Deliberately swallowed: the row stays due and the next sweep retries it.
  }
}

/** What applying one terminal answer produced. */
type TerminalApplication = "applied" | "unresolved" | "unapplied";

/**
 * Applies a terminal resolution in one conditional update from `SUBMITTED`.
 *
 * The shape mirrors the handler's `persistResult`: the same transaction holds the
 * status write and the SYSTEM audit row. Identity is written only when the answer
 * carries it — a `null` write would be a clearing attempt the transition guard
 * refuses, and an aborted transaction here would strand the row — and
 * `resolved_at` is the provider's own instant, as the guard requires on entry to
 * `APPROVED`/`REJECTED`.
 *
 * Returns whether the row was still `SUBMITTED` when the update ran. A `false`
 * means another writer resolved or cancelled it first, and then no audit row is
 * written for a transition this sweep did not perform.
 */
async function applyTerminalResolution(
  deps: FiscalQueryDeps,
  document: QueryDocumentRow,
  result: FiscalQueryResult
): Promise<TerminalApplication> {
  const status = result.outcome === "APPROVED" ? "APPROVED" : "REJECTED";
  const reasonCode = truncateReason(result.reasonCode);
  const reason = truncateReason(result.reason);

  return deps.transaction(async (tx) => {
    const updated = await tx.fiscalDocument.updateMany({
      where: submittedWhere(document),
      data: {
        status,
        resolvedAt: new Date(result.resolvedAt),
        ...(result.cdc === null ? {} : { cdc: result.cdc }),
        ...(result.externalId === null ? {} : { externalId: result.externalId }),
        ...(status === "APPROVED"
          ? { lastErrorCode: null, lastErrorMessage: null }
          : { lastErrorCode: reasonCode, lastErrorMessage: reason }),
      },
    });
    if (updated.count !== 1) return "unresolved";
    await appendAuditLog(tx, {
      actorType: "SYSTEM",
      action: "fiscal.document.submitted",
      tenantId: document.tenantId,
      targetType: "fiscal_document",
      targetId: document.id,
      metadata: { outcome: result.outcome, reasonCode },
    });
    return "applied";
  });
}

/** `PROCESSING`: the row stays `SUBMITTED`; only the marker moves. */
async function moveQueryMarker(
  deps: FiscalQueryDeps,
  document: QueryDocumentRow,
  result: FiscalQueryResult
): Promise<boolean> {
  const updated = await deps.fiscalDocument.updateMany({
    where: submittedWhere(document),
    data: { nextQueryAt: nextQueryInstant(deps.now, result.retryAfterMs) },
  });
  return updated.count === 1;
}

/**
 * Any non-resolution that is not `0360`: the row stays `SUBMITTED`, the reason is
 * recorded and the marker moves forward. There is no audit row because no state
 * transition happened; the row itself is the record.
 */
async function recordUnresolvedAnswer(
  deps: FiscalQueryDeps,
  document: QueryDocumentRow,
  result: FiscalQueryResult
): Promise<void> {
  await deps.fiscalDocument.updateMany({
    where: submittedWhere(document),
    data: {
      nextQueryAt: nextQueryInstant(deps.now, result.retryAfterMs),
      lastErrorCode: truncateReason(result.reasonCode),
      lastErrorMessage: truncateReason(result.reason),
    },
  });
}

/**
 * `0360`: the lot does not exist, so the document was never accepted.
 *
 * It moves to `ERROR` with the reason and the submission phase's existing
 * `ERROR` re-drive requeues it — the Guide's answer for a CDC SIFEN does not
 * have. The attempt cap is what bounds that loop if the provider keeps answering
 * `0360`: each cycle spends a submission attempt, and the phase-one selection
 * stops selecting the row once the cap is reached.
 */
async function returnUnknownLotToError(
  deps: FiscalQueryDeps,
  document: QueryDocumentRow,
  result: FiscalQueryResult
): Promise<void> {
  const reasonCode = truncateReason(result.reasonCode);
  const reason = truncateReason(result.reason);
  await deps.transaction(async (tx) => {
    const updated = await tx.fiscalDocument.updateMany({
      where: submittedWhere(document),
      data: { status: "ERROR", lastErrorCode: reasonCode, lastErrorMessage: reason },
    });
    if (updated.count !== 1) return;
    await appendAuditLog(tx, {
      actorType: "SYSTEM",
      action: "fiscal.document.submission_failed",
      tenantId: document.tenantId,
      targetType: "fiscal_document",
      targetId: document.id,
      metadata: { outcome: result.outcome, reasonCode },
    });
  });
}

export interface FiscalRecoveryPrisma extends AuditAppendTx {
  readonly fiscalDocument: RecoverDocumentDelegate & QueryDocumentDelegate;
  $transaction<R>(work: (tx: FiscalRecoveryTransaction) => Promise<R>): Promise<R>;
}

@Injectable()
export class FiscalSubmissionRecoveryService implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout | null = null;
  private queue: Queue | null = null;
  private connection: Redis | null = null;
  private sweeping = false;
  private readonly timing = resolveFiscalRecoveryTiming();

  constructor(
    @Inject(PrismaService) private readonly prisma: FiscalRecoveryPrisma,
    @Inject(FISCAL_PROVIDER) private readonly provider: FiscalProviderPort
  ) {}

  onModuleInit(): void {
    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl) throw new Error("REDIS_URL is not set");
    this.connection = new Redis(redisUrl, { maxRetriesPerRequest: null });
    this.queue = new Queue(FISCAL_SUBMISSION_QUEUE, { connection: this.connection });
    this.timer = setInterval(() => void this.sweepOnce(), this.timing.intervalMs);
    this.timer.unref();
  }

  async sweepOnce(now: Date = new Date()): Promise<FiscalRecoveryResult> {
    const queue = this.queue;
    if (this.sweeping || queue === null) {
      return {
        scanned: 0,
        requeued: 0,
        failed: 0,
        capped: 0,
        queried: 0,
        resolved: 0,
        processing: 0,
        unresolved: 0,
        unapplied: 0,
      };
    }
    this.sweeping = true;
    try {
      const submissions = await recoverStaleFiscalSubmissions({
        fiscalDocument: this.prisma.fiscalDocument,
        now,
        staleMs: this.timing.staleMs,
        redrive: async (document) => {
          const outcome = await redriveFiscalSubmission(queue, document);
          if (outcome === "skipped") return;
          await this.prisma.$transaction((tx) =>
            appendAuditLog(tx, {
              actorType: "SYSTEM",
              action: "fiscal.document.submission_requeued",
              tenantId: document.tenantId,
              targetType: "fiscal_document",
              targetId: document.id,
              metadata: { previousStatus: document.status, attemptCount: document.attemptCount },
            })
          );
        },
      });
      // The query phase runs after the submission phase, so a document the
      // submission phase just moved to `SUBMITTED` is not queried in the same
      // sweep; its marker is `submitted_at + SIFEN_BATCH_POLL_INTERVAL_MS`, so
      // §23.7's cadence holds even across that boundary.
      const queries = await reconcileSubmittedFiscalDocuments({
        fiscalDocument: this.prisma.fiscalDocument,
        query: (request) => this.provider.query(request),
        transaction: (work) => this.prisma.$transaction(work),
        now,
      });
      return { ...submissions, ...queries };
    } finally {
      this.sweeping = false;
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    const queue = this.queue;
    this.queue = null;
    if (queue) await queue.close();
    const connection = this.connection;
    this.connection = null;
    if (connection) {
      try {
        await connection.quit();
      } catch {
        connection.disconnect();
      }
    }
  }
}
