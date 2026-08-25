import { createHash } from "node:crypto";
import { Injectable } from "@nestjs/common";

/**
 * Failure budget per (email, IP-hash) pair within the sliding window
 * (design D4: >=10 failed logins / 15 min => 429 RATE_LIMITED).
 */
export const LOGIN_FAILURE_THRESHOLD = 10;
export const LOGIN_FAILURE_WINDOW_MS = 15 * 60 * 1000;

/** Defensive ceiling so a hostile loop cannot grow a key's history forever. */
const MAX_RECORDED_FAILURES = 100;

/**
 * Key-count ceiling bounding total limiter memory: at most 10k tracked
 * (email, IP) pairs, each holding ≤100 timestamps. When the ceiling is
 * exceeded the OLDEST-inserted keys are evicted first (Map iteration order is
 * insertion order). This is approximate DoS containment for the single-replica
 * MVP — sustained key churn can evict honest budgets — and is superseded by a
 * shared-store limiter before any multi-replica deployment (TD-005).
 */
export const MAX_TRACKED_KEYS = 10_000;

/**
 * In-process sliding-window login rate limiter (design D4).
 *
 * SINGLE-REPLICA LIMITATION: state lives in this process' memory only.
 * Multiple API replicas would each enforce their own budget; the design
 * already tracks a shared-store revision as Tech Debt for multi-instance
 * deployments. Accepted for the single-replica MVP.
 *
 * Window semantics (documented contract):
 * - only VERIFIED failures are recorded — requests rejected while blocked are
 *   neither recorded nor reset, so the window never extends beyond 15 minutes
 *   after the last counted failure and victims cannot be locked out forever;
 * - entries older than the window are pruned lazily on every touch; a key
 *   whose history becomes empty is removed from the map entirely;
 * - total tracked keys are capped at {@link MAX_TRACKED_KEYS} with
 *   oldest-insertion eviction, so hostile key churn cannot grow memory;
 * - a SUCCESSFUL login resets (clears) the key entirely;
 * - blocked checks happen BEFORE any credential work, so locked-out traffic
 *   performs no password verification at all.
 */
@Injectable()
export class LoginRateLimiterService {
  private readonly failuresByEmailAndIpHash = new Map<string, number[]>();

  /** Stable limiter key. The IP is hashed so raw addresses never linger. */
  key(email: string, ip: string): string {
    const normalizedEmail = email.trim().toLowerCase();
    const ipHash = createHash("sha256").update(ip, "utf8").digest("hex");
    return `${normalizedEmail}:${ipHash}`;
  }

  /** True when the key has exhausted its failure budget inside the window. */
  isBlocked(key: string, now: Date = new Date()): boolean {
    return this.recentFailures(key, now.getTime()).length >= LOGIN_FAILURE_THRESHOLD;
  }

  /** Records one verified login failure at `now`. */
  recordFailure(key: string, now: Date = new Date()): void {
    // recentFailures() already pruned and persisted the trimmed history.
    const recent = this.recentFailures(key, now.getTime());
    if (recent.length < MAX_RECORDED_FAILURES) {
      recent.push(now.getTime());
      this.track(key, recent);
    }
  }

  /** Clears the key after a successful login (design D4: success resets). */
  reset(key: string): void {
    this.failuresByEmailAndIpHash.delete(key);
  }

  /** Number of keys currently tracked (exposed for bounded-memory tests). */
  get trackedKeyCount(): number {
    return this.failuresByEmailAndIpHash.size;
  }

  private recentFailures(key: string, nowMs: number): number[] {
    const windowStart = nowMs - LOGIN_FAILURE_WINDOW_MS;
    const existing = this.failuresByEmailAndIpHash.get(key);
    if (!existing) {
      return [];
    }
    const recent = existing.filter((timestamp) => timestamp > windowStart);
    if (recent.length !== existing.length) {
      if (recent.length === 0) {
        // A fully expired key must not linger as an empty array: drop it so
        // lazy pruning actually reclaims map entries.
        this.failuresByEmailAndIpHash.delete(key);
      } else {
        this.failuresByEmailAndIpHash.set(key, recent);
      }
    }
    return recent;
  }

  /** Persists a key's history; enforces the ceiling on NEW key insertions. */
  private track(key: string, history: number[]): void {
    const isNewKey = !this.failuresByEmailAndIpHash.has(key);
    this.failuresByEmailAndIpHash.set(key, history);
    if (isNewKey) {
      this.evictOverflow();
    }
  }

  /**
   * Oldest-insertion eviction (Map iterates in insertion order): while over
   * the ceiling, drop entries from the front until back under it.
   */
  private evictOverflow(): void {
    while (this.failuresByEmailAndIpHash.size > MAX_TRACKED_KEYS) {
      const oldest = this.failuresByEmailAndIpHash.keys().next().value;
      if (oldest === undefined) {
        break;
      }
      this.failuresByEmailAndIpHash.delete(oldest);
    }
  }
}
