import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe("strict TypeScript config", () => {
  // Spawning `npx tsc` is wall-clock heavy (npx resolution + compile) and
  // runs while every other workspace suite saturates the machine — the 5s
  // default flakes under full-repo parallel runs.
  it("rejects implicit any", { timeout: 60_000 }, () => {
    const project = path.resolve(__dirname, "../__fixtures__/tsconfig.fixture.json");
    const result = spawnSync("npx", ["tsc", "--project", project], {
      encoding: "utf8",
      cwd: path.resolve(__dirname, ".."),
    });

    expect(result.status).not.toBe(0);
    expect(result.stdout + result.stderr).toMatch(/implicitly has an .*any/);
  });
});
