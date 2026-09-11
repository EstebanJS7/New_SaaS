import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module.js";
import { ContextModule } from "../context/context.module.js";
import { EntitlementsModule } from "../entitlements/entitlements.module.js";
import { RbacModule } from "../rbac/rbac.module.js";
import { BrandingAssetController } from "./branding-asset.controller.js";
import { BrandingAssetDeliveryService } from "./branding-asset-delivery.service.js";
import {
  BRANDING_ASSET_DELIVERY_CONFIG,
  readBrandingAssetDeliveryConfig,
} from "./branding-asset-delivery.service.js";
import { BrandingAssetPipe } from "./branding-asset.pipe.js";
import { BrandingAssetService } from "./branding-asset.service.js";
import { BrandingCache, InMemoryBrandingCache } from "./branding-cache.js";
import { BrandingController } from "./branding.controller.js";
import { BrandingResolver } from "./branding-resolver.js";
import {
  BRANDING_RESET_CLEANUP_PRODUCER,
  createBullMqCleanupProducer,
} from "./branding-reset-cleanup.producer.js";
import { BrandingService } from "./branding.service.js";
import { PublicBrandingAssetController } from "./public-branding-asset.controller.js";
import { PublicBrandingController } from "./public-branding.controller.js";

@Module({
  imports: [ContextModule, EntitlementsModule, RbacModule, AuditModule],
  controllers: [
    BrandingController,
    PublicBrandingController,
    PublicBrandingAssetController,
    BrandingAssetController,
  ],
  providers: [
    BrandingService,
    BrandingResolver,
    BrandingAssetService,
    BrandingAssetDeliveryService,
    BrandingAssetPipe,
    {
      provide: BRANDING_ASSET_DELIVERY_CONFIG,
      useFactory: () => readBrandingAssetDeliveryConfig(process.env),
    },
    {
      provide: BRANDING_RESET_CLEANUP_PRODUCER,
      useFactory: () => {
        // apiEnv already enforces REDIS_URL before the app is created; failing
        // here would only happen on a misconfigured custom bootstrap.
        const redisUrl = process.env.REDIS_URL;
        if (!redisUrl) {
          throw new Error("REDIS_URL is required to enqueue branding reset cleanup intents.");
        }
        return createBullMqCleanupProducer(redisUrl);
      },
    },
    { provide: BrandingCache, useClass: InMemoryBrandingCache },
  ],
  exports: [BrandingService, BrandingAssetService],
})
export class BrandingModule {}
