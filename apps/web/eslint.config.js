import { config as baseConfig, disableTypeChecked } from "@newsaas/eslint-config";

/**
 * Web-specific ESLint flat config.
 *
 * Uses the shared @newsaas/eslint-config directly through the ESLint CLI.
 * Next.js-specific linting is intentionally deferred; the foundation only
 * needs standard TypeScript/React rules and no FlatCompat compatibility layer.
 *
 * Build helper scripts are plain ESM and are not part of the TypeScript
 * project; lint them with syntactic TypeScript rules only (no type-checked
 * project resolution).
 */
export default [
  ...baseConfig,
  {
    files: ["scripts/**/*.mjs"],
    ...disableTypeChecked,
  },
  {
    ignores: ["**/next-env.d.ts", "**/.next/**", "**/out/**"],
  },
];
