import { config } from "@newsaas/eslint-config";

/**
 * Database package lint, with the scripts directory IN the type-aware scope
 * ([[TD-015]] / [[HARD-005]]).
 *
 * `typecheck` and `lint` used to cover `src/**` only, while CI executed
 * `scripts/live-migration-verify.ts` and `scripts/ci-seed-counts.mjs` in the
 * `Database migrations` job. A type error in a script therefore surfaced as a red
 * CI job at runtime rather than in `pnpm typecheck`.
 *
 * Two projects, because the scripts cannot live in `tsconfig.json`: it pins
 * `rootDir: ./src`, and a script outside it fails with TS6059 ("is not under
 * rootDir"). Changing that rootDir would move every emitted path and break
 * `main: ./dist/index.js` for every consumer of this package.
 */
const configWithScripts = config.map((entry) => {
  const parserOptions = entry.languageOptions?.parserOptions;
  // `project: null` is the shared config's deliberate opt-OUT for plain JavaScript
  // (`.mjs` scripts are in no tsconfig). Rewriting it would reintroduce the parsing
  // error it exists to prevent.
  if (
    parserOptions === undefined ||
    parserOptions.project === undefined ||
    parserOptions.project === null
  ) {
    return entry;
  }
  return {
    ...entry,
    languageOptions: {
      ...entry.languageOptions,
      parserOptions: {
        ...parserOptions,
        // The scripts project has no rootDir constraint, so `scripts/**` typechecks
        // without touching the build's emitted layout.
        project: ["./tsconfig.json", "./tsconfig.scripts.json"],
      },
    },
  };
});

/** @type {import('eslint').Linter.Config[]} */
export default configWithScripts;
