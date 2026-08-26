import { Inject, Injectable } from "@nestjs/common";
// Value imports (not `import type`): DI tokens and seed constants must exist
// at runtime.
import { PrismaService, ROLE_SEEDS, type RoleCode } from "@newsaas/database";
import { DomainError } from "@newsaas/shared";
import { RequestContextService } from "../context/request-context.service.js";
import { AuditAppendTx, AuditWriter } from "../audit/audit-writer.service.js";
// Value imports (NOT `import type`): NestJS reads constructor parameter types
// from runtime metadata, which `import type` erases — the DI container would
// see `undefined` at index 1 and fail to boot the whole AppModule.
import {
  MEMBERSHIP_NOT_FOUND_MESSAGE,
  TenantMembershipRepository,
} from "./tenant-membership.repository.js";

/** Response of a successful membership role assignment. */
export interface MembershipRoleAssignedDto {
  readonly membershipId: string;
  readonly roleCode: RoleCode;
}

interface RoleLookupDelegate {
  findUnique: (args: { where: { code: string } }) => Promise<{ id: string; code: string } | null>;
  findMany: (args: {
    where?: { code?: { in?: readonly string[] } };
  }) => Promise<{ id: string; code: string }[]>;
}

/**
 * Audited membership role-assignment command (EPIC-02 design D3, task 2.4).
 *
 * Lives beside its aggregate (TenantMembership) rather than inside RbacModule:
 * TenancyModule already imports RbacModule for permission resolution, and the
 * reverse dependency would close a module cycle. The RBAC-specific knowledge
 * here is limited to the administrator-class code list.
 *
 * Flow per spec (rbac-administration / Membership role assignment):
 * 1. resolve the TARGET membership through tenant-scoped access only — a
 *    foreign/nonexistent id degrades to the shared NOT_FOUND before anything
 *    else is touched;
 * 2. resolve the target role by seeded code (global reference data);
 * 3. tenant-scoped guarded replace — the last-administrator rule runs INSIDE
 *    the transaction under tenant-wide FOR UPDATE row locks (review
 *    CRITICAL-2), and the
 *    audit row is appended in THAT SAME transaction (review WARNING-1), so a
 *    mutation can never commit without its trail and vice versa (409 CONFLICT
 *    leaves both the stored role AND the audit log untouched);
 * 4. exactly ONE audit row (`rbac.membership_role_assigned`) with the
 *    `{before, after}` role-code diff; append failures roll back the whole
 *    transaction so fail-closed audit holds.
 */
@Injectable()
export class MembershipRoleAssignmentService {
  constructor(
    // Narrow structural contract keeps this boundary decoupled from the full
    // generated client while staying DI-token compatible with PrismaService.
    @Inject(PrismaService) private readonly prisma: { role: RoleLookupDelegate },
    private readonly memberships: TenantMembershipRepository,
    private readonly audit: AuditWriter,
    private readonly requestContext: RequestContextService
  ) {}

  async assign(membershipId: string, roleCode: RoleCode): Promise<MembershipRoleAssignedDto> {
    const actorId = this.requestContext.requireUserProfileId();

    // Target resolution PRECEDES catalog resolution (spec: cross-tenant target
    // invisible): a foreign/nonexistent id must degrade to the SAME NOT_FOUND
    // regardless of permission-catalog state — a catalog desync must never
    // leak through an unknown membership id as VALIDATION_FAILED.
    const target = await this.memberships.findRoleSnapshotInActiveTenant(membershipId);
    if (!target) {
      throw new DomainError("NOT_FOUND", MEMBERSHIP_NOT_FOUND_MESSAGE);
    }

    const role = await this.prisma.role.findUnique({ where: { code: roleCode } });
    if (!role) {
      throw new DomainError(
        "VALIDATION_FAILED",
        "Permission catalog is out of sync with the reference seed."
      );
    }

    await this.memberships.replaceRoleGuarded(
      membershipId,
      role.id,
      // Audit rides INSIDE the transaction (review WARNING-1): the append and
      // the role write commit atomically or not at all. The previous role
      // code arrives via `outcome` — the caller's destructure of THIS call's
      // result cannot have been initialized while the transaction runs.
      async (tx, outcome) => {
        // Type seam: `tx` is the generated TransactionClient whose overloaded
        // generic auditLog.create is not structurally comparable to the
        // narrow AuditAppendTx contract (see that interface's bivariance
        // note); at runtime it IS the same delegate, so pin the single cast
        // here rather than loosening the writer's contract.
        const auditableTx = tx as unknown as AuditAppendTx;
        await this.audit.append(
          {
            action: "rbac.membership_role_assigned",
            tenantId: this.requestContext.requireTenantId(),
            actorUserProfileId: actorId,
            targetType: "membership",
            targetId: membershipId,
            metadata: { before: outcome.previousRoleCode, after: roleCode },
          },
          auditableTx
        );
      }
    );

    return { membershipId, roleCode };
  }
}

/**
 * Zod enum of the six addressable seeded role codes (request-body gate).
 * The tuple cast keeps zod's OUTPUT type as the RoleCode union — a widened
 * `string[]` would silently weaken every consumer's narrowing.
 */
export const ROLE_CODE_SCHEMA_ENUM = ROLE_SEEDS.map((role) => role.code) as unknown as readonly [
  RoleCode,
  ...RoleCode[],
];
