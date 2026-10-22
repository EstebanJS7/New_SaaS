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

/**
 * Job name for one preview pass.
 *
 * TWO JOB NAMES, ONE QUEUE ([[IMP-003]]). The queue is the import's backlog, not
 * its record, and a commit is the second phase of the same import — so it is a
 * second NAME on this queue rather than a second queue: the connection, the
 * retry policy's shape and the worker's capacity are the same, and a second
 * queue would double all three to separate two jobs that never race (the state
 * machine already forbids a commit before a preview).
 */
export const IMPORT_PREVIEW_JOB = "preview";

/** Job name for one commit pass over a previewed artefact ([[IMP-003]]). */
export const IMPORT_COMMIT_JOB = "commit";

/** Bounded retry budget for one preview. */
export const IMPORT_PREVIEW_MAX_ATTEMPTS = 3;

/** Exponential backoff base delay in milliseconds. */
export const IMPORT_PREVIEW_BACKOFF_DELAY_MS = 5_000;

/**
 * Bounded retry budget for one commit.
 *
 * The same shape as the preview's budget, and for the same reason: the
 * interesting failures are deterministic and are settled on the FIRST attempt by
 * `fail(...)` or per row, so a retry could only re-fail. What the budget covers
 * is an infrastructure failure BEFORE the claim — an unreachable database or
 * object store — where nothing was written and a retry is honest.
 */
export const IMPORT_COMMIT_MAX_ATTEMPTS = 3;

/** Exponential backoff base delay for one commit, in milliseconds. */
export const IMPORT_COMMIT_BACKOFF_DELAY_MS = 5_000;

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
 * The commit payload: the job's own id and nothing else.
 *
 * Its own type rather than an alias of {@link ImportPreviewJob} because the two
 * are separate messages with separate job names, and a producer that could pass
 * one where the other belongs would be a compile-time silence about the phase
 * being requested. The tenant is absent here for exactly the same reason.
 */
export interface ImportCommitJob {
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
 * The deterministic BullMQ identity for one import's commit ([[IMP-003]]).
 *
 * Distinct from the preview's identity, so the two phases never collide on one
 * queue entry, and deterministic for the same reason: a replay must address the
 * SAME entry rather than occupying a second one for an import that has one row
 * and one summary.
 *
 * The separator is a HYPHEN for the reason recorded on
 * {@link importPreviewJobId} — BullMQ refuses a custom id containing `:` — and
 * `queue.test.ts` asserts the shape directly, because a stubbed queue cannot
 * reproduce the throw.
 */
export function importCommitJobId(importJobId: string): string {
  return `import-commit-${importJobId}`;
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

/**
 * Job options for one commit ([[IMP-003]]).
 *
 * The preview's options one phase over, and each choice carries the same reason:
 * `removeOnComplete` because the summary is durable in `import_row_outcome` and
 * in the counters, and `removeOnFail` false because a commit that could not even
 * be settled is exactly the entry a human should find in the queue's failed set
 * before reading the row's own `failure_reason`.
 *
 * A commit is the phase that WRITES business records, so a retry is only ever
 * honest BEFORE the claim: once claimed, the runner settles the row itself and
 * the queue's retry has nothing to re-drive (its claim is pinned on `PREVIEWED`).
 */
export function importCommitJobOptions(importJobId: string) {
  return {
    jobId: importCommitJobId(importJobId),
    attempts: IMPORT_COMMIT_MAX_ATTEMPTS,
    backoff: {
      type: "exponential" as const,
      delay: IMPORT_COMMIT_BACKOFF_DELAY_MS,
    },
    removeOnComplete: true,
    removeOnFail: false,
  };
}
