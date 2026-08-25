import { describe, expect, it } from "vitest";
import {
  LOGIN_FAILURE_THRESHOLD,
  LOGIN_FAILURE_WINDOW_MS,
  LoginRateLimiterService,
  MAX_TRACKED_KEYS,
} from "./login-rate-limiter.service.js";

const T0 = new Date("2026-08-25T08:00:00.000Z");
const at = (offsetMs: number): Date => new Date(T0.getTime() + offsetMs);

describe("LoginRateLimiterService", () => {
  it("keys by (email, hashed IP): different emails or IPs stay independent", () => {
    const limiter = new LoginRateLimiterService();

    const keyA = limiter.key("owner@clinic.test", "203.0.113.10");
    const keyB = limiter.key("other@clinic.test", "203.0.113.10");
    const keyC = limiter.key("OWNER@clinic.test", "198.51.100.7");

    expect(keyA).not.toBe(keyB);
    expect(keyA).not.toBe(keyC);
    // Email case is normalized into the same key.
    expect(limiter.key("owner@clinic.test", "203.0.113.10")).toBe(keyA);
    // Raw IP never appears in the key (hashed component).
    expect(keyA).not.toContain("203.0.113.10");
    expect(keyA).toContain("owner@clinic.test");
  });

  it(`allows up to ${LOGIN_FAILURE_THRESHOLD - 1} failures and blocks the next check`, () => {
    const limiter = new LoginRateLimiterService();
    const key = limiter.key("victim@clinic.test", "10.0.0.1");

    for (let attempt = 1; attempt <= LOGIN_FAILURE_THRESHOLD - 1; attempt += 1) {
      limiter.recordFailure(key, at(attempt * 1000));
      expect(limiter.isBlocked(key, at(attempt * 1000))).toBe(false);
    }

    limiter.recordFailure(key, at(LOGIN_FAILURE_THRESHOLD * 1000));
    expect(limiter.isBlocked(key, at(LOGIN_FAILURE_THRESHOLD * 1000))).toBe(true);
  });

  it("slides the window: entries older than 15 minutes stop counting", () => {
    const limiter = new LoginRateLimiterService();
    const key = limiter.key("burst@clinic.test", "10.0.0.2");

    for (let attempt = 0; attempt < LOGIN_FAILURE_THRESHOLD; attempt += 1) {
      limiter.recordFailure(key, at(attempt * 60_000));
    }
    expect(limiter.isBlocked(key, at(10 * 60_000))).toBe(true);

    // Just past the window since the LAST recorded failure: budget recovered.
    const lastFailureOffset = (LOGIN_FAILURE_THRESHOLD - 1) * 60_000;
    expect(limiter.isBlocked(key, at(lastFailureOffset + LOGIN_FAILURE_WINDOW_MS + 1))).toBe(false);
  });

  it("a successful login resets the counter completely", () => {
    const limiter = new LoginRateLimiterService();
    const key = limiter.key("recovering@clinic.test", "10.0.0.3");

    for (let attempt = 0; attempt < LOGIN_FAILURE_THRESHOLD; attempt += 1) {
      limiter.recordFailure(key, at(attempt * 1000));
    }
    // Explicit `now` everywhere below: seeded failures live around T0, not
    // around wall clock, so defaulting would prune them on touch.
    const seededNow = at((LOGIN_FAILURE_THRESHOLD - 1) * 1000);
    expect(limiter.isBlocked(key, seededNow)).toBe(true);

    limiter.reset(key);
    expect(limiter.isBlocked(key, seededNow)).toBe(false);
    // Post-reset failures start a fresh budget instead of inheriting history.
    for (let attempt = 0; attempt < LOGIN_FAILURE_THRESHOLD - 1; attempt += 1) {
      limiter.recordFailure(key, at(60_000 + attempt * 1000));
    }
    expect(limiter.isBlocked(key, at(60_000 + (LOGIN_FAILURE_THRESHOLD - 2) * 1000))).toBe(false);
  });

  it("blocked checks perform no recording: window never extends while blocked", () => {
    const limiter = new LoginRateLimiterService();
    const key = limiter.key("attacker@evil.test", "10.0.0.4");

    for (let attempt = 0; attempt < LOGIN_FAILURE_THRESHOLD; attempt += 1) {
      limiter.recordFailure(key, at(attempt * 1000));
    }

    // Hammering while blocked must not push the unlock moment further away.
    const blockedAt = at((LOGIN_FAILURE_THRESHOLD - 1) * 1000);
    for (let hammer = 0; hammer < 50; hammer += 1) {
      expect(limiter.isBlocked(key, blockedAt)).toBe(true); // no recordFailure here
    }
    expect(limiter.isBlocked(key, at(LOGIN_FAILURE_WINDOW_MS + 1))).toBe(false);
  });

  it("isBlocked/recordFailure default to wall-clock when now is omitted", () => {
    const limiter = new LoginRateLimiterService();
    const key = limiter.key("defaults@clinic.test", "10.0.0.5");

    expect(() => limiter.recordFailure(key)).not.toThrow();
    expect(limiter.isBlocked(key)).toBe(false);
  });

  it("drops a key from the map entirely once its history fully expires", () => {
    const limiter = new LoginRateLimiterService();
    const key = limiter.key("expiring@clinic.test", "10.0.0.6");

    limiter.recordFailure(key, at(0));
    expect(limiter.trackedKeyCount).toBe(1);

    // Touch past the window: pruning empties the history, and the empty entry
    // must be deleted — not left lingering as [].
    expect(limiter.isBlocked(key, at(LOGIN_FAILURE_WINDOW_MS + 1))).toBe(false);
    expect(limiter.trackedKeyCount).toBe(0);

    // A post-expiry failure starts a fresh budget (eviction lost no state).
    for (let attempt = 0; attempt < LOGIN_FAILURE_THRESHOLD - 1; attempt += 1) {
      limiter.recordFailure(key, at(LOGIN_FAILURE_WINDOW_MS + 2_000 + attempt * 1000));
    }
    expect(limiter.isBlocked(key, at(LOGIN_FAILURE_WINDOW_MS + 11_000))).toBe(false);
  });

  it(`caps tracked keys at ${MAX_TRACKED_KEYS} and evicts the OLDEST insertion first`, () => {
    const limiter = new LoginRateLimiterService();

    // Oldest key: full budget => blocked BEFORE the flood.
    const evictedKey = limiter.key("oldest@clinic.test", "10.0.0.7");
    const seededNow = at((LOGIN_FAILURE_THRESHOLD - 1) * 1000);
    for (let attempt = 0; attempt < LOGIN_FAILURE_THRESHOLD; attempt += 1) {
      limiter.recordFailure(evictedKey, at(attempt * 1000));
    }
    expect(limiter.isBlocked(evictedKey, seededNow)).toBe(true);

    // Flood with ceiling-1 throwaway keys (timestamps stay inside the window
    // so pruning cannot interfere with the eviction being proven).
    for (let i = 0; i < MAX_TRACKED_KEYS - 1; i += 1) {
      limiter.recordFailure(limiter.key(`flood-${i}@evil.test`, "10.0.0.8"), at(i % 1000));
    }
    // One more budgeted key lands at the very END of the insertion order.
    const survivorKey = limiter.key("survivor@clinic.test", "10.0.0.9");
    for (let attempt = 0; attempt < LOGIN_FAILURE_THRESHOLD; attempt += 1) {
      limiter.recordFailure(survivorKey, at(attempt * 1000));
    }

    // Ceiling held...
    expect(limiter.trackedKeyCount).toBe(MAX_TRACKED_KEYS);
    // ...the OLDEST key was the one sacrificed (its exhausted budget is gone,
    // even though its failures are still inside the window)...
    expect(limiter.isBlocked(evictedKey, seededNow)).toBe(false);
    // ...and the newest budgeted key survived intact.
    expect(limiter.isBlocked(survivorKey, seededNow)).toBe(true);
  });

  it("keeps counters exact under hostile key churn", () => {
    const limiter = new LoginRateLimiterService();
    const target = limiter.key("churn-target@clinic.test", "10.0.9.9");

    let churnSeq = 0;
    const churnOnce = (): void =>
      limiter.recordFailure(limiter.key(`churn-${churnSeq++}@evil.test`, "10.0.9.8"), at(0));

    // Interleave throwaway keys between every counted target failure: churn
    // must neither suppress nor accelerate the trip point.
    for (let attempt = 1; attempt <= LOGIN_FAILURE_THRESHOLD; attempt += 1) {
      churnOnce();
      limiter.recordFailure(target, at(attempt * 1000));
      expect(limiter.isBlocked(target, at(attempt * 1000))).toBe(
        attempt >= LOGIN_FAILURE_THRESHOLD
      );
    }

    // After the window passes BEYOND the last counted failure, touching the
    // target reclaims exactly ITS fully-expired entry (delta, not absolute:
    // stale churn keys are only reclaimed when individually touched).
    const afterLastFailure = LOGIN_FAILURE_THRESHOLD * 1000;
    const beforeTouch = limiter.trackedKeyCount;
    expect(limiter.isBlocked(target, at(afterLastFailure + LOGIN_FAILURE_WINDOW_MS + 1))).toBe(
      false
    );
    expect(limiter.trackedKeyCount).toBe(beforeTouch - 1);
  });
});
