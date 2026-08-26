import { Injectable } from "@nestjs/common";
import { Prisma, PrismaService } from "@newsaas/database";
import { DomainError } from "@newsaas/shared";
import { RequestContextService } from "../context/request-context.service.js";
// Value imports (not `import type`): the shared stranding predicate and lock
// helper are runtime functions used inside this repository's transaction.
import {
  assertEffectiveManageHolderExists,
  lockActiveMembershipRows,
  type ManageHoldershipTx,
} from "../rbac/manage-holdership.js";

/** Transactional view handed to in-transaction post-write steps (audit). */
export type MembershipTx = Prisma.TransactionClient;

/**
 * Membership lifecycle values pinned by schema enum `tenant_membership_status`
 * (design D2). Kept as a local literal union — services stay decoupled from
 * the generated client namespace (structural compatibility only).
 */
export type TenantMembershipStatusValue = "ACTIVE" | "SUSPENDED";

/** Public read model for membership rows — never the raw persistence shape. */
export interface TenantMembershipView {
  id: string;
  tenantId: string;
  userProfileId: string;
  status: TenantMembershipStatusValue;
}

/**
 * Role-bearing snapshot used by the audited assignment command (EPIC-02
 * task 2.4): everything the last-administrator rule and the audit diff need,
 * resolved through tenant-scoped access only.
 */
export interface MembershipRoleSnapshot {
  id: string;
  tenantId: string;
  roleId: string;
  roleCode: string;
}

/**
 * Result of the pre-tenancy resolver query (TenantActiveGuard): the one
 * lookup that may run BEFORE a tenant is known, because its whole purpose is
 * discovering which tenant the caller belongs to. `roleId` is additive in
 * EPIC-02 — PermissionResolver keys the permission-key join off it (design
 * D2), so the guard chain resolves permissions without a second membership
 * lookup.
 */
export interface ActiveMembershipResolution {
  id: string;
  tenantId: string;
  userProfileId: string;
  roleId: string;
  roleCode: string;
}

interface MembershipRowShape {
  id: string;
  tenantId: string;
  userProfileId: string;
  roleId: string;
  status: string;
  role?: { id?: string; code?: string };
}

/** Single stable message behind every membership 404 — byte-equivalence by construction. */
export const MEMBERSHIP_NOT_FOUND_MESSAGE = "Membership not found.";

function toView(row: MembershipRowShape): TenantMembershipView {
  return {
    id: row.id,
    tenantId: row.tenantId,
    userProfileId: row.userProfileId,
    status: row.status as TenantMembershipStatusValue,
  };
}

function toResolution(row: MembershipRowShape): ActiveMembershipResolution {
  return {
    id: row.id,
    tenantId: row.tenantId,
    userProfileId: row.userProfileId,
    roleId: row.role?.id ?? "",
    roleCode: row.role?.code ?? "",
  };
}

/**
 * Tenant-safe data access for the `TenantMembership` aggregate — the REAL
 * aggregate that demonstrates the repository pattern (design D5, spec:
 * tenancy-core / Tenant-safe repository pattern).
 *
 * Contract: every tenant-scoped query carries the tenant predicate IMPLICITLY
 * via `requestContext.requireTenantId()`. Call sites never hand-write tenant
 * filters and cannot forget them; when no tenant authority was resolved
 * server-side, `requireTenantId()` throws FORBIDDEN before any database call
 * happens. Zero matching rows ⇒ `DomainError("NOT_FOUND")`, so a foreign
 * record is indistinguishable from a missing one (spec: cross-tenant 404).
 */
