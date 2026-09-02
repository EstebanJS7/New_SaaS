import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module.js";
import { ContextModule } from "../context/context.module.js";
import { EntitlementsModule } from "../entitlements/entitlements.module.js";
import { RbacModule } from "../rbac/rbac.module.js";
import { BrandingController } from "./branding.controller.js";
import { BrandingService } from "./branding.service.js";
import { PublicBrandingController } from "./public-branding.controller.js";

@Module({
  imports: [ContextModule, EntitlementsModule, RbacModule, AuditModule],
  controllers: [BrandingController, PublicBrandingController],
  providers: [BrandingService],
  exports: [BrandingService],
})
export class BrandingModule {}
