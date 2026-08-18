import { defineConfig, mergeConfig } from "vitest/config";
import nodeConfig from "@newsaas/vitest-config/node";

export default mergeConfig(
  nodeConfig,
  defineConfig({
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
