import { randomUUID } from "node:crypto";
import { Redis } from "ioredis";
import { createApiLogger, type ApiLogger } from "../common/http/api-logger.factory.js";
import {
  LOGIN_FAILURE_THRESHOLD,
  LOGIN_FAILURE_WINDOW_MS,
  MAX_RECORDED_FAILURES,
  type RateLimitStore,
} from "./rate-limit-store.port.js";

/** Arbitrary but stable namespace, so the keys are recognizable in `redis-cli`. */
const KEY_PREFIX = "auth:login-failure-budget:";

/**
 * ioredis statuses that mean "this store cannot answer right now".
 *
 * `connecting`, `connect` and `ready` are excluded on purpose: they are either
 * healthy or too early to call unhealthy.
 */
const DOWN_STATUSES = new Set<string>(["end", "close", "reconnecting"]);

/**
 * At most one failure diagnostic per minute.
 *
 * The whole point of [[DEC-076]]'s fail-open rule is that an unreachable Redis
 * must not take authentication down. An unthrottled `error` line per request
 * would turn that outage into a log-volume outage — the same failure wearing a
 * different hat.
 */
const FAILURE_LOG_INTERVAL_MS = 60_000;

/**
 * READ: prune, then count, in ONE server-side evaluation.
 *
 * `ZREMRANGEBYSCORE key -inf windowStart` removes scores `<= windowStart`, which
 * matches the in-process store's `timestamp > windowStart` exactly. Counting and
 * pruning in one script means two replicas can never both read a count that
 * disagrees about what has expired.
 */
const IS_BLOCKED_SCRIPT = `
local windowStart = tonumber(ARGV[1]) - tonumber(ARGV[2])
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', windowStart)
local count = redis.call('ZCARD', KEYS[1])
if count == 0 then
  redis.call('DEL', KEYS[1])
else
  redis.call('PEXPIRE', KEYS[1], ARGV[2])
end
return count
`;

/**
 * WRITE: prune, enforce the per-key ceiling, record, and re-arm the TTL, in ONE
 * server-side evaluation, returning the post-record count.
 *
 * The ceiling is applied BEFORE the insert so a key holds at most
 * `MAX_RECORDED_FAILURES` members, mirroring the in-process store's behaviour
 * where an already-full history silently drops the new timestamp.
 */
const RECORD_FAILURE_SCRIPT = `
local windowStart = tonumber(ARGV[1]) - tonumber(ARGV[2])
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', windowStart)
local count = redis.call('ZCARD', KEYS[1])
if count >= tonumber(ARGV[4]) then
  redis.call('ZPOPMIN', KEYS[1], 1)
end
redis.call('ZADD', KEYS[1], ARGV[1], ARGV[3])
redis.call('PEXPIRE', KEYS[1], ARGV[2])
return redis.call('ZCARD', KEYS[1])
`;

export interface RedisRateLimitStoreOptions {
  readonly redisUrl: string;
  /** Override for tests; defaults to the API's structured logger on stderr. */
  readonly logger?: ApiLogger;
}

/**
 * Shared failure budget in Redis ([[TD-005]], [[DEC-076]]).
 *
 * This is the whole point of the revision: the budget stops being one process'
 * memory. Two API replicas that both point at this Redis enforce ONE budget, so
 * "≥10 verified failures per 15 minutes" is the effective threshold rather than
 * a number that multiplies by replica count.
 *
 * The store does NOT decide what happens when Redis is unavailable — it throws,
 * and `LoginRateLimiterService` degrades to the in-process window per
 * [[DEC-076]]. The store owns only two things the policy layer cannot: the
 * connection (and its teardown) and the failure diagnostic.
 *
 * Bounded memory on this side is structural rather than approximate:
 * - every member is pruned by score, so a key cannot accumulate history past the
 *   window;
 * - the per-key member count is capped inside the write script;
 * - `PEXPIRE` is re-armed on every touch, so an abandoned key — one whose tenant
 *   simply stopped failing logins — expires rather than living forever. This is
 *   the bound the in-process store needs `MAX_TRACKED_KEYS` to approximate.
 */
export class RedisRateLimitStore implements RateLimitStore {
  private readonly client: Redis;
  private readonly logger: ApiLogger;
  private lastFailureLogAtMs = 0;

