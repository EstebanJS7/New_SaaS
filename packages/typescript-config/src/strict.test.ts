import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe("strict TypeScript config", () => {
  it("rejects implicit any", () => {
    const project = path.resolve(__dirname, "../__fixtures__/tsconfig.fixture.json");
    const result = spawnSync("npx", ["tsc", "--project", project], {
      encoding: "utf8",
      cwd: path.resolve(__dirname, ".."),
    });

    expect(result.status).not.toBe(0);
    expect(result.stdout + result.stderr).toMatch(/implicitly has an .*any/);
  });
});
