import { defineConfig, devices } from "@playwright/test";
import { loadRepoEnv } from "./load-env.js";
import { WEB_BASE_URL } from "./specs/fixtures.js";

// Before anything else: the config is evaluated first, so the values are in `process.env` for the web
// servers, for `globalSetup` and for the specs alike.
loadRepoEnv();

/**
 * The browser lane's configuration.
 *
 * It runs the BUILT apps (`next start`, the API's `start`), not the dev servers: the BFF defects this
 * lane exists to catch ([[TD-049]], [[TD-050]]) appeared in the production build, and a lane that runs
 * a different stack than a deployment would be testing a different product.
 *
 * `webServer` owns the two HTTP processes — Playwright already knows how to start them, poll them and
 * tear them down. Everything that is not an HTTP server (migrations, the demo seed, and in WU-3 the
 * worker and the SMTP sink) is `globalSetup`'s job, because a `webServer` entry needs a URL to poll and
 * a queue consumer has none.
 */
export default defineConfig({
  testDir: "./specs",
  globalSetup: "./global-setup.ts",
  /**
   * Serial, and on one worker.
   *
   * The flows share one database, one tenant and one set of cookies; running them in parallel would
   * test the runner's scheduling as much as the product. A lane this size does not need parallelism,
   * and flakiness is the cost it would pay for it.
   */
  fullyParallel: false,
  workers: 1,
  forbidOnly: process.env.CI !== undefined,
  retries: process.env.CI === undefined ? 0 : 1,
  reporter: process.env.CI === undefined ? "list" : [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: WEB_BASE_URL,
    // A trace on failure is the reason a browser test is worth having: it is the recording of what
    // the browser actually saw.
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    testIdAttribute: "data-testid",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      // The API's own `start` command, deliberately: a lane that started the process some other way
      // would keep passing while the command a deployment runs stayed broken.
      command: "pnpm --filter @newsaas/api start",
      url: "http://localhost:3001/health/ready",
      reuseExistingServer: process.env.CI === undefined,
      timeout: 60_000,
      stdout: "pipe",
      stderr: "pipe",
    },
    {
      command: "pnpm --filter @newsaas/web start",
      url: WEB_BASE_URL,
      reuseExistingServer: process.env.CI === undefined,
      timeout: 60_000,
      stdout: "pipe",
      stderr: "pipe",
    },
  ],
});
