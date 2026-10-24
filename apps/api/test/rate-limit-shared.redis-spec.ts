import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Redis } from "ioredis";
import { randomUUID } from "node:crypto";
import {
  LOGIN_FAILURE_THRESHOLD,
  LOGIN_FAILURE_WINDOW_MS,
  LoginRateLimiterService,
} from "../src/auth/login-rate-limiter.service.js";
import { createApiLogger } from "../src/common/http/api-logger.factory.js";
import { RedisRateLimitStore } from "../src/auth/redis-rate-limit.store.js";

/**
 * The shared failure budget, against a REAL Redis ([[TD-005]], [[DEC-076]] / [[HARD-002]]).
 *
 * This suite exists because the claim it protects cannot be made any other way.
 * "One global budget across replicas" is a statement about two processes sharing
 * state; a fake that returns the same numbers would agree with the code by
 * construction and prove nothing. So this file talks to a real `ioredis` and, for
 * the cross-replica case, to TWO independent connections — which is what a second
 * API replica is from Redis' point of view.
 *
 * `REDIS_URL_TEST` is REQUIRED, with no fallback (the same contract [[TD-021]]
 * asks the live-PostgreSQL suite to adopt, applied here from the start): a suite
 * that silently reuses another variable is a suite whose measurement depends on
 * the shell it ran in.
 *
 * Run with `pnpm --filter @newsaas/api test:redis`, or let CI do it.
 */

const REDIS_URL = process.env.REDIS_URL_TEST;

if (REDIS_URL === undefined || REDIS_URL.length === 0) {
  throw new Error(
    "REDIS_URL_TEST is required for the shared rate-limit suite (HARD-002). " +
      "Point it at a disposable Redis, e.g. REDIS_URL_TEST=redis://127.0.0.1:6379."
  );
}

/** Port nothing listens on: the store must fail to answer, not hang or throw. */
const DEAD_REDIS_URL = "redis://127.0.0.1:6399";

/** Keys accumulated for teardown, so repeated runs cannot inherit a budget. */
const createdKeys: string[] = [];

/** A unique identity per test, so no test can observe another one's budget. */
function freshEmail(label: string): string {
  return `hard-002-${label}-${randomUUID()}@clinic.test`;
}

/** A service instance wired to the real shared store — one simulated replica. */
function replica(): LoginRateLimiterService {
  return new LoginRateLimiterService(REDIS_URL);
}

const T0 = new Date("2026-10-22T12:00:00.000Z");
const at = (offsetMs: number): Date => new Date(T0.getTime() + offsetMs);

let admin: Redis;

beforeAll(() => {
  admin = new Redis(REDIS_URL, { maxRetriesPerRequest: 1, commandTimeout: 2_000 });
  // Fail fast and loudly if the variable points somewhere dead: a suite that
  // cannot reach its store must not report green.
  return admin.ping().then(() => undefined);
});

afterAll(async () => {
  if (createdKeys.length > 0) {
    await admin.del(...createdKeys);
  }
  await admin.quit();
});

function trackKey(key: string): string {
  const redisKey = `auth:login-failure-budget:${key}`;
  createdKeys.push(redisKey);
  return redisKey;
}

