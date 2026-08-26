import { Module } from "@nestjs/common";
import { EntitlementsModule } from "../entitlements/entitlements.module.js";
import { AuditModule } from "../audit/audit.module.js";
import { RbacModule } from "../rbac/rbac.module.js";
import { ContextModule } from "../context/context.module.js";
import { SettingsController } from "./settings.controller.js";
import { TenantSettingsService } from "./tenant-settings.service.js";

@Module({
  imports: [ContextModule, EntitlementsModule, RbacModule, AuditModule],
  controllers: [SettingsController],
  providers: [TenantSettingsService],
  exports: [TenantSettingsService],
})
export class SettingsModule {}
