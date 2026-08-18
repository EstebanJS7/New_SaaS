import { describe, it, expect, vi } from "vitest";
import { bootstrap } from "./main.js";

describe("Worker bootstrap", () => {
  it("throws when a required environment variable is missing", async () => {
    const originalRedisUrl = process.env.REDIS_URL;
    delete process.env.REDIS_URL;

    const redisHealth = { ping: vi.fn().mockResolvedValue(undefined) };
    await expect(bootstrap({ redisHealth })).rejects.toThrow("REDIS_URL");

    process.env.REDIS_URL = originalRedisUrl;
  });

  it("starts successfully when Redis ping succeeds", async () => {
    process.env.REDIS_URL ??= "redis://localhost:6379";
    const redisHealth = { ping: vi.fn().mockResolvedValue(undefined) };

    const handle = await bootstrap({ redisHealth });

    expect(redisHealth.ping).toHaveBeenCalledTimes(1);
    await expect(handle.shutdown()).resolves.toBeUndefined();
  });

  it("fails fast when Redis ping fails", async () => {
    process.env.REDIS_URL ??= "redis://localhost:6379";
    const redisHealth = { ping: vi.fn().mockRejectedValue(new Error("Redis unreachable")) };

    await expect(bootstrap({ redisHealth })).rejects.toThrow("Redis unreachable");
    expect(redisHealth.ping).toHaveBeenCalledTimes(1);
  });
});
