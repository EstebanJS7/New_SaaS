import { Module } from "@nestjs/common";
import { PrismaModule } from "@newsaas/database";
import { StorageModule } from "@newsaas/storage";
import { BrandingResetCleanupConsumer } from "./branding-reset-cleanup/cleanup.consumer.js";
import { BrandingResetCleanupHandler } from "./branding-reset-cleanup/cleanup.handler.js";
import { BrandingResetCleanupReconciliationService } from "./branding-reset-cleanup/reconciliation.service.js";
import { RedisHealthService } from "./redis/redis-health.service.js";

/**
 * Worker deployable module.
 *
 * Composes the durable branding-reset cleanup pipeline (consumer + interval
 * reconciliation) on top of the shared Prisma and object-storage boundaries.
 * PrismaModule is `@Global`; StorageModule.forRoot() exports the abstract
 * StoragePort the handler deletes through.
 */
@Module({
  imports: [PrismaModule, StorageModule.forRoot()],
  providers: [
    RedisHealthService,
    BrandingResetCleanupHandler,
    BrandingResetCleanupConsumer,
    BrandingResetCleanupReconciliationService,
  ],
})
export class WorkerModule {}
