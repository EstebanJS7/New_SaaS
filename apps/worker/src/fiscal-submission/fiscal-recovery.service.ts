import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Queue } from "bullmq";
import { Redis } from "ioredis";
import { appendAuditLog, PrismaService, type AuditAppendTx } from "@newsaas/database";
import {
  FISCAL_SUBMISSION_JOB,
  FISCAL_SUBMISSION_QUEUE,
  fiscalSubmissionJobId,
  fiscalSubmissionJobOptions,
  type FiscalSubmissionJob,
} from "@newsaas/fiscal";
import {
  FISCAL_RECOVERY_BATCH_LIMIT,
  resolveFiscalRecoveryTiming,
} from "./fiscal-recovery.constants.js";

export interface RecoverDocumentRow {
  readonly id: string;
  readonly tenantId: string;
  readonly status: "QUEUED" | "ERROR";
  readonly attemptCount: number;
}

export interface RecoverDocumentDelegate {
  findMany(args: {
    where: {
      status: { in: readonly string[] };
      OR: readonly [
        { lastAttemptAt: { lt: Date } },
        { lastAttemptAt: null; createdAt: { lt: Date } },
      ];
    };
    select: { id: true; tenantId: true; status: true; attemptCount: true };
    orderBy: { createdAt: "asc" };
    take: number;
  }): Promise<RecoverDocumentRow[]>;
}

export interface FiscalRecoveryDeps {
  readonly fiscalDocument: RecoverDocumentDelegate;
  readonly redrive: (document: RecoverDocumentRow) => Promise<void>;
  readonly now: Date;
  readonly staleMs: number;
  readonly batchLimit?: number;
}

export interface FiscalRecoveryResult {
  readonly scanned: number;
  readonly requeued: number;
  readonly failed: number;
}

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

export async function recoverStaleFiscalSubmissions(
  deps: FiscalRecoveryDeps
): Promise<FiscalRecoveryResult> {
  const threshold = new Date(deps.now.getTime() - deps.staleMs);
  const stale = await deps.fiscalDocument.findMany({
    where: {
      status: { in: ["QUEUED", "ERROR"] },
      OR: [
        { lastAttemptAt: { lt: threshold } },
        { lastAttemptAt: null, createdAt: { lt: threshold } },
      ],
    },
    select: { id: true, tenantId: true, status: true, attemptCount: true },
    orderBy: { createdAt: "asc" },
    take: deps.batchLimit ?? FISCAL_RECOVERY_BATCH_LIMIT,
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
  return { scanned: stale.length, requeued, failed };
}

export interface FiscalRecoveryPrisma extends AuditAppendTx {
  readonly fiscalDocument: RecoverDocumentDelegate;
  $transaction<R>(work: (tx: AuditAppendTx) => Promise<R>): Promise<R>;
}

@Injectable()
export class FiscalSubmissionRecoveryService implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout | null = null;
  private queue: Queue | null = null;
  private connection: Redis | null = null;
  private sweeping = false;
  private readonly timing = resolveFiscalRecoveryTiming();

  constructor(@Inject(PrismaService) private readonly prisma: FiscalRecoveryPrisma) {}

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
    if (this.sweeping || queue === null) return { scanned: 0, requeued: 0, failed: 0 };
    this.sweeping = true;
    try {
      return await recoverStaleFiscalSubmissions({
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