describe("shared budget across two independent connections (HARD-002)", () => {
  it("trips ONE global budget, not one per connection", async () => {
    const email = freshEmail("global");
    const replicaA = replica();
    const replicaB = replica();
    const keyA = replicaA.key(email, "203.0.113.10");
    const keyB = replicaB.key(email, "203.0.113.10");
    trackKey(keyA);

    // The same identity, driven from two "replicas" that share NOTHING except
    // Redis — exactly what a load balancer does to an attacker's attempts.
    expect(keyA).toBe(keyB);

    const half = Math.floor(LOGIN_FAILURE_THRESHOLD / 2);
    for (let attempt = 0; attempt < half; attempt += 1) {
      await replicaA.recordFailure(keyA, at(attempt));
    }
    for (let attempt = 0; attempt < LOGIN_FAILURE_THRESHOLD - half; attempt += 1) {
      await replicaB.recordFailure(keyB, at(half * 1000 + attempt));
    }

    // Under a per-process budget NEITHER replica would have reached the
    // threshold: half is below it and so is the other half. The threshold is
    // reachable only because the budget is shared, which is the whole point.
    expect(half).toBeLessThan(LOGIN_FAILURE_THRESHOLD);
    expect(LOGIN_FAILURE_THRESHOLD - half).toBeLessThan(LOGIN_FAILURE_THRESHOLD);
    expect(await replicaA.isBlocked(keyA, at(LOGIN_FAILURE_THRESHOLD * 1000))).toBe(true);
    expect(await replicaB.isBlocked(keyB, at(LOGIN_FAILURE_THRESHOLD * 1000))).toBe(true);

    await replicaA.onApplicationShutdown();
    await replicaB.onApplicationShutdown();
  });

  it("stays below the threshold for one less failure than needed", async () => {
    const email = freshEmail("under");
    const replicaA = replica();
    const replicaB = replica();
    const key = replicaA.key(email, "203.0.113.11");
    trackKey(key);

    for (let attempt = 0; attempt < LOGIN_FAILURE_THRESHOLD - 1; attempt += 1) {
      await replicaA.recordFailure(key, at(attempt));
    }

    expect(await replicaB.isBlocked(key, at(LOGIN_FAILURE_THRESHOLD * 1000))).toBe(false);

    await replicaA.onApplicationShutdown();
    await replicaB.onApplicationShutdown();
  });

  it("keeps independent identities independent", async () => {
    const replicaA = replica();
    const emailA = freshEmail("iso-a");
    const keyA = replicaA.key(emailA, "203.0.113.12");
    const keyB = replicaA.key(freshEmail("iso-b"), "203.0.113.12");
    const keyC = replicaA.key(emailA, "198.51.100.99");
    trackKey(keyA);
    trackKey(keyB);
    trackKey(keyC);

    for (let attempt = 0; attempt < LOGIN_FAILURE_THRESHOLD; attempt += 1) {
      await replicaA.recordFailure(keyA, at(attempt));
    }

    expect(await replicaA.isBlocked(keyA, at(LOGIN_FAILURE_THRESHOLD * 1000))).toBe(true);
    // Different email, and the same email from a different IP, each get their own
    // budget: one attacker must not lock out an honest user sharing the address.
    expect(await replicaA.isBlocked(keyB, at(LOGIN_FAILURE_THRESHOLD * 1000))).toBe(false);
    expect(await replicaA.isBlocked(keyC, at(LOGIN_FAILURE_THRESHOLD * 1000))).toBe(false);

    await replicaA.onApplicationShutdown();
  });
});

describe("window semantics on the shared store (HARD-002)", () => {
  it("prunes by score so the window slides rather than resets", async () => {
    const email = freshEmail("window");
    const limiter = replica();
    const key = limiter.key(email, "203.0.113.20");
    trackKey(key);

    for (let attempt = 0; attempt < LOGIN_FAILURE_THRESHOLD; attempt += 1) {
      await limiter.recordFailure(key, at(attempt * 1000));
    }
    const lastFailureAt = (LOGIN_FAILURE_THRESHOLD - 1) * 1000;

    expect(await limiter.isBlocked(key, at(lastFailureAt))).toBe(true);
    // One millisecond past the window measured from the LAST counted failure.
    expect(await limiter.isBlocked(key, at(lastFailureAt + LOGIN_FAILURE_WINDOW_MS + 1))).toBe(
      false
    );

    await limiter.onApplicationShutdown();
  });

  it("a successful login resets the shared key for every replica", async () => {
    const email = freshEmail("reset");
    const replicaA = replica();
    const replicaB = replica();
    const key = replicaA.key(email, "203.0.113.21");
    trackKey(key);

    for (let attempt = 0; attempt < LOGIN_FAILURE_THRESHOLD; attempt += 1) {
      await replicaA.recordFailure(key, at(attempt));
    }
    expect(await replicaB.isBlocked(key, at(LOGIN_FAILURE_THRESHOLD * 1000))).toBe(true);

    await replicaA.reset(key);

    // The reset must be shared too: a success on one replica has to clear the
    // budget the other one is enforcing.
    expect(await replicaB.isBlocked(key, at(LOGIN_FAILURE_THRESHOLD * 1000))).toBe(false);

    await replicaA.onApplicationShutdown();
    await replicaB.onApplicationShutdown();
  });

  it("arms a TTL so an abandoned budget expires instead of living forever", async () => {
    const email = freshEmail("ttl");
    const limiter = replica();
    const key = limiter.key(email, "203.0.113.22");
    const redisKey = trackKey(key);

    await limiter.recordFailure(key, new Date());

    const ttlMs = await admin.pttl(redisKey);
    expect(ttlMs).toBeGreaterThan(0);
    // The TTL is the window: a key nobody touches dies with its last entry.
    expect(ttlMs).toBeLessThanOrEqual(LOGIN_FAILURE_WINDOW_MS);

    await limiter.onApplicationShutdown();
  });

  it("bounds a single key's history so a hostile loop cannot grow it", async () => {
    const email = freshEmail("cap");
    const limiter = replica();
    const key = limiter.key(email, "203.0.113.23");
    const redisKey = trackKey(key);

    const now = new Date();
    for (let attempt = 0; attempt < 150; attempt += 1) {
      await limiter.recordFailure(key, now);
    }

    const members = await admin.zcard(redisKey);
    expect(members).toBe(100);

    await limiter.onApplicationShutdown();
  });

  it("counts two failures in the same millisecond as two", async () => {
    const email = freshEmail("same-ms");
    const limiter = replica();
    const key = limiter.key(email, "203.0.113.24");
    const redisKey = trackKey(key);

    const instant = new Date();
    await limiter.recordFailure(key, instant);
    await limiter.recordFailure(key, instant);

    // A ZSET member is unique; two failures inside one millisecond must not
    // collapse into one entry and under-report the budget.
    expect(await admin.zcard(redisKey)).toBe(2);

    await limiter.onApplicationShutdown();
  });
});

