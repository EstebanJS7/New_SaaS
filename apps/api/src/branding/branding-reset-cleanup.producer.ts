import { Injectable, type OnModuleDestroy } from "@nestjs/common";
import { Queue } from "bullmq";
import { Redis } from "ioredis";
import {
  BRANDING_RESET_CLEANUP_JOB,
  BRANDING_RESET_CLEANUP_QUEUE,
  brandingResetCleanupJobOptions,
  type BrandingResetCleanupJob,
} from "@newsaas/shared";

/**
 * Reset-cleanup queue contract (U5 producer side).
 *
 * Deliberately single-purpose: one queue, one job name, one payload. The queue
 * name, job name, payload shape and retry policy live in `@newsaas/shared`
 * (`branding-reset-cleanup`) so the worker consumer and reconciliation sweep
 * import the SAME constants and producer/consumer cannot drift.
 */
export { BRANDING_RESET_CLEANUP_JOB, BRANDING_RESET_CLEANUP_QUEUE };

/** Payload alias re-exported for existing callers/tests. */
export type CleanupJob = BrandingResetCleanupJob;

/** Injection token for the runtime {@link CleanupProducer}. */
export const BRANDING_RESET_CLEANUP_PRODUCER = Symbol("BRANDING_RESET_CLEANUP_PRODUCER");

/**
 * Application boundary for enqueuing reset cleanup. The reset path depends on
 * this port, never on BullMQ directly, so unit tests inject a fake and boot
 * without Redis.
 */
export interface CleanupProducer {
  /**
   * Enqueues one cleanup job for a committed intent. Callers MUST treat a
   * rejection as non-fatal: the intent row is already durable and a PENDING
   * row is reclaimed by the reconciliation sweep.
   */
  enqueue(intentId: string): Promise<void>;
}

/**
 * BullMQ-backed producer. Constructed from a Queue so tests can inject a fake.
 *
 * Owns the connection it was built with so Nest can release both the queue and
 * the dedicated Redis socket on shutdown (`app.close()` / SIGTERM). Without
 * this hook the producer leaks an open ioredis connection and the API process
 * cannot drain gracefully.
 */
@Injectable()
export class BullMqCleanupProducer implements CleanupProducer, OnModuleDestroy {
  private released = false;

  constructor(
    private readonly queue: Queue,
    private readonly connection?: Redis
  ) {}

  async enqueue(intentId: string): Promise<void> {
    const job: CleanupJob = { intentId };
    // Shared options set `jobId = intentId` (re-enqueue dedupe) plus the
    // bounded attempts/backoff policy the worker retries under.
    await this.queue.add(BRANDING_RESET_CLEANUP_JOB, job, brandingResetCleanupJobOptions(intentId));
  }

  /** Closes the queue first, then quits the owned Redis connection. */
  async onModuleDestroy(): Promise<void> {
    if (this.released) return;
    this.released = true;

    try {
      await this.queue.close();
    } catch {
      // Queue teardown is best-effort; the connection quit below is the
      // authoritative release.
    }

    const connection = this.connection;
    if (connection) {
      try {
        await connection.quit();
      } catch {
        connection.disconnect();
      }
    }
  }
}

/**
 * Builds the production producer from `REDIS_URL`. BullMQ owns the connection;
 * `maxRetriesPerRequest: null` is the documented requirement for worker/queue
 * connections.
 */
export function createBullMqCleanupProducer(redisUrl: string): BullMqCleanupProducer {
  const connection = new Redis(redisUrl, { maxRetriesPerRequest: null });
  const queue = new Queue(BRANDING_RESET_CLEANUP_QUEUE, { connection });
  return new BullMqCleanupProducer(queue, connection);
}
