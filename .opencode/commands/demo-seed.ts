#!/usr/bin/env tsx
/**
 * Guarded demo-seed CLI (EPIC-00 convention, EPIC-01 data path).
 *
 * This command is intentionally disabled by default. It must be enabled by
 * setting ENABLE_DEMO_SEED=true and is REFUSED outside development/test
 * environments.
 *
 * Guard decisions resolve HERE through the single authority
 * (`@newsaas/database` src/demo-seed — imported by path because this shim
 * lives outside every workspace package's tsconfig scope); the expensive real
 * data path (PrismaClient + argon2) only spawns when the seed is genuinely
 * enabled, keeping the disabled/refused exits instant.
 */

import { spawn } from "node:child_process";
import { resolveDemoSeedGuard } from "../../packages/database/src/demo-seed.js";

function runSeedEntry(): void {
  const child = spawn(
    "pnpm",
    ["--filter", "@newsaas/database", "exec", "tsx", "prisma/demo-seed.ts"],
    {
      stdio: "inherit",
      env: process.env,
    }
  );

  child.on("error", (error: Error) => {
    console.error(`Demo seed failed to start: ${error.message}`);
    process.exitCode = 1;
  });
  // Propagate the delegate's exit code (failure=nonzero).
  child.on("close", (code: number | null) => {
    if (code !== 0) {
      process.exitCode = code ?? 1;
    }
  });
}

export function main(): void {
  const guard = resolveDemoSeedGuard(process.env);

  if (guard.mode === "disabled") {
    console.info(`Demo seed is disabled. ${guard.reason} Set ENABLE_DEMO_SEED=true to enable.`);
    return;
  }

  if (guard.mode === "refused") {
    console.error(`Demo seed refused: ${guard.reason}`);
    process.exitCode = 1;
    return;
  }

  // Enabled: fail safe before any infrastructure work when unconfigured.
  if (!process.env.DATABASE_URL) {
    console.error("Demo seed enabled but DATABASE_URL is not configured.");
    process.exitCode = 1;
    return;
  }

  runSeedEntry();
}

main();
