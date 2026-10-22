import { describe, expect, it } from "vitest";
import { createImportPreviewProducer } from "./import-preview.producer.js";

/**
 * The composition root's one decision: which producer an environment gets.
 *
 * Only the QUEUE-LESS branch is exercised here. The wired branch constructs an
 * `ioredis` client and a `Queue`, and a suite that opened a real connection to
 * assert "it returned the BullMQ producer" would need a Redis to be meaningful —
 * `packages/imports` pins that transport's own contract instead (`queue.test.ts`).
 *
 * The behaviour under test is that an environment without `REDIS_URL` fails at
 * BOOT — the same contract the branding, fiscal and notification producers keep.
 * A factory that instead returned a producer which refuses at use would turn a
 * missing deployment input into a runtime surprise on the first upload, and would
 * be the only producer in this application behaving that way.
 *
 * The API's test harness substitutes `IMPORT_PREVIEW_PRODUCER`
 * (`apps/api/test/support/boot-test-app.ts`) exactly as it substitutes the other
 * three, which is what lets 117 suites boot the real graph without a Redis. This
 * throw is why that substitution is not optional.
 */
describe("createImportPreviewProducer", () => {
  it("refuses to build a producer when REDIS_URL is absent or empty", () => {
    for (const env of [{}, { REDIS_URL: "" }] as NodeJS.ProcessEnv[]) {
      expect(() => createImportPreviewProducer(env)).toThrow(/REDIS_URL/);
    }
  });

  it("names the missing configuration rather than failing generically", () => {
    expect(() => createImportPreviewProducer({})).toThrow("REDIS_URL is not set");
  });
});
