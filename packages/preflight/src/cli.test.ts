import { describe, it, expect } from "vitest";
import { parsePreflightEnv } from "./cli.js";

describe("parsePreflightEnv", () => {
  it("uses defaults for missing variables", () => {
    const env = parsePreflightEnv({});

    expect(env).toEqual({
      PREFLIGHT_HOST: "127.0.0.1",
      POSTGRES_PORT: 5432,
      REDIS_PORT: 6379,
    });
  });

  it("parses valid custom values", () => {
    const env = parsePreflightEnv({
      PREFLIGHT_HOST: "postgres.internal",
      POSTGRES_PORT: "5433",
      REDIS_PORT: "6380",
    });

    expect(env).toEqual({
      PREFLIGHT_HOST: "postgres.internal",
      POSTGRES_PORT: 5433,
      REDIS_PORT: 6380,
    });
  });

  it("rejects an out-of-range port", () => {
    expect(() =>
      parsePreflightEnv({
        POSTGRES_PORT: "70000",
      })
    ).toThrow();
  });

  it("rejects a non-numeric port", () => {
    expect(() =>
      parsePreflightEnv({
        REDIS_PORT: "not-a-port",
      })
    ).toThrow();
  });
});
