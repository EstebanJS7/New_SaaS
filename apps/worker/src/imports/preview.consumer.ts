import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Worker, type Job } from "bullmq";
import { Redis } from "ioredis";
import type { ImportPreviewJob } from "@newsaas/imports";
import { IMPORT_PROCESSING_QUEUE } from "@newsaas/imports";
import { ImportPreviewHandler } from "./preview.handler.js";

/** Exported so the consumer's contract is testable without a Redis. */
export function createImportPreviewProcessor(
  handler: ImportPreviewHandler
): (job: Job<ImportPreviewJob>) => Promise<void> {
  return async (job) => handler.handle(job.data);
}

function sanitizeWorkerError(error: unknown): string {
  const message = error instanceof Error ? error.message : "Import preview worker failed";
  return message.replace(/[\r\n\t]+/g, " ").slice(0, 300);
}

/**
 * The BullMQ consumer for the import preview queue (EPIC-19 [[IMP-002]]), the
 * notification delivery consumer's shape: one queue name, one job name, one
 * processor.
 *
 * `maxRetriesPerRequest: null` is correct HERE and would be wrong in a producer: a
 * worker's blocking command must not be killed by a retry limit, while the API's
 * enqueue must fail fast instead of holding a request open.
 *
 * `concurrency: 1` for the same reason the notification queue runs one: a preview
 * reads a whole file and writes one outcome per row, and one worker doing that at a
 * time keeps a saturated import from starving the worker's other queues of the
 * process's memory.
 */
@Injectable()
export class ImportPreviewConsumer implements OnModuleInit, OnModuleDestroy {
  private worker: Worker<ImportPreviewJob> | null = null;
  private connection: Redis | null = null;

  constructor(private readonly handler: ImportPreviewHandler) {}

  onModuleInit(): void {
    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl) throw new Error("REDIS_URL is not set");

    this.connection = new Redis(redisUrl, { maxRetriesPerRequest: null });
    this.worker = new Worker<ImportPreviewJob>(
      IMPORT_PROCESSING_QUEUE,
      createImportPreviewProcessor(this.handler),
      { connection: this.connection, concurrency: 1 }
    );
    this.worker.on("failed", (job, error) => {
      // The import id and a sanitized reason: no storage key, no row content.
      console.error("Import preview job failed", {
        importJobId: job?.data.importJobId ?? null,
        error: sanitizeWorkerError(error),
      });
    });
    this.worker.on("error", (error) => {
      console.error("Import preview worker error", sanitizeWorkerError(error));
    });
  }

  async onModuleDestroy(): Promise<void> {
    const worker = this.worker;
    this.worker = null;
    if (worker) await worker.close();

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
