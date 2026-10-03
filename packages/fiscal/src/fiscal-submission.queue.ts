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

/** Returns the deterministic BullMQ identity for a fiscal document submission. */
export function fiscalSubmissionJobId(fiscalDocumentId: string): string {
  return `fiscal-submit:${fiscalDocumentId}`;
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
