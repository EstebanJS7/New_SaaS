import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module.js";
import { ContextModule } from "../context/context.module.js";
import { EntitlementsModule } from "../entitlements/entitlements.module.js";
import { RbacModule } from "../rbac/rbac.module.js";
import { BranchesController, MembershipBranchesController } from "./branches.controller.js";
import { BranchesService } from "./branches.service.js";

/**
 * MB-001 / DEC-094 — branches and staff assignment. A leaf module: Context,
 * RBAC, Audit and Entitlements (`multi_branch`) in, nothing out.
 */
@Module({
  imports: [ContextModule, RbacModule, AuditModule, EntitlementsModule],
  controllers: [BranchesController, MembershipBranchesController],
  providers: [BranchesService],
})
export class BranchesModule {}
