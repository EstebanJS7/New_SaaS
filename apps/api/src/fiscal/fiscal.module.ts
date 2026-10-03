import { Module } from "@nestjs/common";
import { FiscalProviderModule } from "@newsaas/fiscal";

/**
 * The concrete implementation is created only in the shared Fiscal provider
 * module; this remains the API-side composition root for API-owned providers.
 * EPIC-16 replaces the fake selection with a real adapter.
 */
@Module({
  imports: [FiscalProviderModule],
})
export class FiscalModule {}
