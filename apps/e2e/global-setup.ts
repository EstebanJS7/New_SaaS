import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

/**
 * Everything the lane needs that is not an HTTP server: a migrated database and the demo fixtures.
 *
 * The seed is the source of truth for every value `specs/fixtures.ts` signs in with, so it runs here
 * rather than being assumed: a lane that trusts a database it did not build is a lane that passes on a
 * developer's machine and fails in CI for reasons that are not about the product.
 */
export default function globalSetup(): void {
  const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

  if (process.env.DATABASE_URL === undefined) {
    throw new Error(
      "DATABASE_URL is not set. The lane needs a PostgreSQL it can migrate and seed; " +
        "`docker compose up -d` starts one on the default connection."
    );
  }

  run(repoRoot, ["--filter", "@newsaas/database", "db:deploy"], "migrate the database");
  run(repoRoot, ["--filter", "@newsaas/database", "db:seed"], "seed the reference data");
  run(
    repoRoot,
    ["--filter", "@newsaas/database", "exec", "tsx", "prisma/demo-seed.ts"],
    "seed the demo tenant",
    {
      ENABLE_DEMO_SEED: "true",
      NODE_ENV: "development",
    }
  );
}

function run(
  cwd: string,
  args: readonly string[],
  what: string,
  extraEnv: Record<string, string> = {}
): void {
  try {
    execFileSync("pnpm", args, {
      cwd,
      stdio: "pipe",
      env: { ...process.env, ...extraEnv },
    });
  } catch (error) {
    const failure = error as { stdout?: Buffer; stderr?: Buffer };
    // The output is surfaced, not swallowed: a seed that failed is the most common reason this lane
    // fails, and "command exited 1" alone sends the reader to the wrong place.
    throw new Error(
      `Failed to ${what}.\n${failure.stdout?.toString() ?? ""}${failure.stderr?.toString() ?? ""}`
    );
  }
}
