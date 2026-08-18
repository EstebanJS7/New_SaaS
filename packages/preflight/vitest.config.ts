import { defineConfig, mergeConfig } from "vitest/config";
import nodeConfig from "@newsaas/vitest-config/node";

export default mergeConfig(
  nodeConfig,
  defineConfig({
    test: {
      include: ["src/**/*.test.ts"],
    },
  })
);
