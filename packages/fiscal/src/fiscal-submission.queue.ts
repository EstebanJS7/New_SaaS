/** BullMQ queue shared by the API producer and worker consumer. */
export const FISCAL_SUBMISSION_QUEUE = "fiscal-submission";
/** Job name for submitting one fiscal document. */
export const FISCAL_SUBMISSION_JOB = "submit";
/** Bounded retry budget for fiscal submissions. */
export const FISCAL_SUBMISSION_MAX_ATTEMPTS = 5;
/** Exponential backoff base delay in milliseconds. */
export const FISCAL_SUBMISSION_BACKOFF_DELAY_MS = 1_000;

/**
 * Payload carries stable ids only, never a document dump, per the internal-events
 * payload rule.
 */
export interface FiscalSubmissionJob {
  readonly fiscalDocumentId: string;
  readonly tenantId: string;
}

/**
 * Returns the deterministic BullMQ identity for a fiscal document submission.
 *
 * The separator is a HYPHEN, and that is a correctness requirement rather than a
 * style choice. BullMQ refuses a custom job id containing `:` unless it splits
 * into exactly three segments (its own repeatable-job format), and `queue.add`
 * throws `Custom Id cannot contain :` BEFORE anything is enqueued.
 *
 * This function returned `fiscal-submit:<documentId>` until TD-039, which meant
 * no fiscal document could be enqueued at all in production: the throw happens
 * inside BullMQ's `Job` constructor, which a mocked `Queue` never reaches, so
 * the unit test asserted the literal and stayed green. Measured against
 * `bullmq@5.81.3` with a real Redis — `fiscal-submit:abc` is refused, `a:b:c`
 * is accepted only for its three segments, and `fiscal-submit-abc` is accepted.
 *
 * EPIC-17's notification boundary copied this shape and its review caught it as
 * a CRITICAL; `packages/notifications/src/notification-delivery.queue.ts`
 * carries the same hyphen for the same reason.
 */
export function fiscalSubmissionJobId(fiscalDocumentId: string): string {
  return `fiscal-submit-${fiscalDocumentId}`;
}

/**
 * Deterministic jobId makes queue dedupe and the document's partial unique
 * index agree on what "the same logical request" means (DEC-049).
 * removeOnFail remains false: the database row (lastErrorCode,
 * lastErrorMessage, attemptCount) and the SYSTEM audit rows written per attempt
 * are the failure of record. The queue's failed set is a convenience for a
 * human inspecting the queue before the sweep runs.
 */
export function fiscalSubmissionJobOptions(fiscalDocumentId: string) {
  return {
    jobId: fiscalSubmissionJobId(fiscalDocumentId),
    attempts: FISCAL_SUBMISSION_MAX_ATTEMPTS,
    backoff: {
      type: "exponential" as const,
      delay: FISCAL_SUBMISSION_BACKOFF_DELAY_MS,
    },
    removeOnComplete: true,
    removeOnFail: false,
  };
}
