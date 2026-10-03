import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Worker, type Job } from "bullmq";
import { Redis } from "ioredis";
import { FISCAL_SUBMISSION_QUEUE, type FiscalSubmissionJob } from "@newsaas/fiscal";
import { FiscalSubmissionHandler } from "./fiscal-submission.handler.js";

export function createFiscalSubmissionProcessor(
  handler: FiscalSubmissionHandler
): (job: Job<FiscalSubmissionJob>) => Promise<void> {
  return async (job) => handler.handle(job.data);
}

function sanitizeWorkerError(error: unknown): string {
  const message = error instanceof Error ? error.message : "Fiscal submission worker failed";
  return message.replace(/[\r\n\t]+/g, " ").slice(0, 300);
}

@Injectable()
export class FiscalSubmissionConsumer implements OnModuleInit, OnModuleDestroy {
  private worker: Worker<FiscalSubmissionJob> | null = null;
  private connection: Redis | null = null;

  constructor(private readonly handler: FiscalSubmissionHandler) {}

  onModuleInit(): void {
    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl) throw new Error("REDIS_URL is not set");

    this.connection = new Redis(redisUrl, { maxRetriesPerRequest: null });
    this.worker = new Worker<FiscalSubmissionJob>(
      FISCAL_SUBMISSION_QUEUE,
      createFiscalSubmissionProcessor(this.handler),
      { connection: this.connection, concurrency: 1 }
    );
    this.worker.on("failed", (job, error) => {
      console.error("Fiscal submission job failed", {
        fiscalDocumentId: job?.data.fiscalDocumentId ?? null,
        error: sanitizeWorkerError(error),
      });
    });
    this.worker.on("error", (error) => {
      console.error("Fiscal submission worker error", sanitizeWorkerError(error));
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
