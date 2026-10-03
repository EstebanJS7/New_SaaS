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
 * Hard deadline for one enqueue.
 *
 * The issue command awaits the enqueue on the HTTP path, so an unreachable Redis
 * must fail the request rather than hold a Nest handler and a Fastify connection
 * open until the client gives up.
 */
export const FISCAL_SUBMISSION_ENQUEUE_TIMEOUT_MS = 2_000;

/**
 * Producer connection options, deliberately stricter than a worker's.
 *
 * `maxRetriesPerRequest: null` is the right setting for a worker, where a
 * blocking command must not be killed by a retry limit, and the wrong one here:
 * it keeps retrying a command indefinitely instead of rejecting, which is what
 * turns a Redis blip into a hung request. `enableOfflineQueue: false` makes a
 * command issued before the connection is ready fail immediately instead of
 * being buffered, and `connectTimeout` bounds the connect itself.
 */
export const FISCAL_SUBMISSION_PRODUCER_REDIS_OPTIONS = Object.freeze({
  maxRetriesPerRequest: 2,
  enableOfflineQueue: false,
  connectTimeout: 2_000,
});

/**
 * The command depends on this port, never on BullMQ directly, so unit tests
 * inject a fake and boot without Redis.
 */
export interface FiscalSubmissionProducer {
  enqueue(document: FiscalSubmissionJob): Promise<void>;
}

/** Resolves with `work`, or rejects once `timeoutMs` elapses first. */
function withDeadline<T>(work: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Fiscal submission enqueue exceeded ${timeoutMs}ms`)),
      timeoutMs
    );
    timer.unref();
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    );
  });
}

@Injectable()
export class BullMqFiscalSubmissionProducer implements FiscalSubmissionProducer, OnModuleDestroy {
  private released = false;

  constructor(
    private readonly queue: Queue,
    private readonly connection?: Redis
  ) {}

  async enqueue(document: FiscalSubmissionJob): Promise<void> {
    await withDeadline(
      this.queue.add(
        FISCAL_SUBMISSION_JOB,
        document,
        fiscalSubmissionJobOptions(document.fiscalDocumentId)
      ),
      FISCAL_SUBMISSION_ENQUEUE_TIMEOUT_MS
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
  const connection = new Redis(redisUrl, FISCAL_SUBMISSION_PRODUCER_REDIS_OPTIONS);
  const queue = new Queue(FISCAL_SUBMISSION_QUEUE, { connection });
  return new BullMqFiscalSubmissionProducer(queue, connection);
}
