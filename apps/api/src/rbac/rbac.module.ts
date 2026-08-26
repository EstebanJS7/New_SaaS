import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { AuditModule } from "../audit/audit.module.js";
import { ContextModule } from "../context/context.module.js";
import { RbacAdminController } from "./rbac-admin.controller.js";
import { RbacAdminService } from "./rbac-admin.service.js";
import { PermissionGuard } from "./permission.guard.js";
import { PermissionResolver } from "./permission-resolver.service.js";

/**
 * RBAC enforcement + administration (EPIC-02 design D1/D2/D3).
 *
 * The PermissionGuard registers through APP_GUARD so it is GLOBAL for every
 * module composing this module. ORDER IS CONTRACT (design D1 wire order):
 * AppModule must import AuthModule → TenancyModule → THIS module, so the
 * permission gate only ever evaluates contexts that authentication AND tenant
 * resolution already enriched. `tenancy.wiring.test.ts` pins the full
 * three-link source order; `route-contract.probe.test.ts` pins the route
 * contract the guard enforces.
 *
 * AuditModule supplies the append-only AuditWriter consumed by the audited
 * administration commands (exactly one row per mutation, zero per read).
 */
@Module({
  imports: [ContextModule, AuditModule],
  controllers: [RbacAdminController],
  providers: [
    PermissionResolver,
    RbacAdminService,
    PermissionGuard,
    // Registered LAST in the chain; global for the whole app.
    { provide: APP_GUARD, useClass: PermissionGuard },
  ],
  exports: [PermissionResolver, RbacAdminService],
})
export class RbacModule {}
