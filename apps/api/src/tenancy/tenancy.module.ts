import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { AuditModule } from "../audit/audit.module.js";
import { ContextModule } from "../context/context.module.js";
import { RbacModule } from "../rbac/rbac.module.js";
import { MembershipsController } from "./membership.controller.js";
import { MembershipRoleAssignmentService } from "./membership-role-assignment.service.js";
import { TenantActiveGuard } from "./tenant-active.guard.js";
import { TenantMembershipRepository } from "./tenant-membership.repository.js";

/**
 * Tenancy core (design D5 / slice S4).
 *
 * The TenantActiveGuard registers through APP_GUARD so it is GLOBAL for every
 * module composing this one. ORDER IS CONTRACT (design D3 wire order):
 * AppModule must import AuthModule BEFORE this module so the authentication
 * guard enriches the RequestContext before tenant resolution runs.
 * `tenancy.wiring.test.ts` enforces that composition order.
 *
 * RbacModule is imported for the exported PermissionResolver consumed by
 * `/memberships/me/permissions` (EPIC-02 design D4). This import does NOT
 * affect guard-chain order — that contract lives solely in AppModule's import
 * array (Auth < Tenancy < Rbac). AuditModule supplies the append-only writer
 * behind the audited role-assignment command (EPIC-02 task 2.4/2.5).
 */
@Module({
  imports: [ContextModule, RbacModule, AuditModule],
  controllers: [MembershipsController],
  providers: [
    TenantMembershipRepository,
    MembershipRoleAssignmentService,
    TenantActiveGuard,
    // Global for the whole app; runs after AuthGuard by module composition
    // order (see class doc and app.module.ts imports array).
    { provide: APP_GUARD, useClass: TenantActiveGuard },
  ],
})
export class TenancyModule {}
