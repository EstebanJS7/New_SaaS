import { PrismaClient } from "../src/generated/index.js";
import { seedReferenceData } from "../src/reference-seed.js";

/**
 * Reference seed entrypoint (design D8). Run via `pnpm --filter @newsaas/database db:seed`.
 *
 * Upserts reference data by stable natural keys, so re-running is a no-op.
 * This seed NEVER creates tenants, users or grants — demo data lives behind
 * the guarded ENABLE_DEMO_SEED flow (EPIC-00 pattern) and stays separate.
 */
async function main(): Promise<void> {
  const db = new PrismaClient();
  try {
    await seedReferenceData(db);
  } finally {
    await db.$disconnect();
  }
}

// Only execute when invoked directly (tsx prisma/seed.ts); importing this file
// from tests must not open database connections.
const invokedDirectly = (process.argv[1] ?? "").replaceAll("\\", "/").endsWith("/prisma/seed.ts");
if (invokedDirectly) {
  await main().catch((error: unknown) => {
    console.error("reference seed failed:", error);
    process.exitCode = 1;
  });
}
