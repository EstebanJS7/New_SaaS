import { Injectable, type OnModuleDestroy } from "@nestjs/common";
import { Queue } from "bullmq";
import { Redis } from "ioredis";
import {
  FISCAL_SUBMISSION_JOB,
  FISCAL_SUBMISSION_QUEUE,
  fiscalSubmissionJobOptions,
  type FiscalSubmissionJob,
} from "@newsaas/fiscal";

/** Injection token for the fiscal submission producer port. */
export const FISCAL_SUBMISSION_PRODUCER = Symbol("FISCAL_SUBMISSION_PRODUCER");

/**
 * The command depends on this port, never on BullMQ directly, so unit tests
 * inject a fake and boot without Redis.
 */
export interface FiscalSubmissionProducer {
  enqueue(document: FiscalSubmissionJob): Promise<void>;
}

@Injectable()
export class BullMqFiscalSubmissionProducer implements FiscalSubmissionProducer, OnModuleDestroy {
  private released = false;

  constructor(
    private readonly queue: Queue,
    private readonly connection?: Redis
  ) {}

  async enqueue(document: FiscalSubmissionJob): Promise<void> {
    await this.queue.add(
      FISCAL_SUBMISSION_JOB,
      document,
      fiscalSubmissionJobOptions(document.fiscalDocumentId)
    );
  }

  async onModuleDestroy(): Promise<void> {
    if (this.released) return;
    this.released = true;

    try {
      await this.queue.close();
    } catch {
      // Queue teardown is best-effort; release the owned Redis connection below.
    }

    if (this.connection) {
      try {
        await this.connection.quit();
      } catch {
        this.connection.disconnect();
      }
    }
  }
}

export function createBullMqFiscalSubmissionProducer(
  redisUrl: string
): BullMqFiscalSubmissionProducer {
  const connection = new Redis(redisUrl, { maxRetriesPerRequest: null });
  const queue = new Queue(FISCAL_SUBMISSION_QUEUE, { connection });
  return new BullMqFiscalSubmissionProducer(queue, connection);
}
