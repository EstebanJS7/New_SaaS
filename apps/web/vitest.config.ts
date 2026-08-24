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
    },
    esbuild: {
      jsx: "automatic",
      jsxImportSource: "react",
    },
  })
);
