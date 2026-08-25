import { Injectable } from "@nestjs/common";
import { PrismaService } from "@newsaas/database";
import { DomainError } from "@newsaas/shared";
import { RequestContextService } from "../context/request-context.service.js";

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
 * Result of the pre-tenancy resolver query (TenantActiveGuard): the one
 * lookup that may run BEFORE a tenant is known, because its whole purpose is
 * discovering which tenant the caller belongs to.
 */
export interface ActiveMembershipResolution {
  id: string;
  tenantId: string;
  userProfileId: string;
  roleCode: string;
}

interface MembershipRowShape {
  id: string;
  tenantId: string;
  userProfileId: string;
  roleId: string;
  status: string;
  role?: { code?: string };
}

/** Single stable message behind every membership 404 — byte-equivalence by construction. */
const MEMBERSHIP_NOT_FOUND_MESSAGE = "Membership not found.";

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
      include: { role: { select: { code: true } } },
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
}
