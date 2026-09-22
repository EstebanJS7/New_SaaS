import { fileURLToPath } from "node:url";
import { defineConfig, mergeConfig } from "vitest/config";
import nodeConfig from "@newsaas/vitest-config/node";

export default mergeConfig(
  nodeConfig,
  defineConfig({
    resolve: {
      // Mirror the "@/*" path mapping from tsconfig.json for tests.
      alias: {
        "@": fileURLToPath(new URL("./src", import.meta.url)),
      },
    },
    test: {
      environment: "jsdom",
      globals: true,
      include: ["src/**/*.test.tsx", "src/**/*.test.ts"],
      setupFiles: ["./vitest.setup.ts"],
      // The default worker count is one process per available CPU, so the 40+
      // jsdom files oversubscribe the machine and each worker is descheduled
      // for long enough to starve `findBy*` polling (RTL's 1s async timeout
      // expires even though the awaited work is correct). Running files
      // sequentially removes that self-inflicted contention, the same lever
      // apps/api uses for its integration suites. It does not reduce timeouts
      // or hide slow async work: an await that never resolves still fails.
      fileParallelism: false,
    },
    esbuild: {
      jsx: "automatic",
      jsxImportSource: "react",
    },
  })
);
