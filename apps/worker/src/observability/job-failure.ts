import { captureError } from "@newsaas/observability";

/** The two fields of a BullMQ job this report reads. */
export interface FailedJobShape {
  readonly attemptsMade: number;
  readonly opts: { readonly attempts?: number };
}

/**
 * DEC-093: reports a job failure to error tracking only once BullMQ has given
 * up on it. A failed attempt that will be retried is a transient state, and
 * reporting each one would turn a flaky provider into noise. Only the queue
 * name travels — never the job's data.
 */
export function reportJobFailure(
  queue: string,
  job: FailedJobShape | undefined,
  error: unknown
): void {
  const attempts = job?.opts.attempts ?? 1;
  if (job !== undefined && job.attemptsMade < attempts) return;
  captureError(error, { job: queue });
}

/** DEC-093: a worker-level error (connection, lock) is always reported. */
export function reportWorkerError(queue: string, error: unknown): void {
  captureError(error, { job: queue });
}
