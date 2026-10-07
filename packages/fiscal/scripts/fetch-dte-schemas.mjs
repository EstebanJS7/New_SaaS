#!/usr/bin/env node
/**
 * FISC-008 WU-B — prepares the official DNIT schemas for the schema-validation
 * suite.
 *
 * Usage:
 *
 *   node scripts/fetch-dte-schemas.mjs [targetDir] [--local <sourceDir>]
 *
 * Defaults to `DTE_XSD_DIR`, or `<os tmpdir>/newsaas-dte-xsd`. The artifacts are
 * copyrighted, are never committed and are never cached across runs.
 *
 * `--local` prepares the directory from a source directory that already holds
 * the seven files instead of fetching; it still asserts every artifact and still
 * rewrites the absolute includes, so a locally prepared directory is exactly as
 * hermetic as a fetched one.
 *
 * Run `pnpm --filter @newsaas/fiscal build` first: this script imports the built
 * package rather than duplicating the artifact list.
 */

import { prepareDteSchemas, defaultDteSchemaDirectory } from "../dist/testing.js";

const args = process.argv.slice(2);
const positional = [];
let localDir;
for (let index = 0; index < args.length; index += 1) {
  if (args[index] !== "--local") {
    positional.push(args[index]);
    continue;
  }
  localDir = args[index + 1];
  if (localDir === undefined) {
    console.error("--local requires a source directory");
    process.exit(2);
  }
  index += 1;
}
const targetDir = positional[0] ?? defaultDteSchemaDirectory();

try {
  const prepared = await prepareDteSchemas({
    targetDir,
    ...(localDir === undefined ? {} : { localDir }),
  });
  console.log(
    `prepared ${prepared.artifacts.length} official schemas in ${prepared.directory} (${localDir === undefined ? "fetched" : "local"})`
  );
  for (const artifact of prepared.artifacts) {
    console.log(`  ${artifact.fileName.padEnd(28)} ${String(artifact.bytes).padStart(7)} bytes`);
  }
  console.log(
    `  rewritten absolute includes: ${prepared.rewrittenIncludes.join(", ") || "(none)"}`
  );
} catch (error) {
  console.error(`schema preparation FAILED: ${error.message}`);
  process.exitCode = 1;
}
