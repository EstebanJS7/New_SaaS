#!/usr/bin/env node
import { existsSync } from "node:fs";
import { join } from "node:path";

/**
 * Defensive post-build verification for the Next.js web output.
 *
 * Next.js 15 (App Router) still emits a Pages Router fallback manifest at
 * `.next/server/pages-manifest.json` together with the `_error.js`, `_app.js`,
 * `_document.js` and `404.html` chunks it references. Under fresh/cold-cache
 * builds this manifest can be missing when static generation is interrupted or
 * when the build output is partially restored from an incomplete cache. This
 * script fails loudly instead of letting the broken build pass downstream.
 */

const distDir = process.env.NEXT_DIST_DIR || ".next";
const root = process.cwd();

const required = [
  join(distDir, "server", "pages-manifest.json"),
  join(distDir, "server", "pages", "_app.js"),
  join(distDir, "server", "pages", "_error.js"),
  join(distDir, "server", "pages", "_document.js"),
  join(distDir, "app-build-manifest.json"),
  join(distDir, "build-manifest.json"),
  join(distDir, "routes-manifest.json"),
];

let failed = false;
for (const file of required) {
  const absolute = join(root, file);
  if (!existsSync(absolute)) {
    console.error(`MISSING REQUIRED BUILD OUTPUT: ${file}`);
    failed = true;
  }
}

// The 404 handler is emitted as the Pages Router fallback `404.html` when the
// not-found route is statically generated, or as the App Router `_not-found`
// route when the root layout is dynamic (e.g. it reads request data for
// tenant-aware pre-paint appearance). Exactly one of the two must exist.
const notFoundOutputs = [
  join(distDir, "server", "pages", "404.html"),
  join(distDir, "server", "app", "_not-found", "page.js"),
];
if (!notFoundOutputs.some((file) => existsSync(join(root, file)))) {
  console.error(`MISSING REQUIRED BUILD OUTPUT: one of ${notFoundOutputs.join(" | ")}`);
  failed = true;
}

if (failed) {
  console.error(
    "Build output verification failed. The Next.js build did not produce all required artifacts."
  );
  process.exit(1);
}

console.info("Build output verification passed.");
