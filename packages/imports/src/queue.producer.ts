/**
 * The import preview producer (EPIC-19 [[IMP-002]]).
 *
 * The notifications producer's shape one domain over: a port the caller depends on
 * rather than BullMQ directly, a fail-fast Redis configuration, a deadline on the
 * enqueue, and a factory that owns the connection so nobody constructs a `Queue`
 * per call.
 *
 * WHY THE TOKEN AND THE CLASS LIVE HERE RATHER THAN IN `apps/api`. There is ONE
 * queue, and both the deployable that writes to it and the one that reads from it
 * must agree on the identity of a job — so the transport is the package's, exactly
 * as `@newsaas/notifications` owns its producer. The API supplies the composition
 * root (which URL, and what to do when there is none); the package supplies the
 * mechanism.
 *
 * NO NEST IN THIS PACKAGE. Unlike the notification producer, this class carries no
 * `@Injectable()`: `packages/imports` is deliberately framework-free (its barrel
 * says so), and nothing here needs Nest to work — the API module provides the
 * instance through a factory, and Nest still calls {@link
 * BullMqImportPreviewProducer.onModuleDestroy} on shutdown because the hook is
 * looked up by name on the provider instance.
 */

import { Queue } from "bullmq";
import { Redis } from "ioredis";
import {
  IMPORT_PREVIEW_JOB,
  IMPORT_PROCESSING_QUEUE,
  importPreviewJobOptions,
  type ImportPreviewJob,
} from "./queue.js";

/** Injection token for the producer port. */
export const IMPORT_PREVIEW_PRODUCER = Symbol("IMPORT_PREVIEW_PRODUCER");

/**
 * Hard deadline for one enqueue.
 *
 * The enqueue happens inside an HTTP command, so an unreachable Redis must fail
 * the command rather than hold the request open until the client gives up.
 */
export const IMPORT_PREVIEW_ENQUEUE_TIMEOUT_MS = 2_000;

/**
 * Producer connection options, deliberately stricter than a consumer's:
 * `maxRetriesPerRequest: null` keeps a worker's blocking command alive forever and
 * would turn a Redis blip into a hung request here, `enableOfflineQueue: false`
 * refuses a command issued before the connection is ready instead of buffering it,
 * and `connectTimeout` bounds the connect.
 */
export const IMPORT_PREVIEW_PRODUCER_REDIS_OPTIONS = Object.freeze({
  maxRetriesPerRequest: 2,
  enableOfflineQueue: false,
  connectTimeout: 2_000,
});

export interface ImportPreviewProducer {
  /**
   * Enqueues one preview pass.
   *
   * A rejection PROPAGATES: the API command must know that nothing was queued,
   * because the row it just validated is still `UPLOADED` and the operator's next
   * action is to retry. Swallowing the error here would leave an import that looks
   * accepted and is never previewed.
   */
  enqueue(job: ImportPreviewJob): Promise<void>;
}

/** Resolves with `work`, or rejects once `timeoutMs` elapses first. */
function withDeadline<T>(work: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Import preview queue op exceeded ${timeoutMs}ms`)),
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

/**
 * The real producer over one long-lived queue.
 *
 * The `Queue` is INJECTED, never constructed per call: an enqueue that built its
 * own connection would open and close a Redis client per request.
 */
export class BullMqImportPreviewProducer implements ImportPreviewProducer {
  private released = false;

  constructor(
    private readonly queue: Queue,
    private readonly connection?: Redis
  ) {}

  async enqueue(job: ImportPreviewJob): Promise<void> {
    await withDeadline(
      this.queue.add(IMPORT_PREVIEW_JOB, job, importPreviewJobOptions(job.importJobId)),
      IMPORT_PREVIEW_ENQUEUE_TIMEOUT_MS
    );
  }

  /** Named for Nest's lifecycle lookup; safe to call outside it. */
  async onModuleDestroy(): Promise<void> {
    if (this.released) return;
    this.released = true;

    try {
      await this.queue.close();
    } catch {
      // Queue teardown is best-effort; release the owned connection below.
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

/**
 * The producer a deployment with NO queue gets.
 *
 * It exists so a module can be composed without Redis — a test harness, a custom
 * bootstrap — while the absence of the queue is still LOUD at the moment it would
 * matter: an enqueue REFUSES with a stable message instead of resolving and
 * leaving an import that nobody will preview. There is no silent drop and no
 * fake acceptance.
 */

/**
 * Builds the production producer from `REDIS_URL`.
 *
 * It creates the connection and the queue ONCE and hands both to the producer, so
 * the queue is injected rather than reconstructed and the owned connection can be
 * released on shutdown.
 */
export function createBullMqImportPreviewProducer(redisUrl: string): BullMqImportPreviewProducer {
  const connection = new Redis(redisUrl, IMPORT_PREVIEW_PRODUCER_REDIS_OPTIONS);
  const queue = new Queue(IMPORT_PROCESSING_QUEUE, { connection });
  return new BullMqImportPreviewProducer(queue, connection);
}
