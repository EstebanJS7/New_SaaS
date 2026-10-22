import {
  LOGIN_FAILURE_THRESHOLD,
  LOGIN_FAILURE_WINDOW_MS,
  MAX_RECORDED_FAILURES,
  MAX_TRACKED_KEYS,
  type RateLimitStore,
} from "./rate-limit-store.port.js";

/**
 * The in-process sliding window.
 *
 * It has two jobs after [[DEC-076]]:
 *
 * 1. **The local budget.** It is the whole budget when no shared store is
 *    configured (unit tests, a single-replica deployment).
 * 2. **The degradation target.** It is written on EVERY recorded failure, even
 *    when the shared store is healthy, so that a shared-store outage falls back
 *    to a window that actually reflects recent traffic instead of an empty one.
 *    The memory cost is exactly what this process already paid before the
 *    revision: ≤10k keys × ≤100 timestamps.
 *
 * Every bound is preserved from the pre-revision implementation: lazy pruning on
 * touch, per-key history ceiling, oldest-insertion key eviction.
 */
export class InProcessRateLimitStore implements RateLimitStore {
  private readonly failuresByKey = new Map<string, number[]>();

  // The interface is asynchronous because the shared store is a network round
  // trip. This implementation is pure memory, so it returns resolved promises
  // rather than declaring `async` over a body with nothing to await.
  public isBlocked(key: string, now: Date): Promise<boolean> {
    return Promise.resolve(
      this.recentFailures(key, now.getTime()).length >= LOGIN_FAILURE_THRESHOLD
    );
  }

  public recordFailure(key: string, now: Date): Promise<void> {
    // recentFailures() already pruned and persisted the trimmed history.
    const recent = this.recentFailures(key, now.getTime());
    if (recent.length < MAX_RECORDED_FAILURES) {
      recent.push(now.getTime());
      this.track(key, recent);
    }
    return Promise.resolve();
  }

  public reset(key: string): Promise<void> {
    this.failuresByKey.delete(key);
    return Promise.resolve();
  }

  /** Number of keys currently tracked (exposed for bounded-memory tests). */
  public get trackedKeyCount(): number {
    return this.failuresByKey.size;
  }

  private recentFailures(key: string, nowMs: number): number[] {
    const windowStart = nowMs - LOGIN_FAILURE_WINDOW_MS;
    const existing = this.failuresByKey.get(key);
    if (!existing) {
      return [];
    }
    const recent = existing.filter((timestamp) => timestamp > windowStart);
    if (recent.length !== existing.length) {
      if (recent.length === 0) {
        // A fully expired key must not linger as an empty array: drop it so
        // lazy pruning actually reclaims map entries.
        this.failuresByKey.delete(key);
      } else {
        this.failuresByKey.set(key, recent);
      }
    }
    return recent;
  }

  /** Persists a key's history; enforces the ceiling on NEW key insertions. */
  private track(key: string, history: number[]): void {
    const isNewKey = !this.failuresByKey.has(key);
    this.failuresByKey.set(key, history);
    if (isNewKey) {
      this.evictOverflow();
    }
  }

  /**
   * Oldest-insertion eviction (Map iterates in insertion order): while over
   * the ceiling, drop entries from the front until back under it.
   */
  private evictOverflow(): void {
    while (this.failuresByKey.size > MAX_TRACKED_KEYS) {
      const oldest = this.failuresByKey.keys().next().value;
      if (oldest === undefined) {
        break;
      }
      this.failuresByKey.delete(oldest);
    }
  }
}
