import { Module } from "@nestjs/common";
import { EntitlementsService } from "./entitlements.service.js";

/**
 * Entitlements boundary (design D8 / slice S6).
 *
 * Exposes the typed {@link EntitlementsService} for future gating callers.
 * No controller ships in this epic: grants are ops/seed-managed and the only
 * consumer contract is `has(tenantId, featureCode)`.
 */
@Module({
  providers: [EntitlementsService],
  exports: [EntitlementsService],
})
export class EntitlementsModule {}
