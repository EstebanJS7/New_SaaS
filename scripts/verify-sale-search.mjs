import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "../packages/database/src/generated/index.js";

// A disposable DATABASE, never the configured development database.
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
const root = fileURLToPath(new URL("../", import.meta.url));
const name = `newsaas_sale_search_test_${randomUUID().replaceAll("-", "")}`;
if (!/^newsaas_sale_search_test_[a-f0-9]{32}$/.test(name))
  throw new Error("Invalid test database name.");
const target = new URL(process.env.DATABASE_URL);
target.pathname = `/${name}`;
const env = { ...process.env, DATABASE_URL: target.href, SALE_SEARCH_TEST_URL: target.href };
const admin = new PrismaClient();
const databaseRequire = createRequire(
  new URL("../packages/database/package.json", import.meta.url)
);
const apiRequire = createRequire(new URL("../apps/api/package.json", import.meta.url));
let created = false;
let result = 1;
try {
  await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
  created = true;
  const migration = spawnSync(
    process.execPath,
    [
      databaseRequire.resolve("prisma/build/index.js"),
      "migrate",
      "deploy",
      "--schema",
      `${root}packages/database/prisma/schema.prisma`,
    ],
    { env, cwd: root, encoding: "utf8" }
  );
  if (migration.status !== 0) throw new Error(`Test migration failed: ${migration.stderr}`);
  const tests = spawnSync(
    process.execPath,
    [
      apiRequire.resolve("vitest/vitest.mjs"),
      "run",
      "--config",
      "vitest.config.ts",
      "src/sales/sale-search.pg.test.ts",
    ],
    { env, cwd: `${root}apps/api`, stdio: "inherit" }
  );
  result = tests.status ?? 1;
} finally {
  if (created) await admin.$executeRawUnsafe(`DROP DATABASE "${name}" WITH (FORCE)`);
  await admin.$disconnect();
}
process.exitCode = result;
