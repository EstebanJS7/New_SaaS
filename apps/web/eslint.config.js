import { config as baseConfig } from "@newsaas/eslint-config";

/**
 * Web-specific ESLint flat config.
 *
 * Uses the shared @newsaas/eslint-config directly through the ESLint CLI.
 * Next.js-specific linting is intentionally deferred; the foundation only
 * needs standard TypeScript/React rules and no FlatCompat compatibility layer.
 */
export default [
  ...baseConfig,
  {
    ignores: ["**/next-env.d.ts", "**/.next/**", "**/out/**"],
  },
];
