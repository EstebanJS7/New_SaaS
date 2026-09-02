import { Module } from "@nestjs/common";
import { PrismaModule } from "@newsaas/database";
import { AuditModule } from "./audit/audit.module.js";
import { AuthModule } from "./auth/auth.module.js";
import { BrandingModule } from "./branding/branding.module.js";
import { CommonModule } from "./common/common.module.js";
import { ContextModule } from "./context/context.module.js";
import { CustomersModule } from "./customers/customers.module.js";
import { EntitlementsModule } from "./entitlements/entitlements.module.js";
import { HealthModule } from "./health/health.module.js";
import { RbacModule } from "./rbac/rbac.module.js";
import { SettingsModule } from "./settings/settings.module.js";
import { TenancyModule } from "./tenancy/tenancy.module.js";

// Guard-chain wire order (design D3 + EPIC-02 design D1): AuthModule's
// AuthGuard must register BEFORE TenancyModule's TenantActiveGuard, and
// RbacModule's PermissionGuard strictly AFTER both — keep this import order
// stable. tenancy.wiring.test.ts pins Auth < Tenancy < Rbac.
// Audit/Entitlements expose no APP_GUARD, so their position carries no
// ordering contract.
@Module({
  imports: [
    CommonModule,
    ContextModule,
    PrismaModule,
    HealthModule,
    AuthModule,
    TenancyModule,
    RbacModule,
    AuditModule,
    EntitlementsModule,
    BrandingModule,
    SettingsModule,
    CustomersModule,
  ],
})
export class AppModule {}
