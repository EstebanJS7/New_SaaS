// Copies the generated Prisma Client runtime into dist/ so that the compiled
// package is self-contained: src imports `./generated/client/index.js`, which
// tsc does not emit (plain .js input). Without this copy, consumers resolving
// `@newsaas/database` from dist would fail at runtime.
import { cpSync, existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(packageRoot, "src", "generated");
const target = join(packageRoot, "dist", "generated");

if (!existsSync(source)) {
  console.error("copy-prisma-client: src/generated not found. Run `prisma generate` first.");
  process.exit(1);
}

cpSync(source, target, {
  recursive: true,
  // Windows locks a loaded native engine. Do not unlink an unchanged DLL while
  // another local API/worker uses it. A genuinely changed engine still fails,
  // requiring those processes to stop before the upgrade can be copied.
  filter: (from, to) =>
    !existsSync(to) || statSync(from).isDirectory() || !readFileSync(from).equals(readFileSync(to)),
});
