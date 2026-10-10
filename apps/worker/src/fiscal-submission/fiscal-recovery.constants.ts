import { FISCAL_SUBMISSION_MAX_ATTEMPTS } from "@newsaas/fiscal";

export const DEFAULT_FISCAL_RECOVERY_INTERVAL_MS = 60_000;
/**
 * Five minutes exceeds the retry budget (five attempts with exponential
 * backoff from one second is about 31 seconds) and equals CLAIM_LEASE_MS, so
 * the sweep never races a live claim.
 */
export const DEFAULT_FISCAL_RECOVERY_STALE_MS = 300_000;
export const FISCAL_RECOVERY_BATCH_LIMIT = 100;

/**
 * How many submission attempts an `ERROR` row may carry before the sweep stops
 * re-driving it.
 *
 * The mechanism: the sweep excludes `ERROR` rows whose `attempt_count` is at or
 * above this bound, so a failure the data makes permanent — a schema refusal, a
 * missing fiscal profile — stops being resubmitted and stays in `ERROR` with its
 * code and its count for an operator to read. The bound is **two full BullMQ
 * retry budgets**: the job that first failed already spent
 * `FISCAL_SUBMISSION_MAX_ATTEMPTS`, and one sweep re-drive spends a second, so a
 * genuinely transient outage still gets a long second chance while a permanent
 * one is held once both budgets are spent.
 *
 * It is a **count** and not a list of reason codes on purpose: §23.8 records that
 * the provider's result-code catalogue is open — a well-formed code the client
 * has never seen is still an answer — so a list of "permanent" codes would
 * silently rot the first time a new code appeared, and would keep re-driving a
 * failure it failed to list forever. A count bounds every cause, including the
 * ones nobody enumerated.
 *
 * It is an **operational** constant, not a protocol one: no retrieved source in
 * §23 or §24 publishes a retry bound, so it carries no citation and says so
 * rather than pretending to one.
 */
export const DEFAULT_FISCAL_RECOVERY_MAX_ATTEMPTS = FISCAL_SUBMISSION_MAX_ATTEMPTS * 2;

export interface FiscalRecoveryTiming {
  readonly intervalMs: number;
  readonly staleMs: number;
}

function readPositiveInt(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function resolveFiscalRecoveryTiming(
  env: NodeJS.ProcessEnv = process.env
): FiscalRecoveryTiming {
  return {
    intervalMs: readPositiveInt(
      env.FISCAL_SUBMISSION_SWEEP_INTERVAL_MS,
      DEFAULT_FISCAL_RECOVERY_INTERVAL_MS
    ),
    staleMs: readPositiveInt(env.FISCAL_SUBMISSION_STALE_MS, DEFAULT_FISCAL_RECOVERY_STALE_MS),
  };
}
