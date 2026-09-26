import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module.js";
import { ContextModule } from "../context/context.module.js";
import { RbacModule } from "../rbac/rbac.module.js";
import { SuppliersController } from "./suppliers.controller.js";
import { SupplierRepository } from "./suppliers.repository.js";
import { SuppliersService } from "./suppliers.service.js";

/**
 * Suppliers module (EPIC-11 W2). A leaf consumer of the platform: it imports
 * Context (request context), RBAC (permission re-assertion) and Audit (the
 * append-only writer the mutations co-commit with) and is never imported by
 * another domain module. PrismaService arrives through the @Global PrismaModule,
 * as in the Catalog/Inventory/Patients modules.
 *
 * Core Business domain: the supplier registry is the identity record EPIC-11
 * purchases reference. It holds no balance, no owed amount and no payment state,
 * and it does not import the Veterinary vertical.
 *
 * There is no entitlement gate: suppliers are a Core Business capability, not a
 * Veterinary feature (the Patients module is the entitlement-gated twin).
 */
@Module({
  imports: [ContextModule, RbacModule, AuditModule],
  controllers: [SuppliersController],
  providers: [SupplierRepository, SuppliersService],
})
export class SuppliersModule {}
