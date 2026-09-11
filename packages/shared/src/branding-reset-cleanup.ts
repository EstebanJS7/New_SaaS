/**
 * Shared contract for the durable branding-reset storage-cleanup pipeline.
 *
 * Single source of truth for the queue name, job name, payload shape, and
 * bounded-retry policy so the API producer and the worker consumer/
 * reconciliation cannot drift. Deliberately minimal — this is NOT a generic
 * job/outbox framework; it is the one queue this capability owns.
 */

/** BullMQ queue that carries reset-cleanup intents to the worker. */
export const BRANDING_RESET_CLEANUP_QUEUE = "branding-reset-cleanup";

/** Job name for a single captured-object cleanup pass. */
export const BRANDING_RESET_CLEANUP_JOB = "cleanup";

/** Bounded retry budget shared by the BullMQ job and the intent row. */
export const BRANDING_RESET_CLEANUP_MAX_ATTEMPTS = 5;

/** Exponential backoff base delay (ms) between cleanup attempts. */
export const BRANDING_RESET_CLEANUP_BACKOFF_DELAY_MS = 1_000;

/**
 * Queue payload. It carries ONLY the durable intent id: tenant and storage keys
 * are read back from the database by the consumer, so a forged or stale job can
 * never address foreign keys.
 */
export interface BrandingResetCleanupJob {
  readonly intentId: string;
}

/**
 * BullMQ job options shared by the API producer and the worker reconciliation
 * sweep. `jobId = intentId` dedupes re-enqueues without extra bookkeeping;
 * bounded attempts + exponential backoff keep a poison cleanup from retrying
 * forever, and completed/failed jobs are removed so Redis stays bounded.
 */
export function brandingResetCleanupJobOptions(intentId: string) {
  return {
    jobId: intentId,
    attempts: BRANDING_RESET_CLEANUP_MAX_ATTEMPTS,
    backoff: { type: "exponential" as const, delay: BRANDING_RESET_CLEANUP_BACKOFF_DELAY_MS },
    removeOnComplete: true,
    removeOnFail: true,
  };
}
