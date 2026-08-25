import { describe, it, expect } from "vitest";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");

function runDemoSeed(
  env: Record<string, string | undefined>
): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "pnpm",
      ["--filter", "@newsaas/api", "exec", "tsx", "../../.opencode/commands/demo-seed.ts"],
      {
        cwd: repoRoot,
        env: { ...process.env, ...env },
      }
    );

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on("error", reject);
    child.on("close", (exitCode) => {
      resolve({ exitCode, stdout, stderr });
    });
  });
}

// Each case spawns a real pnpm→tsx CLI chain (~2-5s even warm) while other
// workspace suites saturate the machine; the 5s vitest default flakes there.
describe("demo-seed CLI", () => {
  it(
    "exits 0 and logs disabled when ENABLE_DEMO_SEED is not set",
    { timeout: 60_000 },
    async () => {
      const { exitCode, stdout } = await runDemoSeed({
        ENABLE_DEMO_SEED: undefined,
        // Hermetic: never inherit a developer's real connection string.
        DATABASE_URL: undefined,
      });

      expect(exitCode).toBe(0);
      expect(stdout).toContain("Demo seed is disabled");
    }
  );

  it("exits 0 and logs disabled when ENABLE_DEMO_SEED is false", { timeout: 60_000 }, async () => {
    const { exitCode, stdout } = await runDemoSeed({
      ENABLE_DEMO_SEED: "false",
      DATABASE_URL: undefined,
    });

    expect(exitCode).toBe(0);
    expect(stdout).toContain("Demo seed is disabled");
  });

  it(
    "refuses production even with the flag enabled and creates nothing",
    { timeout: 60_000 },
    async () => {
      const { exitCode, stderr } = await runDemoSeed({
        ENABLE_DEMO_SEED: "true",
        NODE_ENV: "production",
      });

      expect(exitCode).not.toBe(0);
      expect(stderr).toContain("Demo seed refused");
      expect(stderr).toContain("never be enabled");
    }
  );

  it(
    "treats an unset NODE_ENV as production (fail-safe refusal)",
    { timeout: 60_000 },
    async () => {
      const { exitCode, stderr } = await runDemoSeed({
        ENABLE_DEMO_SEED: "true",
        NODE_ENV: undefined,
      });

      expect(exitCode).not.toBe(0);
      expect(stderr).toContain("Demo seed refused");
    }
  );

  it(
    "attempts real work only when explicitly enabled in a non-production env, failing safe without DATABASE_URL",
    { timeout: 60_000 },
    async () => {
      const { exitCode, stderr } = await runDemoSeed({
        ENABLE_DEMO_SEED: "true",
        NODE_ENV: "test",
        DATABASE_URL: undefined,
      });

      expect(exitCode).not.toBe(0);
      expect(stderr).toContain("DATABASE_URL");
    }
  );
});
