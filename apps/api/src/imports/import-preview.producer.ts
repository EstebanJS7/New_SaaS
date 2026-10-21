import { createBullMqImportPreviewProducer, type ImportPreviewProducer } from "@newsaas/imports";

/**
 * The API's import preview producer (EPIC-19 [[IMP-002]]).
 *
 * The transport itself lives in `@newsaas/imports`, next to the queue contract the
 * worker consumes, so both deployables name the same queue, the same job and the
 * same job identity. This file is the COMPOSITION ROOT.
 *
 * **An absent `REDIS_URL` throws here**, exactly like the branding, fiscal and
 * notification producers in this application: a deployment that needs a queue must
 * not boot without one. The API's own test harness substitutes this token the same
 * way it substitutes the other three, so the suites boot the real `AppModule` graph
 * without a Redis — uniformity here is worth more than one fewer override there,
 * and a factory that quietly returns a broken producer makes the missing
 * configuration a runtime surprise instead of a boot failure.
 *
 * The connection is created ONCE, here, and handed to the producer; the enqueue path
 * never constructs a `Queue` of its own.
 */
export function createImportPreviewProducer(
  env: NodeJS.ProcessEnv = process.env
): ImportPreviewProducer {
  const redisUrl = env.REDIS_URL;
  if (redisUrl === undefined || redisUrl === "") {
    throw new Error("REDIS_URL is not set");
  }
  return createBullMqImportPreviewProducer(redisUrl);
}
