import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module.js";
import { ContextModule } from "../context/context.module.js";
import { EntitlementsModule } from "../entitlements/entitlements.module.js";
import { RbacModule } from "../rbac/rbac.module.js";
import { SaleRepository } from "../sales/sales.repository.js";
import { SettingsModule } from "../settings/settings.module.js";
import { BillingController } from "./billing.controller.js";
import { BillingRepository } from "./billing.repository.js";
import { BillingService } from "./billing.service.js";

/**
 * Billing module (EPIC-14 BILL-002). A leaf consumer of the platform: it imports
 * Context (request context), RBAC (permission re-assertion), Audit (the
 * append-only writer the creation co-commits with), Settings (the typed
 * `sales.requireCustomerForInvoice` read) and Entitlements (the `billing`
 * capability gate) and is never imported by another domain module. PrismaService
 * arrives through the @Global PrismaModule, as in the Sales/Cash modules.
 *
 * The source sale is read through {@link SaleRepository} as a locally-provided,
 * stateless seam rather than importing SalesModule: that repository is
 * tenant-predicated and already owns the shared sale-not-found message, so
 * Billing reuses the exact byte-equivalent sale `404` instead of defining a
 * second one. The repository only wraps the global Prisma client and the request
 * context, so a second provider instance is behaviourally identical, and Billing
 * never reaches into the sale tables directly. This mirrors how SalesModule
 * provides the Catalog/Inventory repositories.
 *
 * Unlike DEC-016's ungated Core precedent (catalog, inventory, purchases), this
 * surface IS entitlement-gated on the already-seeded `billing` feature code
 * (DEC-040): the entitlement is asserted before the granular permission on every
 * route including reads.
 */
@Module({
  imports: [ContextModule, RbacModule, AuditModule, SettingsModule, EntitlementsModule],
  controllers: [BillingController],
  providers: [BillingRepository, SaleRepository, BillingService],
})
export class BillingModule {}
