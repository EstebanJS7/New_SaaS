import { defineConfig } from "@playwright/test";
const url = process.env.JOURNEY_E2E_DATABASE_URL;
if (!url || !/^\/newsaas_journey_browser_test_[a-f0-9]{32}$/.test(new URL(url).pathname))
  throw Error("Disposable journey browser database required.");
if (process.env.DATABASE_URL !== url || new URL(url).hostname !== "127.0.0.1")
  throw Error("Journey database environment mismatch.");
const api = process.env.JOURNEY_E2E_API_ENTRY,
  web = process.env.JOURNEY_E2E_WEB_DIR,
  base = process.env.JOURNEY_E2E_BASE_URL,
  upstream = process.env.JOURNEY_E2E_API_URL;
if (!api || !web || !base || !upstream || !process.env.JOURNEY_E2E_OUTPUT_DIR)
  throw Error("Use scripts/verify-journey-browser.mjs for an isolated built stack.");
export default defineConfig({
  testDir: "./journey-specs",
  testMatch: ["journey.spec.ts", "pos-cart.spec.ts"],
  outputDir: process.env.JOURNEY_E2E_OUTPUT_DIR,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  workers: 1,
  retries: 0,
  maxFailures: 1,
  fullyParallel: false,
  forbidOnly: true,
  reporter: "list",
  use: {
    baseURL: base,
    channel: "chrome",
    headless: true,
    viewport: { width: 1440, height: 1000 },
    timezoneId: "America/Los_Angeles",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: [
    {
      command: 'node "' + api + '"',
      url: upstream + "/health/ready",
      reuseExistingServer: false,
      timeout: 60_000,
      stdout: "ignore",
      stderr: "pipe",
    },
    {
      command:
        'node "' +
        process.env.JOURNEY_E2E_NEXT_BIN +
        '" start "' +
        web +
        '" -H 127.0.0.1 -p ' +
        new URL(base).port,
      url: base + "/login",
      reuseExistingServer: false,
      timeout: 60_000,
      stdout: "pipe",
      stderr: "pipe",
      env: { NODE_ENV: "production" },
    },
  ],
});
