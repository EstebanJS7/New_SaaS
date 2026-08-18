import { defineConfig, mergeConfig } from "vitest/config";
import nodeConfig from "./vitest.node.js";

/**
 * Shared Vitest configuration with UI coverage reporter enabled.
 */
export default mergeConfig(
  nodeConfig,
  defineConfig({
    test: {
      coverage: {
        reporter: ["text", "json", "html", "lcov"],
      },
    },
  })
);
