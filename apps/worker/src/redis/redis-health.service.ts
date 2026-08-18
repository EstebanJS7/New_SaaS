import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Redis } from "ioredis";

@Injectable()
export class RedisHealthService implements OnModuleInit, OnModuleDestroy {
  private client: Redis | null = null;

  /**
   * Opens a persistent Redis connection that keeps the worker process alive.
   */
  onModuleInit(): void {
    const url = process.env.REDIS_URL;
    if (!url) {
      throw new Error("REDIS_URL is not set");
    }

    this.client = new Redis(url, {
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      connectTimeout: 10_000,
    });
  }

  /**
   * Verifies Redis connectivity by issuing a PING command.
   *
   * Waits for the persistent connection to become ready, then throws if Redis
   * does not respond so bootstrap can fail fast.
   */
  async ping(): Promise<void> {
    if (!this.client) {
      throw new Error("Redis client not initialized");
    }

    if (this.client.status !== "ready") {
      await new Promise<void>((resolve, reject) => {
        const onReady = (): void => {
          cleanup();
          resolve();
        };
        const onError = (error: Error): void => {
          cleanup();
          reject(error);
        };
        const onTimeout = (): void => {
          cleanup();
          reject(new Error("Redis connection timed out after 10s"));
        };

        const timer = setTimeout(onTimeout, 10_000);
        const cleanup = (): void => {
          clearTimeout(timer);
          this.client!.off("ready", onReady);
          this.client!.off("error", onError);
        };

        this.client!.once("ready", onReady);
        this.client!.once("error", onError);
      });
    }

    const response = await this.client.ping();
    if (response !== "PONG") {
      throw new Error(`Redis ping returned unexpected response: ${String(response)}`);
    }
  }

  /**
   * Closes the persistent Redis connection during graceful shutdown.
   */
  async onModuleDestroy(): Promise<void> {
    if (this.client) {
      await this.client.quit();
      this.client = null;
    }
  }
}
