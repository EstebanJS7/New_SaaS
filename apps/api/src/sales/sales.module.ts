import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module.js";
import { CatalogRepository } from "../catalog/catalog.repository.js";
import { ContextModule } from "../context/context.module.js";
import { EntitlementsModule } from "../entitlements/entitlements.module.js";
import { RbacModule } from "../rbac/rbac.module.js";
import { SettingsModule } from "../settings/settings.module.js";
import { SalesController } from "./sales.controller.js";
import { SaleRepository } from "./sales.repository.js";
import { SalesService } from "./sales.service.js";

/**
 * Sales module (EPIC-12 POS-001). A leaf consumer of the platform: it imports
 * Context (request context), RBAC (permission re-assertion), Audit (the
 * append-only writer the mutations co-commit with), Settings (the typed
 * `sales.defaultCurrency` read) and Entitlements (the `sales` capability gate)
 * and is never imported by another domain module. PrismaService arrives through
 * the @Global PrismaModule, as in the Catalog/Inventory/Purchases modules.
 *
 * Core Business domain: the sale aggregate references the customer registry and
 * the catalog. It reuses {@link CatalogRepository} as a locally-provided,
 * stateless seam rather than importing CatalogModule or duplicating catalog SQL:
 * the repository only wraps the global Prisma client and the request context, so
 * a second provider instance is behaviourally identical, and the sales module
 * never reaches into another domain's tables directly. This mirrors how
 * PurchasesModule provides InventoryRepository for its ledger seam.
 *
 * Unlike DEC-016's ungated Core precedent (catalog, inventory, purchases), this
 * surface IS entitlement-gated on the already-seeded `sales` feature code
 * (DEC-026): the entitlement is asserted before the granular permission on every
 * route including reads.
 */
@Module({
  imports: [ContextModule, RbacModule, AuditModule, SettingsModule, EntitlementsModule],
  controllers: [SalesController],
  providers: [SaleRepository, CatalogRepository, SalesService],
})
export class SalesModule {}
