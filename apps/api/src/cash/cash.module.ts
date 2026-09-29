import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module.js";
import { ContextModule } from "../context/context.module.js";
import { EntitlementsModule } from "../entitlements/entitlements.module.js";
import { RbacModule } from "../rbac/rbac.module.js";
import { CashController } from "./cash.controller.js";
import { CashRepository } from "./cash.repository.js";
import { CashService } from "./cash.service.js";

/**
 * Cash module (EPIC-12 POS-002). A leaf consumer of the platform: it imports
 * Context (request context), RBAC (permission re-assertion), Audit (the
 * append-only writer the mutations co-commit with) and Entitlements (the `cash`
 * capability gate) and is never imported by another domain module. PrismaService
 * arrives through the @Global PrismaModule, as in the Catalog/Inventory/
 * Purchases/Sales modules.
 *
 * Core Business domain: the cash register and session reference no other domain
 * table, so the module provides nothing beyond its own repository and service —
 * no Settings read (cash has no tenant setting in this slice) and no
 * cross-module repository seam. It EXPORTS {@link CashRepository} so the sales
 * module (POS-003) can inject the tenant-safe session-resolution and `SALE`
 * movement seams into the CompleteSale transaction without importing the
 * entitlement-gated cash service.
 *
 * Unlike DEC-016's ungated Core precedent (catalog, inventory, purchases), this
 * surface IS entitlement-gated on the seeded `cash` feature code (DEC-026
 * subsequent-scope note of 2026-09-29): the entitlement is asserted FIRST,
 * before the granular permission and before any data access, on every route
 * including reads. `cash` is its own capability (PRD §10), exactly as `sales`
 * gates the sale surface — gating the drawer on `sales` would make a tenant
 * with cash but without sales unable to read its own registers, and would couple
 * two independently entitled capabilities.
 */
@Module({
  imports: [ContextModule, RbacModule, AuditModule, EntitlementsModule],
  controllers: [CashController],
  providers: [CashRepository, CashService],
  exports: [CashRepository],
})
export class CashModule {}
