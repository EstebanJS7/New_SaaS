#!/usr/bin/env tsx
/**
 * Guarded demo-seed CLI.
 *
 * This command is intentionally disabled by default. It must be enabled by
 * setting ENABLE_DEMO_SEED=true. When disabled it exits cleanly without making
 * any changes.
 */

function main(): void {
  const enabled = process.env.ENABLE_DEMO_SEED === "true";

  if (!enabled) {
    console.info("Demo seed is disabled. Set ENABLE_DEMO_SEED=true to enable.");
    process.exit(0);
  }

  console.info("Demo seed enabled — no seed logic implemented in EPIC-00.");
  process.exit(0);
}

main();
