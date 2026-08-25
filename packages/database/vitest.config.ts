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
      include: ["src/**/*.test.ts"],
    },
  })
);
