import { Module } from "@nestjs/common";
import { FiscalProviderModule } from "@newsaas/fiscal";
import {
  createBullMqFiscalSubmissionProducer,
  FISCAL_SUBMISSION_PRODUCER,
} from "./fiscal-submission.producer.js";

/**
 * The concrete implementation is created only in the shared Fiscal provider
 * module; this remains the API-side composition root for API-owned providers
 * and the fiscal submission producer. EPIC-16 replaces the fake selection
 * with a real adapter.
 */
@Module({
  imports: [FiscalProviderModule],
  providers: [
    {
      provide: FISCAL_SUBMISSION_PRODUCER,
      useFactory: () => {
        const redisUrl = process.env.REDIS_URL;
        if (!redisUrl) {
          throw new Error("REDIS_URL is required to enqueue fiscal submissions.");
        }
        return createBullMqFiscalSubmissionProducer(redisUrl);
      },
    },
  ],
})
export class FiscalModule {}
