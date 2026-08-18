import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Redis } from "ioredis";
import { RedisHealthService } from "./redis-health.service.js";

const ping = vi.fn().mockResolvedValue("PONG");
const quit = vi.fn().mockResolvedValue(undefined);

vi.mock("ioredis", () => ({
  Redis: vi.fn().mockImplementation(() => ({
    status: "ready",
    ping,
    quit,
    once: vi.fn().mockImplementation(function (this: { emit: () => void }, event: string, handler: () => void) {
      if (event === "ready") {
        handler();
      }
      return this;
    }),
  })),
}));

describe("RedisHealthService", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("throws when REDIS_URL is missing during module init", () => {
    delete process.env.REDIS_URL;
    const service = new RedisHealthService();
    expect(() => service.onModuleInit()).toThrow("REDIS_URL");
  });

  it("opens a persistent Redis client with REDIS_URL", () => {
    process.env.REDIS_URL = "redis://localhost:6379";
    const service = new RedisHealthService();
    service.onModuleInit();
    expect(vi.mocked(Redis)).toHaveBeenCalledWith("redis://localhost:6379", {
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      connectTimeout: 10_000,
    });
  });

  it("resolves when Redis responds PONG", async () => {
    process.env.REDIS_URL = "redis://localhost:6379";
    const service = new RedisHealthService();
    service.onModuleInit();
    await expect(service.ping()).resolves.toBeUndefined();
    expect(ping).toHaveBeenCalledTimes(1);
  });

  it("throws when Redis responds with an unexpected value", async () => {
    ping.mockResolvedValueOnce("unexpected");
    process.env.REDIS_URL = "redis://localhost:6379";
    const service = new RedisHealthService();
    service.onModuleInit();
    await expect(service.ping()).rejects.toThrow("unexpected response");
  });

  it("quits the client on module destroy", async () => {
    process.env.REDIS_URL = "redis://localhost:6379";
    const service = new RedisHealthService();
    service.onModuleInit();
    await service.onModuleDestroy();
    expect(quit).toHaveBeenCalledTimes(1);
  });
});
