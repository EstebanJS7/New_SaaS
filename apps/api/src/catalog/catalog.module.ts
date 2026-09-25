import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module.js";
import { ContextModule } from "../context/context.module.js";
import { RbacModule } from "../rbac/rbac.module.js";
import { CatalogRepository } from "./catalog.repository.js";
import { CatalogService } from "./catalog.service.js";
import { CatalogController } from "./catalog.controller.js";
import { CatalogTaxRatesController } from "./catalog-tax-rates.controller.js";

/**
 * Catalog module (EPIC-09 WU2). A leaf consumer of the platform: it imports
 * Context (request context), RBAC (permission re-assertion) and Audit (the
 * append-only writer the mutations co-commit with) and is never imported by a
 * Core module. PrismaService arrives through the @Global PrismaModule, as in
 * the Patients/Customers modules.
 *
 * Controller ORDER is contract: the static `/catalog/tax-rates` surface is
 * registered BEFORE the `/catalog/:id` parameter route, so the static segment
 * can never be captured as an item id.
 *
 * There is no entitlement gate: the catalog is Core Business configuration, not
 * a Veterinary capability (the Patients module is the entitlement-gated twin).
 */
@Module({
  imports: [ContextModule, RbacModule, AuditModule],
  controllers: [CatalogTaxRatesController, CatalogController],
  providers: [CatalogRepository, CatalogService],
})
export class CatalogModule {}
