import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mainPath = path.resolve(__dirname, "../src/main.ts");

describe("API environment validation", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  // Spawning node + tsx loader + full bootstrap under a saturated machine
  // (all workspace suites in parallel) can exceed short defaults; when the
  // spawn is killed, stderr arrives empty and the real signal is lost.
  it(
    "exits non-zero and names the missing variable when DATABASE_URL is absent",
    { timeout: 180_000 },
    () => {
      delete process.env.DATABASE_URL;
      delete process.env.REDIS_URL;
      process.env.API_PORT = "3001";
      process.env.NEWSAAS_SKIP_ENV_LOAD = "true";

      const loaderPath = path.resolve(__dirname, "../register-loader.js");
      const result = spawnSync("node", ["--import", loaderPath, mainPath], {
        encoding: "utf8",
        env: process.env,
        timeout: 120_000,
      });

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("DATABASE_URL");
    }
  );
});
