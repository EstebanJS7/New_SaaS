import { defineConfig } from "vitest/config";
import swc from "unplugin-swc";

/**
 * Dedicated lane for the live-PostgreSQL suite ([[HARD-005]]).
 *
 * Standalone rather than `mergeConfig(baseConfig, …)` for the reason
 * `vitest.redis.config.ts` records: Vite CONCATENATES `include` arrays, so a merge
 * re-collects the whole default suite here.
 *
 * `LIVE_PG_REQUIRED=1` is what turns a missing `DATABASE_URL_TEST` into a FAILURE
 * instead of a skip. The default `pnpm test` keeps skipping the suite when no
 * PostgreSQL is configured — that is what keeps it usable without one — but this
 * lane exists specifically to measure, so it must not report green without
 * measuring. [[TD-021]] asked for exactly that contract.
 */
export default defineConfig({
  plugins: [
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
    include: ["test/live-pg-isolation.e2e-spec.ts"],
    fileParallelism: false,
    // Booting a real AppModule, provisioning a database and running 266 cases.
    hookTimeout: 180_000,
    testTimeout: 180_000,
    env: { LIVE_PG_REQUIRED: "1" },
  },
});