  public constructor(options: RedisRateLimitStoreOptions) {
    this.logger = options.logger ?? createApiLogger();
    this.client = new Redis(options.redisUrl, {
      // A login must never wait on a Redis that is up but slow. This ceiling is
      // deliberately tighter than the readiness probe's 1500ms: readiness may
      // spend a budget to answer accurately, while the credential path must fall
      // back fast, because a cache check is worth less than the latency it adds.
      commandTimeout: 500,
      maxRetriesPerRequest: 1,
      // Own the retry policy: a reconnect storm must not stack unbounded work.
      retryStrategy: (attempt: number) => Math.min(attempt * 200, 2_000),
    });

    // ioredis re-emits connection failures as an EventEmitter `error`. Without a
    // listener Node treats an unhandled `error` event as fatal, so an outage
    // would crash the API — the exact opposite of the fail-open decision.
    this.client.on("error", (error: unknown) => {
      this.reportFailure(error);
    });
  }

  public async isBlocked(key: string, now: Date): Promise<boolean> {
    const count = await this.evaluateCount(IS_BLOCKED_SCRIPT, key, [
      String(now.getTime()),
      String(LOGIN_FAILURE_WINDOW_MS),
    ]);
    return count >= LOGIN_FAILURE_THRESHOLD;
  }

  public async recordFailure(key: string, now: Date): Promise<void> {
    // The member must be unique: two failures inside the same millisecond would
    // otherwise collapse into one ZSET entry and the count would under-report.
    await this.evaluateCount(RECORD_FAILURE_SCRIPT, key, [
      String(now.getTime()),
      String(LOGIN_FAILURE_WINDOW_MS),
      `${now.getTime()}:${randomUUID()}`,
      String(MAX_RECORDED_FAILURES),
    ]);
  }

  public async reset(key: string): Promise<void> {
    await this.run((redisKey) => this.client.del(redisKey), key);
  }

  /** Releases the owned connection. Called from the service's shutdown hook. */
  public async close(): Promise<void> {
    try {
      await this.client.quit();
    } catch {
      this.client.disconnect();
    }
  }

  private async evaluateCount(
    script: string,
    key: string,
    args: readonly string[]
  ): Promise<number> {
    return this.run(async (redisKey) => {
      const result = await this.client.eval(script, 1, redisKey, ...args);
      return typeof result === "number" ? result : Number(result);
    }, key);
  }

  /**
   * Runs one operation, failing FAST when the connection is DEFINITIVELY down.
   *
   * Without the short-circuit a caller would pay `commandTimeout` on every
   * request during a Redis outage — ten failed logins would spend five seconds of
   * the credential path before the in-process budget answered. The degradation is
   * supposed to be invisible to a user, and a latency spike per attempt is not
   * invisible.
   *
   * The distinction matters: "connecting" and "connect" are TRANSIENT, not down.
   * A freshly constructed store reports `connecting` for a few milliseconds
   * before its first command could possibly succeed, and treating that as an
   * outage would push the first requests of every process onto the local budget
   * for no reason. Only `end`, `close` and `reconnecting` mean the store cannot
   * answer.
   *
   * Reporting happens here, once, for both the down and the errored case.
   */
  private async run<T>(operation: (redisKey: string) => Promise<T>, key: string): Promise<T> {
    if (DOWN_STATUSES.has(this.client.status)) {
      const error = new Error(
        `shared rate-limit store is not reachable (ioredis status: ${this.client.status})`
      );
      this.reportFailure(error);
      throw error;
    }
    try {
      return await operation(this.redisKey(key));
    } catch (error: unknown) {
      // Throwing is the contract: the caller owns the degradation policy.
      this.reportFailure(error);
      throw error;
    }
  }

  private redisKey(key: string): string {
    return `${KEY_PREFIX}${key}`;
  }

  /**
   * One diagnostic per {@link FAILURE_LOG_INTERVAL_MS}.
   *
   * The message is a fixed string and the payload is the error's own curated
   * shape; the limiter key is NEVER logged, because it is derived from the
   * attempted email address and the hashed client IP (INTERNAL-classified
   * security-forensics data, per `docs/03-architecture/DATA-CLASSIFICATION.md`).
   */
  private reportFailure(error: unknown): void {
    const nowMs = Date.now();
    if (nowMs - this.lastFailureLogAtMs < FAILURE_LOG_INTERVAL_MS) {
      return;
    }
    this.lastFailureLogAtMs = nowMs;
    this.logger.error(
      {
        failure: error instanceof Error ? { type: error.name, message: error.message } : undefined,
      },
      "Shared login rate-limit store unavailable; degrading to the in-process budget"
    );
  }
}
