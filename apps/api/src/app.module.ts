import { Module } from "@nestjs/common";
import { PrismaModule } from "@newsaas/database";
import { StorageModule } from "@newsaas/storage";
import { AuditModule } from "./audit/audit.module.js";
import { AuthModule } from "./auth/auth.module.js";
import { BillingModule } from "./billing/billing.module.js";
import { BrandingModule } from "./branding/branding.module.js";
import { CashModule } from "./cash/cash.module.js";
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
import { PurchasesModule } from "./purchases/purchases.module.js";
import { RbacModule } from "./rbac/rbac.module.js";
import { SalesModule } from "./sales/sales.module.js";
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
    // EPIC-11 PUR-001 purchases: the Core draft aggregate that references the
    // supplier registry and the catalog; it adds no APP_GUARD either, so its
    // position is free — kept after Suppliers so the dependency direction reads
    // top-down. Registered BEFORE PortalModule, which must stay last.
    PurchasesModule,
    // EPIC-12 POS-001 sales: the Core sale draft aggregate that references the
    // customer registry and the catalog and is the first entitlement-gated Core
    // surface (DEC-026). It adds no APP_GUARD, so its position is free — kept
    // after Purchases so the dependency direction reads top-down. Registered
    // BEFORE PortalModule, which must stay last.
    SalesModule,
    // EPIC-12 POS-002 cash: the Core register/session foundation POS-003's
    // CompleteSale writes its movement against, and the second entitlement-gated
    // Core surface (DEC-026). It adds no APP_GUARD, so its position is free —
    // kept after Sales so the dependency direction reads top-down. Registered
    // BEFORE PortalModule, which must stay last.
    CashModule,
    // EPIC-14 BILL-002 billing: the Core invoice creation surface that turns one
    // completed sale into one invoice and is the third entitlement-gated Core
    // surface (DEC-040). It adds no APP_GUARD, so its position is free — kept
    // after Cash so the dependency direction reads top-down. Registered BEFORE
    // PortalModule, which must stay last.
    BillingModule,
    // Portal boundary LAST: its global PortalAuthGuard must run after the staff
    // chain (Auth < Tenancy < Rbac < Portal) so it only ever sees requests the
    // staff guards have already skipped for the /portal/* surface.
    PortalModule,
  ],
})
export class AppModule {}
