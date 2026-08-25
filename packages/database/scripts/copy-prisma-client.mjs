// Copies the generated Prisma Client runtime into dist/ so that the compiled
// package is self-contained: src imports `./generated/client/index.js`, which
// tsc does not emit (plain .js input). Without this copy, consumers resolving
// `@newsaas/database` from dist would fail at runtime.
import { cpSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(packageRoot, "src", "generated");
const target = join(packageRoot, "dist", "generated");

if (!existsSync(source)) {
  console.error("copy-prisma-client: src/generated not found. Run `prisma generate` first.");
  process.exit(1);
}

cpSync(source, target, { recursive: true });
