import { describe, it, expect } from "vitest";
import { preflight, formatPreflightResult } from "./index.js";

describe("preflight", () => {
  it("reports reachable services on open ports", async () => {
    // Use a known reachable DNS resolver address and port.
    const result = await preflight({
      postgresHost: "1.1.1.1",
      postgresPort: 53,
      redisHost: "1.1.1.1",
      redisPort: 53,
      timeoutMs: 5_000,
    });

    expect(result.postgres.reachable).toBe(true);
    expect(result.redis.reachable).toBe(true);
  });

  it("names the failing service on an unreachable port", async () => {
    const result = await preflight({
      postgresHost: "127.0.0.1",
      postgresPort: 1,
      redisHost: "127.0.0.1",
      redisPort: 1,
      timeoutMs: 500,
    });

    expect(result.postgres.reachable).toBe(false);
    expect(result.redis.reachable).toBe(false);
    const formatted = formatPreflightResult(result);
    expect(formatted).toContain("PostgreSQL: unreachable");
    expect(formatted).toContain("Redis: unreachable");
  });
});
