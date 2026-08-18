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

describe("demo-seed CLI", () => {
  it("exits 0 and logs disabled when ENABLE_DEMO_SEED is not set", async () => {
    const { exitCode, stdout } = await runDemoSeed({ ENABLE_DEMO_SEED: undefined });

    expect(exitCode).toBe(0);
    expect(stdout).toContain("Demo seed is disabled");
  });

  it("exits 0 and logs disabled when ENABLE_DEMO_SEED is false", async () => {
    const { exitCode, stdout } = await runDemoSeed({ ENABLE_DEMO_SEED: "false" });

    expect(exitCode).toBe(0);
    expect(stdout).toContain("Demo seed is disabled");
  });

  it("exits 0 and logs enabled when ENABLE_DEMO_SEED is true", async () => {
    const { exitCode, stdout } = await runDemoSeed({ ENABLE_DEMO_SEED: "true" });

    expect(exitCode).toBe(0);
    expect(stdout).toContain("Demo seed enabled");
  });
});
