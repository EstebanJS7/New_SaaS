export const DEFAULT_FISCAL_RECOVERY_INTERVAL_MS = 60_000;
/**
 * Five minutes exceeds the retry budget (five attempts with exponential
 * backoff from one second is about 31 seconds) and equals CLAIM_LEASE_MS, so
 * the sweep never races a live claim.
 */
export const DEFAULT_FISCAL_RECOVERY_STALE_MS = 300_000;
export const FISCAL_RECOVERY_BATCH_LIMIT = 100;

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
