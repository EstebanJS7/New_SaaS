import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module.js";
import { ContextModule } from "../context/context.module.js";
import { RbacModule } from "../rbac/rbac.module.js";
import { InventoryController } from "./inventory.controller.js";
import { InventoryRepository } from "./inventory.repository.js";
import { InventoryService } from "./inventory.service.js";

/**
 * Inventory module (EPIC-10 W2). A leaf consumer of the platform: it imports
 * Context (request context), RBAC (permission re-assertion) and Audit (the
 * append-only writer the adjustment co-commits with) and is never imported by
 * another domain module. PrismaService arrives through the @Global
 * PrismaModule, as in the Catalog/Patients modules.
 *
 * Core Business domain: inventory does NOT import the Veterinary vertical and
 * knows nothing about pets, encounters or appointments. It reads only the
 * tenant-scoped catalog item identity it needs to enforce `tracksStock`.
 *
 * There is no entitlement gate: the stock ledger is Core Business capability,
 * not a Veterinary feature.
 */
@Module({
  imports: [ContextModule, RbacModule, AuditModule],
  controllers: [InventoryController],
  providers: [InventoryRepository, InventoryService],
})
export class InventoryModule {}
