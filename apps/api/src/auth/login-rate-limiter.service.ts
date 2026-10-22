import { Injectable, OnApplicationShutdown, Optional } from "@nestjs/common";
import { createHash } from "node:crypto";
import { InProcessRateLimitStore } from "./in-process-rate-limit.store.js";
import { RedisRateLimitStore } from "./redis-rate-limit.store.js";

export {
  LOGIN_FAILURE_THRESHOLD,
  LOGIN_FAILURE_WINDOW_MS,
  MAX_RECORDED_FAILURES,
  MAX_TRACKED_KEYS,
} from "./rate-limit-store.port.js";

/**
 * Login failure budget (design D4), now backed by a SHARED store ([[TD-005]],
 * [[DEC-076]]).
 *
 * ## The contract, unchanged
 *
 * - only VERIFIED failures are recorded — requests rejected while blocked are
 *   neither recorded nor reset, so the window never extends beyond 15 minutes
 *   after the last counted failure and victims cannot be locked out forever;
 * - entries older than the window are pruned lazily on every touch; a key whose
 *   history becomes empty is removed entirely;
 * - a SUCCESSFUL login resets (clears) the key;
 * - blocked checks happen BEFORE any credential work, so locked-out traffic
 *   performs no password verification at all;
 * - a key's history and the total key count are bounded.
 *
 * ## What changed
 *
 * The budget is no longer per-process when a shared store is configured. One
 * atomic sliding window in Redis enforces ONE budget across every `api` replica,
 * so "≥10 failures / 15 min" stops multiplying by replica count.
 *
 * This service is the seam every one of the FOUR callers already used — staff
 * login, staff password recovery, portal login and portal password recovery —
 * which is why the revision needs no per-path work.
 *
 * ## Degradation ([[DEC-076]])
 *
 * The in-process window is written on EVERY recorded failure, even while the
 * shared store is healthy, so it reflects recent traffic at the moment a
 * fallback is needed. Reads prefer the shared answer and fall back to the local
 * one when the shared store cannot answer.
 *
 * Fail OPEN, deliberately: Redis being unreachable must not lock every user of
 * every tenant out of every surface. The trade is stated rather than hidden — for
 * the duration of the outage the effective budget is per replica, which is
 * exactly the pre-revision behaviour, and the condition is logged by the store.
 *
 * `REDIS_URL` is the switch, and it is supplied EXPLICITLY by the caller
 * (`AuthModule`'s factory, or the shared-store suite) rather than read here, so a
 * unit test that constructs this class gets the in-process budget deterministically
 * no matter what the shell environment carries.
 *
 * Unlike the fiscal and notification producers, a missing `REDIS_URL` does NOT
 * throw: their absence would mean queued work silently never runs, while this one
 * only narrows a security budget — which is the same posture the degradation mode
 * already chose.
 */
@Injectable()
export class LoginRateLimiterService implements OnApplicationShutdown {
  private readonly inProcess = new InProcessRateLimitStore();
  private readonly shared: RedisRateLimitStore | null;

  /**
   * `@Optional()` follows `RedisHealthService`: the URL comes from an explicit
   * override in tests or from the validated environment in production, and the
   * service stays constructible without one.
   */
  public constructor(@Optional() redisUrl?: string) {
    this.shared =
      redisUrl === undefined || redisUrl.length === 0
        ? null
        : new RedisRateLimitStore({ redisUrl });
  }

  /** Stable limiter key. The IP is hashed so raw addresses never linger. */
  public key(email: string, ip: string): string {
    const normalizedEmail = email.trim().toLowerCase();
    const ipHash = createHash("sha256").update(ip, "utf8").digest("hex");
    return `${normalizedEmail}:${ipHash}`;
  }

  /** True when the key has exhausted its failure budget inside the window. */
  public async isBlocked(key: string, now: Date = new Date()): Promise<boolean> {
    if (this.shared !== null) {
      try {
        return await this.shared.isBlocked(key, now);
      } catch {
        // Falling through to the local window is the decision, not an oversight.
      }
    }
    return this.inProcess.isBlocked(key, now);
  }

  /** Records one verified login failure at `now`. */
  public async recordFailure(key: string, now: Date = new Date()): Promise<void> {
    // Always local first: the fallback must have real state when it is needed.
    await this.inProcess.recordFailure(key, now);
    if (this.shared === null) {
      return;
    }
    try {
      await this.shared.recordFailure(key, now);
    } catch {
      // The local record above already happened; the request proceeds.
    }
  }

  /** Clears the key after a successful login (design D4: success resets). */
  public async reset(key: string): Promise<void> {
    await this.inProcess.reset(key);
    if (this.shared === null) {
      return;
    }
    try {
      await this.shared.reset(key);
    } catch {
      // Best effort: a failed reset leaves a budget that expires on its own.
    }
  }

  /** Number of keys the local window tracks (exposed for bounded-memory tests). */
  public get trackedKeyCount(): number {
    return this.inProcess.trackedKeyCount;
  }

  public async onApplicationShutdown(): Promise<void> {
    if (this.shared !== null) {
      await this.shared.close();
    }
  }
}