describe("degradation when the shared store is unreachable (DEC-076)", () => {
  it("answers from the in-process window instead of failing the login", async () => {
    const limiter = new LoginRateLimiterService(DEAD_REDIS_URL);
    const key = limiter.key(freshEmail("dead-read"), "203.0.113.30");

    // Fail-open, and not `throw`: an unreachable cache must not become a
    // total-availability incident on every tenant's login.
    await expect(limiter.isBlocked(key, at(0))).resolves.toBe(false);

    await limiter.onApplicationShutdown();
  });

  it("still limits: the in-process window keeps the documented budget alive", async () => {
    const limiter = new LoginRateLimiterService(DEAD_REDIS_URL);
    const key = limiter.key(freshEmail("dead-limit"), "203.0.113.31");

    for (let attempt = 0; attempt < LOGIN_FAILURE_THRESHOLD; attempt += 1) {
      await limiter.recordFailure(key, at(attempt));
    }

    // The degradation is "the pre-revision behaviour, per replica", NOT "no
    // limit at all" — that distinction is the reason the local window is written
    // on every failure even while the shared store is healthy.
    expect(await limiter.isBlocked(key, at(LOGIN_FAILURE_THRESHOLD * 1000))).toBe(true);

    await limiter.onApplicationShutdown();
  });

  it("records a cleared budget locally too, so a reset during an outage still takes", async () => {
    const limiter = new LoginRateLimiterService(DEAD_REDIS_URL);
    const key = limiter.key(freshEmail("dead-reset"), "203.0.113.32");

    for (let attempt = 0; attempt < LOGIN_FAILURE_THRESHOLD; attempt += 1) {
      await limiter.recordFailure(key, at(attempt));
    }
    await limiter.reset(key);

    expect(await limiter.isBlocked(key, at(LOGIN_FAILURE_THRESHOLD * 1000))).toBe(false);

    await limiter.onApplicationShutdown();
  });
});

describe("the store's own diagnostic (DEC-076)", () => {
  it("logs at most one failure line per minute rather than one per request", async () => {
    const lines: string[] = [];
    const capturing = createApiLogger({
      level: "error",
      stream: { write: (line: string): void => void lines.push(line) },
    });

    // The store's logger is injectable precisely so this can be asserted: an
    // outage that logs per request turns into a log-volume outage.
    const store = new RedisRateLimitStore({ redisUrl: DEAD_REDIS_URL, logger: capturing });
    const key = `burst-${randomUUID()}`;

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(store.isBlocked(key, new Date())).rejects.toBeTruthy();
    }
    await store.close();

    expect(lines.length).toBe(1);

    const entry = JSON.parse(lines[0] ?? "{}") as Record<string, unknown>;
    expect(entry.msg).toContain("degrading to the in-process budget");
    // The limiter key is derived from the attempted email and a hashed IP, so it
    // must never reach a log line.
    expect(lines[0]).not.toContain(key);
  }, 20_000);
});
