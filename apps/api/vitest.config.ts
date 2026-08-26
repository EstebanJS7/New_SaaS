import { defineConfig, mergeConfig } from "vitest/config";
import swc from "unplugin-swc";
import nodeConfig from "@newsaas/vitest-config/node";

/**
 * Local override: SWC transform so Vitest emits decorator metadata
 * (`design:paramtypes`) exactly like the production tsc build. esbuild —
 * vitest's default — silently skips it, which makes NestJS DI inject
 * `undefined` instead of failing loudly.
 */
export default mergeConfig(
  nodeConfig,
  defineConfig({
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
      include: ["src/**/*.test.ts", "test/**/*.e2e-spec.ts"],
      // Booting a real AppModule (DI graph + SWC transform + Fastify listen)
      // inside beforeAll is wall-clock heavy and runs while every other
      // workspace suite saturates the machine — the 10s hook default flakes
      // under full-repo parallel runs (EPIC-01 strict-config precedent).
      hookTimeout: 60_000,
      // Full-app integration suites contend heavily on shared resources;
      // parallel workers saturate IPC/IO until tinypool drops `onTaskUpdate`
      // RPCs (vitest exits 1 despite all tests passing). Files run
      // sequentially: same green result, deterministic exit code.
      fileParallelism: false,
    },
  })
);
