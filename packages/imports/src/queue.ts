/**
 * The BullMQ queue contract for one import preview (EPIC-19 [[IMP-002]]).
 *
 * ONE DECLARATION, TWO DEPLOYABLES. `apps/api` enqueues through this contract and
 * `apps/worker` consumes it, so the queue name, the job name and the identity
 * below are shared values rather than two literals that a later edit can pull
 * apart. It mirrors `packages/notifications/src/notification-delivery.queue.ts`,
 * which mirrors `packages/fiscal/src/fiscal-submission.queue.ts`: a named queue, a
 * named job, a DETERMINISTIC identity, and a payload of stable ids only.
 *
 * WHY A QUEUE AT ALL. [[DEC-072]] decided every import is asynchronous — no
 * threshold, no "large files only" branch. The upload returns an identifier to
 * poll and the preview runs here, so a file of unknown size never occupies a
 * request.
 *
 * THE PAYLOAD IS ONE ID. No tenant, no storage key, no file content, no counts.
 * The worker reads the `import_job` row and takes everything else from it —
 * including the tenant, which is the ONLY place in the import path where a tenant
 * is not derived from a request. A payload that carried a tenant would be a
 * second source of truth for the one fact the row already owns, and the storage
 * key must never travel further than the row it is written on ([[DEC-072]]).
 */

/** BullMQ queue shared by the API producer and the worker consumer. */
export const IMPORT_PROCESSING_QUEUE = "import-processing";

/** Job name for one preview pass. */
export const IMPORT_PREVIEW_JOB = "preview";

/** Bounded retry budget for one preview. */
export const IMPORT_PREVIEW_MAX_ATTEMPTS = 3;

/** Exponential backoff base delay in milliseconds. */
export const IMPORT_PREVIEW_BACKOFF_DELAY_MS = 5_000;

/**
 * The payload: the job's own id and nothing else.
 *
 * The tenant is deliberately absent. The worker has no request context, so it
 * resolves the tenant from the `import_job` row — and accepting one here would
 * make a job payload able to disagree with the row it names.
 */
export interface ImportPreviewJob {
  readonly importJobId: string;
}

/**
 * The deterministic BullMQ identity for one import's preview.
 *
 * Deterministic because the job id is the queue's dedupe key: the API trigger and
 * any replay must address the SAME entry, and a random id would let one import
 * occupy several queue entries while the row records one preview.
 *
 * The separator is a HYPHEN, and that is a correctness requirement rather than a
 * style choice: BullMQ refuses a custom job id containing `:` unless it splits
 * into exactly three segments (its own repeatable-job format), and `queue.add`
 * throws `Custom Id cannot contain :` BEFORE anything is enqueued. A colon here
 * would break the enqueue for every import. The rule cannot be caught by a unit
 * test with a stubbed queue, which is why the shape is asserted directly in
 * `queue.test.ts` — the same discovery, and the same fence, as the notification
 * queue's.
 */
export function importPreviewJobId(importJobId: string): string {
  return `import-preview-${importJobId}`;
}

/**
 * Job options for one preview.
 *
 * `attempts` is small on purpose: the interesting failures are deterministic (a
 * file the reader refuses, a header contract the file does not match) and the
 * worker's `fail` settles them on the FIRST attempt by moving the row to
 * `FAILED`. Retrying those could only re-fail. What the budget does cover is a
 * transient infrastructure failure before the row is claimed — an unreachable
 * database or object store — where nothing was written and a retry is honest.
 *
 * `removeOnComplete` is true because the outcome is durable on the row and in
 * `import_row_outcome`; the queue is a backlog, not a record. `removeOnFail` stays
 * false so the failed set remains what a human inspecting the queue sees before
 * reading the row's own `failure_reason`.
 */
export function importPreviewJobOptions(importJobId: string) {
  return {
    jobId: importPreviewJobId(importJobId),
    attempts: IMPORT_PREVIEW_MAX_ATTEMPTS,
    backoff: {
      type: "exponential" as const,
      delay: IMPORT_PREVIEW_BACKOFF_DELAY_MS,
    },
    removeOnComplete: true,
    removeOnFail: false,
  };
}
