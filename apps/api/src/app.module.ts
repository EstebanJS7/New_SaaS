import { Module } from "@nestjs/common";
import { PrismaModule } from "@newsaas/database";
import { StorageModule } from "@newsaas/storage";
import { AuditModule } from "./audit/audit.module.js";
import { AuthModule } from "./auth/auth.module.js";
import { BrandingModule } from "./branding/branding.module.js";
import { CatalogModule } from "./catalog/catalog.module.js";
import { ClinicalModule } from "./clinical/clinical.module.js";
import { CommonModule } from "./common/common.module.js";
import { ContextModule } from "./context/context.module.js";
import { CustomersModule } from "./customers/customers.module.js";
import { EntitlementsModule } from "./entitlements/entitlements.module.js";
import { HealthModule } from "./health/health.module.js";
import { InventoryModule } from "./inventory/inventory.module.js";
import { PatientsModule } from "./patients/patients.module.js";
import { PortalModule } from "./portal/portal.module.js";
import { RbacModule } from "./rbac/rbac.module.js";
import { SchedulingModule } from "./scheduling/scheduling.module.js";
import { SettingsModule } from "./settings/settings.module.js";
import { SuppliersModule } from "./suppliers/suppliers.module.js";
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
    StorageModule.forRoot(),
    BrandingModule,
    SettingsModule,
    CustomersModule,
    PatientsModule,
    ClinicalModule,
    SchedulingModule,
    // EPIC-09 catalog: a leaf consumer of the platform; it adds no APP_GUARD,
    // so its position carries no guard-ordering contract.
    CatalogModule,
    // EPIC-10 inventory: the stock ledger consumer of the catalog identity; it
    // adds no APP_GUARD either, so its position is free — kept after Catalog so
    // the dependency direction reads top-down.
    InventoryModule,
    // EPIC-11 W2 suppliers: the Core supplier registry EPIC-11 purchases
    // reference; it adds no APP_GUARD either, so its position is free — kept
    // after Inventory so the dependency direction reads top-down.
    SuppliersModule,
    // Portal boundary LAST: its global PortalAuthGuard must run after the staff
    // chain (Auth < Tenancy < Rbac < Portal) so it only ever sees requests the
    // staff guards have already skipped for the /portal/* surface.
    PortalModule,
  ],
})
export class AppModule {}
