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
 * Deterministic jobId makes queue dedupe and the document's partial unique
 * index agree on what "the same logical request" means (DEC-049).
 * removeOnFail is deliberately false, unlike the branding precedent: failed
 * submissions are operator evidence and FISC-005's manual retry reads them.
 */
export function fiscalSubmissionJobOptions(fiscalDocumentId: string) {
  return {
    jobId: `fiscal-submit:${fiscalDocumentId}`,
    attempts: FISCAL_SUBMISSION_MAX_ATTEMPTS,
    backoff: {
      type: "exponential" as const,
      delay: FISCAL_SUBMISSION_BACKOFF_DELAY_MS,
    },
    removeOnComplete: true,
    removeOnFail: false,
  };
}
