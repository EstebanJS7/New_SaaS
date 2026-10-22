import { defineConfig } from "vitest/config";
import swc from "unplugin-swc";

/**
 * Dedicated lane for the suites that need a REAL Redis ([[HARD-002]]).
 *
 * It is a standalone config rather than another `*.e2e-spec.ts` in the default
 * include, for two reasons that point in opposite directions and both matter:
 *
 * - the default `pnpm test` must not require a Redis a contributor may not have
 *   running, so these files are NOT collected there;
 * - the dedicated lane must not skip quietly when the variable is missing, so the
 *   spec itself throws naming `REDIS_URL_TEST` instead of reporting green.
 *
 * The suffix `*.redis-spec.ts` is what keeps the two globs disjoint.
 *
 * This is deliberately NOT built with `mergeConfig(baseConfig, …)`: Vite
 * CONCATENATES `include` arrays, so merging would have re-collected the entire
 * default suite here — which is exactly what the first version did.
 */
export default defineConfig({
  plugins: [
    // `LoginRateLimiterService` carries `@Injectable()`; SWC keeps the decorator
    // transform identical to the production tsc build.
    swc.vite({
      module: { type: "es6" },
      jsc: {
        target: "es2022",
        parser: { syntax: "typescript", decorators: true },
        transform: { legacyDecorator: true, decoratorMetadata: true },
      },
    }),
  ],
  test: {
    globals: true,
    environment: "node",
    include: ["test/**/*.redis-spec.ts"],
    // These suites open real sockets and assert on their timing; running files in
    // parallel would measure the machine rather than the store.
    fileParallelism: false,
    // Generous, because a "dead Redis" case exercises real connection failures.
    testTimeout: 30_000,
  },
});
