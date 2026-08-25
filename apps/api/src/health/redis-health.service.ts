import { Injectable, OnApplicationShutdown } from "@nestjs/common";
import { Redis } from "ioredis";
import { withTimeout } from "../common/utils/with-timeout.js";

/**
 * Health-check-only Redis client.
 *
 * Owns a lazily-created ioredis connection used exclusively for readiness
 * pings in this slice; the session store will reuse or replace this seam
 * when auth lands (EPIC-01 S3). The URL is resolved from the validated
 * REDIS_URL at bootstrap; direct process.env access here keeps the service
 * constructible in unit tests that never parse the full env schema.
 */
@Injectable()
export class RedisHealthService implements OnApplicationShutdown {
  private client: Redis | null = null;
  private connectionAttempt: Promise<void> | null = null;
  private readonly url: string;

  constructor(url?: string) {
    this.url = url ?? process.env.REDIS_URL ?? "redis://127.0.0.1:6379";
  }

  /**
   * Returns true when Redis answers PING within {@link timeoutMs}.
   * Never throws: every failure mode degrades to `false`.
   *
   * The whole flow — connection attempt included — runs under a single
   * deadline so a half-open socket cannot stall readiness past the budget.
   */
  async ping(timeoutMs: number): Promise<boolean> {
    try {
      return await withTimeout(
        async () => {
          const client = this.getClient();
          await this.ensureConnected(client);
          await client.ping();
          return true;
        },
        timeoutMs,
        "redis"
      );
    } catch {
      return false;
    }
  }

  /** Force-closes the socket on application shutdown; never throws. */
  onApplicationShutdown(_signal?: string): void {
    this.client?.disconnect();
    this.client = null;
    this.connectionAttempt = null;
  }

  private getClient(): Redis {
    if (!this.client) {
      const client = new Redis(this.url, {
        lazyConnect: true,
        // Commands issued before the socket is ready must fail fast instead
        // of queueing behind an outage.
        enableOfflineQueue: false,
        maxRetriesPerRequest: 1,
        connectTimeout: 10_000,
        retryStrategy: (times: number) => Math.min(times * 500, 5_000),
        connectionName: "api-health",
      });
      // ioredis emits 'error' on outages; without a listener Node treats it
      // as an unhandled EventEmitter error and would crash the API process.
      client.on("error", () => undefined);
      this.client = client;
    }
    return this.client;
  }

  private ensureConnected(client: Redis): Promise<void> {
    const status = client.status;
    if (status !== "wait" && status !== "end") {
      return Promise.resolve();
    }
    const pending = this.connectionAttempt ?? client.connect().then(() => undefined);
    this.connectionAttempt = pending;
    // Reset the dedupe slot when a connect attempt fails so later pings can
    // retry; the rejection itself still propagates to the awaiting ping().
    void pending.catch(() => {
      if (this.connectionAttempt === pending) {
        this.connectionAttempt = null;
      }
    });
    return pending;
  }
}
