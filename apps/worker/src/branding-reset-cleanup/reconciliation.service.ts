import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Queue } from "bullmq";
import { Redis } from "ioredis";
import { PrismaService } from "@newsaas/database";
import {
  BRANDING_RESET_CLEANUP_JOB,
  BRANDING_RESET_CLEANUP_QUEUE,
  brandingResetCleanupJobOptions,
} from "@newsaas/shared";
import { RECONCILIATION_BATCH_LIMIT, resolveReconciliationTiming } from "./cleanup.constants.js";

/** Narrow intent delegate used only for the stale-PENDING sweep query. */
export interface ReconcileIntentDelegate {
  findMany(args: {
    where: { status: "PENDING"; createdAt: { lt: Date } };
    select: { id: true };
    orderBy: { createdAt: "asc" };
    take: number;
  }): Promise<{ id: string }[]>;
}

export interface ReconcilePrisma {
  brandingResetCleanupIntent: ReconcileIntentDelegate;
}

export interface ReconcileDeps {
  prisma: ReconcilePrisma;
  enqueue: (intentId: string) => Promise<void>;
  now: Date;
  staleMs: number;
  batchLimit?: number;
}

export interface ReconcileResult {
  scanned: number;
  enqueued: number;
  failed: number;
}

/**
 * Re-enqueues committed PENDING intents older than the stale threshold whose
 * job was lost (or whose enqueue failed post-commit). Deterministic: the
 * caller supplies `now`, so the sweep is unit-testable without Redis.
 *
 * A single enqueue failure is counted, not fatal — one poison intent must not
 * block recovery of the rest of the backlog.
 */
export async function reconcileStaleCleanupIntents(deps: ReconcileDeps): Promise<ReconcileResult> {
  const threshold = new Date(deps.now.getTime() - deps.staleMs);
  const stale = await deps.prisma.brandingResetCleanupIntent.findMany({
    where: { status: "PENDING", createdAt: { lt: threshold } },
    select: { id: true },
    orderBy: { createdAt: "asc" },
    take: deps.batchLimit ?? RECONCILIATION_BATCH_LIMIT,
  });

  let enqueued = 0;
  let failed = 0;
  for (const intent of stale) {
    try {
      await deps.enqueue(intent.id);
      enqueued += 1;
    } catch {
      failed += 1;
    }
  }

  return { scanned: stale.length, enqueued, failed };
}

/**
 * Interval-driven reconciliation for lost reset-cleanup enqueues.
 *
 * Runs inside the worker deployable; `jobId = intentId` makes re-enqueue
 * idempotent against jobs that are still waiting/active. Deliberately a plain
 * interval — no new scheduler technology (design decision #8).
 */
@Injectable()
export class BrandingResetCleanupReconciliationService implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout | null = null;
  private queue: Queue | null = null;
  private connection: Redis | null = null;
  private sweeping = false;
  private readonly timing = resolveReconciliationTiming();

  constructor(@Inject(PrismaService) private readonly prisma: ReconcilePrisma) {}

  onModuleInit(): void {
    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl) {
      throw new Error("REDIS_URL is not set");
    }

    this.connection = new Redis(redisUrl, { maxRetriesPerRequest: null });
    this.queue = new Queue(BRANDING_RESET_CLEANUP_QUEUE, { connection: this.connection });
    this.timer = setInterval(() => {
      void this.sweepOnce();
    }, this.timing.intervalMs);
    this.timer.unref();
  }

  /** Runs one sweep; overlapping ticks are skipped. */
  async sweepOnce(now: Date = new Date()): Promise<ReconcileResult> {
    const queue = this.queue;
    if (this.sweeping || queue === null) {
      return { scanned: 0, enqueued: 0, failed: 0 };
    }

    this.sweeping = true;
    try {
      const result = await reconcileStaleCleanupIntents({
        prisma: this.prisma,
        enqueue: async (intentId) => {
          await queue.add(
            BRANDING_RESET_CLEANUP_JOB,
            { intentId },
            brandingResetCleanupJobOptions(intentId)
          );
        },
        now,
        staleMs: this.timing.staleMs,
      });

      if (result.failed > 0) {
        console.error("Branding reset cleanup reconciliation had enqueue failures", {
          scanned: result.scanned,
          enqueued: result.enqueued,
          failed: result.failed,
        });
      }
      return result;
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
    if (queue) {
      await queue.close();
    }

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
