import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module.js";
import { ContextModule } from "../context/context.module.js";
import { RbacModule } from "../rbac/rbac.module.js";
import { PurchasesController } from "./purchases.controller.js";
import { PurchaseRepository } from "./purchases.repository.js";
import { PurchasesService } from "./purchases.service.js";

/**
 * Purchases module (EPIC-11 PUR-001). A leaf consumer of the platform: it
 * imports Context (request context), RBAC (permission re-assertion) and Audit
 * (the append-only writer the mutations co-commit with) and is never imported
 * by another domain module. PrismaService arrives through the @Global
 * PrismaModule, as in the Catalog/Inventory/Suppliers modules.
 *
 * Core Business domain: the purchase draft is the tenant-scoped aggregate the
 * supplier registry and the catalog are referenced from. It imports no
 * Veterinary vertical, and it intentionally does not import Inventory — a
 * draft is inert and its stock effects arrive with PUR-002's receiving
 * command, which owns the ledger transaction.
 *
 * There is no entitlement gate: purchases are a Core Business capability, not a
 * Veterinary feature, and the already-seeded `purchases` feature code stays
 * deliberately unconsulted (DEC-016).
 */
@Module({
  imports: [ContextModule, RbacModule, AuditModule],
  controllers: [PurchasesController],
  providers: [PurchaseRepository, PurchasesService],
})
export class PurchasesModule {}
