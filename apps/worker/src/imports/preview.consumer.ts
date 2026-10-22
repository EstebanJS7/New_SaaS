import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Worker, type Job } from "bullmq";
import { Redis } from "ioredis";
import {
  IMPORT_COMMIT_JOB,
  IMPORT_PREVIEW_JOB,
  IMPORT_PROCESSING_QUEUE,
  type ImportCommitJob,
  type ImportPreviewJob,
} from "@newsaas/imports";
import { ImportCommitHandler } from "./commit.handler.js";
import { ImportPreviewHandler } from "./preview.handler.js";

/**
 * One import job, as the consumer receives it: two phases, one queue.
 *
 * A union rather than a shared shape, because the two messages belong to two
 * phases and the dispatcher's whole job is to route them by NAME. Both happen to
 * carry one id; that is a property of today's payloads, not a contract the
 * consumer may rely on.
 */
type ImportJob = ImportPreviewJob | ImportCommitJob;

/**
 * The processor, exported so its contract is testable without a Redis.
 *
 * IT DISPATCHES BY JOB NAME, and that is the only correct shape for one queue with
 * two jobs. A BullMQ `Worker` subscribes to a QUEUE, not to a job name: a second
 * worker on this queue would receive BOTH kinds and would have to drop the half it
 * does not handle — silently losing work, because a dropped job still counts as
 * processed. So one consumer, one queue, one switch.
 *
 * A THROW goes to the queue's `failed` handler and lands in the failed set. The
 * branch below is only reachable if a producer enqueues a name this deployment
 * does not know — a deployment skew — and that is worth retrying and then looking
 * at, rather than silently acknowledging.
 */
export function createImportProcessingProcessor(
  previewHandler: ImportPreviewHandler,
  commitHandler: ImportCommitHandler
): (job: Job<ImportJob>) => Promise<void> {
  return async (job) => {
    switch (job.name) {
      case IMPORT_PREVIEW_JOB:
        await previewHandler.handle(job.data);
        return;
      case IMPORT_COMMIT_JOB:
        await commitHandler.handle(job.data);
        return;
      default:
        throw new Error(`Unknown import job name: ${job.name}`);
    }
  };
}

function sanitizeWorkerError(error: unknown): string {
  const message = error instanceof Error ? error.message : "Import worker failed";
  return message.replace(/[\r\n\t]+/g, " ").slice(0, 300);
}

/**
 * The BullMQ consumer for the import queue (EPIC-19 [[IMP-002]]/[[IMP-003]]), the
 * notification delivery consumer's shape: one queue name, one processor, one
 * worker.
 *
 * The FILE keeps IMP-002's name (`preview.consumer.ts`) because it is still the
 * import queue's one consumer; what changed is that the queue now carries two job
 * names, so the class and the processor name say `import processing` rather than
 * `import preview`. A second file would have been a second worker on the same
 * queue — see {@link createImportProcessingProcessor}.
 *
 * `maxRetriesPerRequest: null` is correct HERE and would be wrong in a producer: a
 * worker's blocking command must not be killed by a retry limit, while the API's
 * enqueue must fail fast instead of holding a request open.
 *
 * `concurrency: 1` for the same reason the preview ran one at a time, and more
 * strongly now: a commit writes business records, and one import at a time keeps a
 * saturated import from starving the worker's other queues of the process's memory
 * and its obvious ordering (a preview of one file never competes with the commit of
 * another for the same rows).
 */
@Injectable()
export class ImportProcessingConsumer implements OnModuleInit, OnModuleDestroy {
  private worker: Worker<ImportJob> | null = null;
  private connection: Redis | null = null;

  constructor(
    private readonly previewHandler: ImportPreviewHandler,
    private readonly commitHandler: ImportCommitHandler
  ) {}

  onModuleInit(): void {
    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl) throw new Error("REDIS_URL is not set");

    this.connection = new Redis(redisUrl, { maxRetriesPerRequest: null });
    this.worker = new Worker<ImportJob>(
      IMPORT_PROCESSING_QUEUE,
      createImportProcessingProcessor(this.previewHandler, this.commitHandler),
      { connection: this.connection, concurrency: 1 }
    );
    this.worker.on("failed", (job, error) => {
      // The import id and a sanitized reason: no storage key, no row content.
      console.error("Import job failed", {
        importJobId: job?.data.importJobId ?? null,
        jobName: job?.name ?? null,
        error: sanitizeWorkerError(error),
      });
    });
    this.worker.on("error", (error) => {
      console.error("Import worker error", sanitizeWorkerError(error));
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
