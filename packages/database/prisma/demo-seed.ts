import { hash } from "argon2";
import { PrismaClient } from "../src/generated/index.js";
import { resolveDemoSeedGuard, seedDemoData } from "../src/demo-seed.js";

/**
 * Guarded demo tenant seed entrypoint (design D8 / task 6.2).
 *
 * Invoked via `pnpm --filter @newsaas/database exec tsx prisma/demo-seed.ts`
 * (the `.opencode/commands/demo-seed.ts` shim delegates here so the EPIC-00
 * CLI convention keeps a single stable path). All guard and data logic lives
 * in `src/demo-seed.ts`, which is typechecked/linted/unit-tested; this file
 * only wires real infrastructure (PrismaClient + argon2) behind the guard.
 *
 * OWASP-floor argon2id parameters match the API's credential service
 * (design D4); verification reads parameters from the hash string itself.
 * (argon2 is a devDependency of this package: only this ops entrypoint uses
 * it, and the demo seed refuses to run in production installs anyway.)
 */
const DEMO_OWNER_PASSWORD = "demo-owner-password";
const ARGON_MEMORY_KIB = 19_456;
const ARGON_TIME_COST = 2;
const ARGON_PARALLELISM = 1;

async function main(): Promise<void> {
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

  if (!process.env.DATABASE_URL) {
    console.error("Demo seed enabled but DATABASE_URL is not configured.");
    process.exitCode = 1;
    return;
  }

  const passwordHash = await hash(DEMO_OWNER_PASSWORD, {
    memoryCost: ARGON_MEMORY_KIB,
    timeCost: ARGON_TIME_COST,
    parallelism: ARGON_PARALLELISM,
  });

  const db = new PrismaClient();
  try {
    const result = await seedDemoData(db, { passwordHash });
    console.info(
      `Demo seed enabled — created/verified tenant ${result.tenantId} with owner ` +
        `${result.ownerProfileId} (${result.grantedFeatureCodes} explicit grants).`
    );
  } finally {
    await db.$disconnect();
  }
}

// Only execute when invoked directly; importing this file from tests or the
// CLI shim must not open database connections.
const invokedDirectly = (process.argv[1] ?? "")
  .replaceAll("\\", "/")
  .endsWith("/prisma/demo-seed.ts");
if (invokedDirectly) {
  await main().catch((error: unknown) => {
    console.error("demo seed failed:", error);
    process.exitCode = 1;
  });
}
