import { Module } from "@nestjs/common";
import { FiscalController } from "./fiscal.controller.js";
import { FiscalRepository } from "./fiscal.repository.js";
import { FiscalService } from "./fiscal.service.js";
import { FiscalProviderModule } from "@newsaas/fiscal";
import { AuditModule } from "../audit/audit.module.js";
import { ContextModule } from "../context/context.module.js";
import { EntitlementsModule } from "../entitlements/entitlements.module.js";
import { RbacModule } from "../rbac/rbac.module.js";
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
  imports: [FiscalProviderModule, ContextModule, RbacModule, AuditModule, EntitlementsModule],
  controllers: [FiscalController],
  providers: [
    FiscalRepository,
    FiscalService,
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
