/**
 * Failure-budget store contract behind `LoginRateLimiterService`
 * ([[TD-005]], [[DEC-076]] / [[HARD-002]]).
 *
 * The limiter answers one question and records one fact. Fourteen months of
 * single-replica behaviour are encoded in the semantics below, and both
 * implementations must honour them exactly — the caller does not know which one
 * it is talking to.
 *
 * Documented contract:
 *
 * - the window is sliding, `LOGIN_FAILURE_WINDOW_MS` long, ending at `now`;
 * - only VERIFIED failures are recorded — the caller decides what counts;
 * - a request rejected while blocked is neither recorded nor reset, so the
 *   window never extends past the window's end after the last counted failure;
 * - a key whose history becomes empty is dropped entirely, so pruning reclaims
 *   memory rather than leaving empty containers behind;
 * - `reset` clears a key completely (a successful login resets the budget);
 * - a key's recorded history is bounded, so a hostile loop cannot grow one key
 *   forever;
 * - total tracked keys are bounded, so hostile key churn cannot grow the store
 *   without limit.
 *
 * Methods are asynchronous because one implementation is a network round trip.
 * That is the only signature change the shared-store revision forced, and it is
 * what keeps every caller free of store knowledge.
 */
export interface RateLimitStore {
  /** True when `key` has exhausted its failure budget at `now`. */
  isBlocked(key: string, now: Date): Promise<boolean>;

  /** Records one verified failure of `key` at `now`. */
  recordFailure(key: string, now: Date): Promise<void>;

  /** Clears `key`'s history (successful login). */
  reset(key: string): Promise<void>;
}

/**
 * Failures inside the window that trip the budget (design D4: >=10 failed
 * logins / 15 min => 429 RATE_LIMITED).
 */
export const LOGIN_FAILURE_THRESHOLD = 10;

/** Length of the sliding window in milliseconds (15 minutes). */
export const LOGIN_FAILURE_WINDOW_MS = 15 * 60 * 1000;

/** Defensive ceiling so a hostile loop cannot grow a key's history forever. */
export const MAX_RECORDED_FAILURES = 100;

/**
 * Key-count ceiling bounding the in-process store's memory: at most 10k tracked
 * keys, each holding ≤100 timestamps. When the ceiling is exceeded the
 * OLDEST-inserted keys are evicted first (Map iteration order is insertion
 * order). This is approximate DoS containment — sustained key churn can evict
 * honest budgets.
 */
export const MAX_TRACKED_KEYS = 10_000;
