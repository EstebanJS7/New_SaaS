import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Worker, type Job } from "bullmq";
import { Redis } from "ioredis";
import { BRANDING_RESET_CLEANUP_QUEUE, type BrandingResetCleanupJob } from "@newsaas/shared";
import { BrandingResetCleanupHandler, sanitizeCleanupError } from "./cleanup.handler.js";

/**
 * Extracts the durable intent id from a queue job and delegates to the handler.
 *
 * Kept separate from the Nest service so the job-processing contract is
 * unit-testable without a Redis connection.
 */
export function createCleanupProcessor(
  handler: BrandingResetCleanupHandler
): (job: Job<BrandingResetCleanupJob>) => Promise<void> {
  return async (job) => {
    await handler.handle(job.data.intentId);
  };
}

/**
 * BullMQ consumer for the branding-reset cleanup queue.
 *
 * Runs in the existing worker deployable (design decision #3). Concurrency 1
 * serializes cleanups per worker; bounded attempts/backoff live on the job
 * options set by the producer. A failed job is logged with a sanitized error
 * and left to BullMQ's retry policy; the handler owns terminal intent state.
 */
@Injectable()
export class BrandingResetCleanupConsumer implements OnModuleInit, OnModuleDestroy {
  private worker: Worker<BrandingResetCleanupJob> | null = null;
  private connection: Redis | null = null;

  constructor(private readonly handler: BrandingResetCleanupHandler) {}

  onModuleInit(): void {
    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl) {
      throw new Error("REDIS_URL is not set");
    }

    this.connection = new Redis(redisUrl, { maxRetriesPerRequest: null });
    this.worker = new Worker<BrandingResetCleanupJob>(
      BRANDING_RESET_CLEANUP_QUEUE,
      createCleanupProcessor(this.handler),
      { connection: this.connection, concurrency: 1 }
    );

    this.worker.on("failed", (job, error) => {
      console.error("Branding reset cleanup job failed", {
        intentId: job?.data.intentId ?? null,
        error: sanitizeCleanupError(error),
      });
    });
    this.worker.on("error", (error) => {
      console.error("Branding reset cleanup worker error", sanitizeCleanupError(error));
    });
  }

  async onModuleDestroy(): Promise<void> {
    const worker = this.worker;
    this.worker = null;
    if (worker) {
      await worker.close();
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
