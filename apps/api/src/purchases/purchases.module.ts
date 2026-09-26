import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module.js";
import { ContextModule } from "../context/context.module.js";
import { InventoryRepository } from "../inventory/inventory.repository.js";
import { RbacModule } from "../rbac/rbac.module.js";
import { PurchasesController } from "./purchases.controller.js";
import { PurchaseRepository } from "./purchases.repository.js";
import { PurchasesService } from "./purchases.service.js";

/**
 * Purchases module (EPIC-11 PUR-001/PUR-002). A leaf consumer of the platform:
 * it imports Context (request context), RBAC (permission re-assertion) and
 * Audit (the append-only writer the mutations co-commit with) and is never
 * imported by another domain module. PrismaService arrives through the @Global
 * PrismaModule, as in the Catalog/Inventory/Suppliers modules.
 *
 * Core Business domain: the purchase aggregate references the supplier registry
 * and the catalog. The PUR-002 receive command is the purchase's only stock
 * effect, so this module ALSO consumes the EPIC-10 ledger seam. It reuses
 * {@link InventoryRepository} as a locally-provided, stateless seam rather than
 * importing InventoryModule or duplicating ledger SQL: the repository only wraps
 * the global Prisma client and the request context, so a second provider
 * instance is behaviourally identical, and the purchase module never reaches
 * into another domain's tables directly.
 *
 * There is no entitlement gate: purchases are a Core Business capability, not a
 * Veterinary feature, and the already-seeded `purchases` feature code stays
 * deliberately unconsulted (DEC-016).
 */
@Module({
  imports: [ContextModule, RbacModule, AuditModule],
  controllers: [PurchasesController],
  providers: [PurchaseRepository, InventoryRepository, PurchasesService],
})
export class PurchasesModule {}
