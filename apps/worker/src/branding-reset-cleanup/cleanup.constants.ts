import {
  BRANDING_RESET_CLEANUP_JOB,
  BRANDING_RESET_CLEANUP_MAX_ATTEMPTS,
  BRANDING_RESET_CLEANUP_QUEUE,
} from "@newsaas/shared";

/**
 * Worker-side constants for the durable branding-reset cleanup path.
 *
 * The queue name, job name and default retry bound come from the shared
 * contract so the API producer and this consumer cannot drift. Sweep timing is
 * worker-local and overridable through environment variables.
 */
export { BRANDING_RESET_CLEANUP_JOB, BRANDING_RESET_CLEANUP_QUEUE };

/** Default interval between reconciliation sweeps (ms). */
export const DEFAULT_RECONCILIATION_INTERVAL_MS = 60_000;

/** Default age (ms) after which a PENDING intent is considered lost. */
export const DEFAULT_RECONCILIATION_STALE_MS = 120_000;

/** Maximum intents re-enqueued per sweep so a backlog cannot stampede. */
export const RECONCILIATION_BATCH_LIMIT = 100;

export interface ReconciliationTiming {
  readonly intervalMs: number;
  readonly staleMs: number;
}

/** Tolerant positive-integer reader: blank/invalid values fall back. */
function readPositiveInt(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === "") {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/** Resolves the sweep interval and stale threshold from the environment. */
export function resolveReconciliationTiming(
  env: NodeJS.ProcessEnv = process.env
): ReconciliationTiming {
  return {
    intervalMs: readPositiveInt(
      env.BRANDING_RESET_CLEANUP_SWEEP_INTERVAL_MS,
      DEFAULT_RECONCILIATION_INTERVAL_MS
    ),
    staleMs: readPositiveInt(env.BRANDING_RESET_CLEANUP_STALE_MS, DEFAULT_RECONCILIATION_STALE_MS),
  };
}

/** Resolves the terminal failure bound from the environment. */
export function resolveMaxAttempts(env: NodeJS.ProcessEnv = process.env): number {
  return readPositiveInt(
    env.BRANDING_RESET_CLEANUP_MAX_ATTEMPTS,
    BRANDING_RESET_CLEANUP_MAX_ATTEMPTS
  );
}