@Injectable()
export class TenantMembershipRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly requestContext: RequestContextService
  ) {}

  /**
   * Pre-tenancy bootstrap lookup used ONLY by TenantActiveGuard. Deliberately
   * NOT tenant-scoped (no tenant authority exists yet) — it resolves WHICH
   * tenant the authenticated profile belongs to. MVP rule per design D5:
   * single-membership auto-selection; ordering is deterministic so behavior
   * stays reproducible even if multi-membership data ever appears.
   */
  async resolveActiveForProfile(userProfileId: string): Promise<ActiveMembershipResolution | null> {
    const row = await this.prisma.tenantMembership.findFirst({
      where: { userProfileId, status: "ACTIVE" },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      include: { role: { select: { code: true, id: true } } },
    });
    return row ? toResolution(row) : null;
  }

  /** All memberships of the caller's active tenant — implicit scope only. */
  async listForActiveTenant(): Promise<TenantMembershipView[]> {
    const rows = await this.prisma.tenantMembership.findMany({
      where: { tenantId: this.requestContext.requireTenantId() },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    return rows.map(toView);
  }

  /**
   * One membership of the caller's active tenant by id. The tenant predicate
   * rides along in the same WHERE clause — foreign ids fall through to the
   * shared NOT_FOUND path instead of leaking existence.
   */
  async findByIdInActiveTenant(id: string): Promise<TenantMembershipView> {
    const row = await this.prisma.tenantMembership.findFirst({
      where: { id, tenantId: this.requestContext.requireTenantId() },
    });
    if (!row) {
      throw new DomainError("NOT_FOUND", MEMBERSHIP_NOT_FOUND_MESSAGE);
    }
    return toView(row);
  }

  /**
   * Status transition scoped to the caller's active tenant. Uses
   * `updateMany` (not `update`) because Prisma's unique-WHERE update could
   * otherwise cross the tenant boundary when handed a foreign primary key;
   * the compound predicate keeps the write inside the tenant and zero
   * affected rows degrade to the same NOT_FOUND envelope.
   */
  async updateStatusInActiveTenant(id: string, status: TenantMembershipStatusValue): Promise<void> {
    const result = await this.prisma.tenantMembership.updateMany({
      where: { id, tenantId: this.requestContext.requireTenantId() },
      data: { status },
    });
    if (result.count === 0) {
      throw new DomainError("NOT_FOUND", MEMBERSHIP_NOT_FOUND_MESSAGE);
    }
  }

  /**
   * Role-bearing snapshot of ONE membership of the caller's active tenant,
   * or null when the id is foreign/nonexistent (same indistinguishability
   * contract as {@link findByIdInActiveTenant}).
   */
  async findRoleSnapshotInActiveTenant(id: string): Promise<MembershipRoleSnapshot | null> {
    const tenantId = this.requestContext.requireTenantId();
    const row = await this.prisma.tenantMembership.findFirst({
      where: { id, tenantId },
      include: { role: { select: { code: true, id: true } } },
    });
    if (!row) return null;
    return {
      id: row.id,
      tenantId: row.tenantId,
      roleId: row.roleId,
      roleCode: row.role?.code ?? "",
    };
  }

  /**
   * Atomically replaces a membership's role with the SHARED stranding
   * predicate evaluated INSIDE the transaction (EPIC-02 design D3;
   * composition-gap fix, re-judge 2026-08-26). Post-write there must remain at
   * least one ACTIVE membership whose role EFFECTIVELY holds
   * `users.membership.manage`; otherwise CONFLICT and nothing is written.
   * A foreign/nonexistent id fails with the shared NOT_FOUND before any write.
   *
   * HISTORY: this flow previously counted administrator-class SEATS instead of
   * effective holders. Seat counting cannot see override denials, so after an
   * override stripped the manage key from ADMIN, demoting the last true holder
   * passed the seat check and permanently locked the tenant out of all
   * `/rbac/*` and `/memberships*` administration. Both flows now share ONE
   * predicate (`rbac/manage-holdership.ts`); seat counting must not return.
   *
   * Race safety (review CRITICAL-2): under READ COMMITTED a plain
   * count-then-write lets two concurrent decisions both observe the retainer
   * each is about to remove and both commit. Before deciding, this transaction
   * therefore takes `SELECT ... FOR UPDATE` row locks via
   * {@link lockActiveMembershipRows}. The lock deliberately covers ALL
   * ACTIVE memberships for this tenant, not only administrator-class rows:
   * tenant overrides can make a non-admin role an effective manager. The
   * tenant-wide row set is ordered by membership id so both mutation flows use
   * the same deterministic serialization protocol.
   *
   * HONEST LIMITATION (TD-006): the in-memory test fake executes the raw query
   * synchronously against maps; it proves WHICH rows are read, never
   * interleaving semantics. Live-PG proof remains TD-006's evidence gate.
   *
   * The tenant predicate rides in every query; no caller-supplied scope is
   * ever trusted. Returns the PREVIOUS role code so the caller can emit an
   * honest audit diff. `withinTransaction` (review WARNING-1) runs after the
   * guarded write and BEFORE commit — the audited-assignment flow appends its
   * audit row there so mutation-without-audit is impossible; it receives
   * `{ previousRoleCode }` because the caller's own destructure cannot have
   * initialized yet while this transaction is still running.
   */
  async replaceRoleGuarded(
    id: string,
    newRoleId: string,
    withinTransaction?: (tx: MembershipTx, outcome: { previousRoleCode: string }) => Promise<void>
  ): Promise<{ previousRoleCode: string }> {
    const tenantId = this.requestContext.requireTenantId();

    return this.prisma.$transaction(async (tx) => {
      // Lock FIRST (CRITICAL-2), decide SECOND. Resolve the target only after
      // the lock so the role snapshot used by the guarded decision belongs to
      // the same serialized transaction view as the effective-holder scan.
      await lockActiveMembershipRows(tx, tenantId);

      const current = await tx.tenantMembership.findFirst({
        where: { id, tenantId },
        include: { role: { select: { code: true, id: true } } },
      });
      if (!current) {
        throw new DomainError("NOT_FOUND", MEMBERSHIP_NOT_FOUND_MESSAGE);
      }

      const previousRoleCode = current.role?.code ?? "";

      // UNIFIED STRANDING PREDICATE (composition-gap fix): judged on the
      // POST-WRITE view BEFORE writing — the target's current role cannot
      // retain through it and its new role is added as an explicit candidate.
      // An unseeded catalog fail-closes naturally here: no effective holders
      // ⇒ CONFLICT, never a silent write.
      //
      // Type seam: the generated TransactionClient's overloaded generic
      // delegates are not structurally comparable to the narrow
      // ManageHoldershipTx contract (its enum-typed `status` filter rejects
      // the predicate's plain-string where) — at runtime it IS the same
      // delegate set, so pin the single cast here rather than widening the
      // shared contract (same pattern as AuditAppendTx in the assignment
      // service).
      const holdershipTx = tx as unknown as ManageHoldershipTx;
      await assertEffectiveManageHolderExists(holdershipTx, tenantId, {
        excludeMembershipIds: [id],
        candidateRoleIds: [newRoleId],
      });

      await tx.tenantMembership.update({ where: { id }, data: { roleId: newRoleId } });
      if (withinTransaction) {
        await withinTransaction(tx, { previousRoleCode });
      }
      return { previousRoleCode };
    });
  }
}
