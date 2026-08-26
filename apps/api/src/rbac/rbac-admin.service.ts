import { Inject, Injectable } from "@nestjs/common";
// Value imports (not `import type`): DI tokens, seed constants and the Prisma
// SQL helpers must exist at runtime.
import { PERMISSION_SEEDS, ROLE_SEEDS, PrismaService } from "@newsaas/database";
import { DomainError } from "@newsaas/shared";
import { RequestContextService } from "../context/request-context.service.js";
import { AuditAppendTx, AuditWriter } from "../audit/audit-writer.service.js";
import {
  MEMBERSHIP_MANAGE_KEY,
  applyOverrides,
  assertEffectiveManageHolderExists,
  lockActiveMembershipRows,
} from "./manage-holdership.js";

/** Public read model: one seeded role with its TENANT-EFFECTIVE key set. */
export interface RoleWithPermissionsDto {
  readonly code: string;
  readonly name: string;
  /** Sorted, deduplicated EFFECTIVE catalog keys for the caller's tenant. */
  readonly permissions: string[];
}

/** Public read model: one immutable catalog entry (seed-owned code). */
export interface PermissionCatalogEntryDto {
  readonly key: string;
  readonly name: string;
}

/** Response of a successful tenant permission-set replacement. */
export interface RolePermissionsReplacedDto {
  readonly code: string;
  readonly permissions: string[];
}

/** Structural delegate contract (generated client and test fakes alike). */
export interface RbacAdminRoleRow {
  readonly id: string;
  readonly code: string;
  readonly name: string;
}

export interface RbacAdminRoleDelegate {
  findUnique: (args: { where: { code: string } }) => Promise<RbacAdminRoleRow | null>;
  findMany: (args: {
    where?: { code?: { in?: readonly string[] } };
  }) => Promise<RbacAdminRoleRow[]>;
}

export interface RbacAdminPermissionRow {
  readonly id: string;
  readonly key: string;
  readonly name: string;
}

export interface RbacAdminPermissionDelegate {
  findMany: (args: {
    where?: { key?: { in?: readonly string[] } };
    orderBy?: { key?: "asc" | "desc" };
  }) => Promise<RbacAdminPermissionRow[]>;
}

export interface RbacAdminRolePermissionDelegate {
  findMany: (args: {
    where: { roleId: string };
    select?: unknown;
  }) => Promise<{ permission: { key: string } }[]>;
}

/** Tenant-local override verdict row (DEC-003 layer). */
export interface RbacAdminOverrideRow {
  readonly roleId: string;
  readonly permissionKey: string;
  readonly granted: boolean;
}

export interface RbacAdminOverrideDelegate {
  findMany: (args: {
    where: { tenantId?: string; roleId?: string };
  }) => Promise<RbacAdminOverrideRow[]>;
  deleteMany: (args: {
    where: { tenantId?: string; roleId?: string };
  }) => Promise<{ count: number }>;
  create: (args: {
    data: { tenantId: string; roleId: string; permissionKey: string; granted: boolean };
  }) => Promise<{ id: string }>;
}

/** Narrow read consumed by the shared stranding predicate via RbacAdminTx. */
export interface RbacAdminMembershipDelegate {
  findMany: (args: {
    where: {
      tenantId: string;
      status: string;
      roleId?: { in: readonly string[] };
    };
  }) => Promise<{ id: string; roleId: string }[]>;
}

/**
 * Transactional view handed to the replace-set callback. Mirrors the slice of
 * `Prisma.TransactionClient` this service actually touches ($queryRaw IS
 * permitted inside interactive transactions).
 */
export interface RbacAdminTx {
  rolePermission: RbacAdminRolePermissionDelegate;
  tenantRolePermissionOverride: RbacAdminOverrideDelegate;
  tenantMembership: RbacAdminMembershipDelegate;
  /** In-transaction audit writer seam (see AuditAppendTx). */
  auditLog: AuditAppendTx["auditLog"];
  $queryRaw: (query: TemplateStringsArray, ...values: unknown[]) => Promise<unknown[]>;
}

export interface RbacAdminPrisma {
  $transaction: <T>(work: (tx: RbacAdminTx) => Promise<T>) => Promise<T>;
  role: RbacAdminRoleDelegate;
  permission: RbacAdminPermissionDelegate;
  rolePermission: RbacAdminRolePermissionDelegate;
  tenantRolePermissionOverride: RbacAdminOverrideDelegate;
}

const ROLE_CODES: readonly string[] = ROLE_SEEDS.map((role) => role.code);
const CATALOG_KEYS: ReadonlySet<string> = new Set(PERMISSION_SEEDS.map((entry) => entry.key));

/**
 * Audited RBAC administration core for the ROLE/CATALOG side of the surface
 * (EPIC-02 design D3, spec: rbac-administration, architecture per DEC-003):
 * listings plus the audited tenant-override replace command. Membership role
 * assignment lives with its aggregate in
 * `tenancy/membership-role-assignment.service.ts`.
 *
 * ARCHITECTURE (review CRITICAL-1 resolution, maintainer-authorized
 * 2026-08-25): roles stay GLOBAL reference data and `role_permission` rows are
 * the platform BASELINE owned by the seed. What administrators configure here
 * is the TENANT-LOCAL override layer (`tenant_role_permission_override`) —
 * every write is scoped by the server-resolved `ctx.tenantId`, so rewriting
 * another tenant's authority is structurally impossible (no route accepts a
 * tenant parameter and no global mutable mapping row exists anymore).
 *
 * Invariants enforced here:
 * - The six PRD §9 roles are the ONLY addressable aggregates — anything else
 *   is NOT_FOUND, and no route anywhere creates/edits/deletes Role or
 *   Permission records themselves (catalog stays seed-owned CODE).
 * - Payloads validate against the seeded catalog BEFORE any write; an unknown
 *   key leaves the stored state byte-identical.
 * - Removing `users.membership.manage` from a role is rejected with 409 when
 *   the commanded post-write state would strand the tenant with zero ACTIVE
 *   members whose role EFFECTIVELY holds that key (shared unified stranding
 *   predicate in `manage-holdership.ts`, evaluated INSIDE the transaction
 *   under the shared FOR UPDATE all-active-membership lock — review
 *   CRITICAL-2 and the
 *   composition-gap fix of the 2026-08-26 re-judge).
 * - Exactly ONE audit row per mutation (`rbac.role_permissions_overridden`)
 *   appended INSIDE the transaction (review WARNING-1) with a sorted
 *   before/after EFFECTIVE-set diff; reads emit nothing.
 */
@Injectable()
export class RbacAdminService {
  constructor(
    @Inject(PrismaService) private readonly prisma: RbacAdminPrisma,
    private readonly audit: AuditWriter,
    private readonly requestContext: RequestContextService
  ) {}

  /**
   * Lists exactly the six seeded roles with their EFFECTIVE key sets for the
   * CALLER'S tenant (baseline merged with that tenant's overrides). Roles
   * outside the seeded code set (if any ever appear in data) are deliberately
   * excluded: the addressable RBAC universe is the fixed catalog.
   */
  async listRoles(): Promise<RoleWithPermissionsDto[]> {
    const tenantId = this.requestContext.requireTenantId();
    const roles = await this.prisma.role.findMany({
      where: { code: { in: ROLE_CODES } },
    });
    const keysByRoleId = new Map<string, string[]>();
    // ONE tenant-scoped overrides query serves every listed role; baselines
    // use the established per-role indexed reads (administration reads are
    // rare and never on the enforcement hot path — design D2 budget applies
    // to THE guard resolution, which stays its own single pattern).
    const overrides = await this.prisma.tenantRolePermissionOverride.findMany({
      where: { tenantId },
    });
    for (const role of roles) {
      const mappings = await this.prisma.rolePermission.findMany({
        where: { roleId: role.id },
        select: { permission: { select: { key: true } } },
      });
      const baseline = mappings.map((row) => row.permission.key);
      keysByRoleId.set(role.id, [...applyOverrides(baseline, overrides, role.id)].sort());
    }
    return ROLE_SEEDS.map((seed) => {
      const role = roles.find((candidate) => candidate.code === seed.code);
      return {
        code: seed.code,
        name: role?.name ?? seed.name,
        permissions: keysByRoleId.get(role?.id ?? "") ?? [],
      };
    });
  }

  /** Immutable permission catalog listing (seed-owned code, sorted by key). */
  async listPermissions(): Promise<PermissionCatalogEntryDto[]> {
    const rows = await this.prisma.permission.findMany({ orderBy: { key: "asc" } });
    return rows
      .map((row) => ({ key: row.key, name: row.name }))
      .sort((left, right) => left.key.localeCompare(right.key));
  }

  /**
   * Atomically REPLACES the CALLER'S TENANT effective permission set for one
   * seeded role, materialized as override verdicts derived against the
   * platform baseline: requested−baseline becomes granted=true rows,
   * baseline−requested becomes granted=false rows. Validation order is
   * deliberate: unknown role code ⇒ 404 first; unknown catalog keys ⇒
   * VALIDATION_FAILED with stored state UNTOUCHED; then the whole operation —
   * override rewrite, last-manager check, audit append — runs inside ONE
   * transaction (review WARNING-1), so a mutation can never exist without its
   * trail and a rejected write leaves nothing behind.
   *
   * Cross-tenant safety: the scope comes exclusively from
   * `requestContext.requireTenantId()` (server-resolved ALS authority); no
   * route input can influence WHICH tenant's overrides are replaced.
   */
  async replaceRolePermissions(
    code: string,
    requestedKeys: string[]
  ): Promise<RolePermissionsReplacedDto> {
    const tenantId = this.requestContext.requireTenantId();

    if (!ROLE_CODES.includes(code)) {
      throw new DomainError("NOT_FOUND", "Role not found.");
    }

    const uniqueKeys = [...new Set(requestedKeys)];
    const unknownKeys = uniqueKeys.filter((key) => !CATALOG_KEYS.has(key));
    if (unknownKeys.length > 0) {
      throw new DomainError(
        "VALIDATION_FAILED",
        `Unknown permission keys: ${unknownKeys.slice(0, 5).join(", ")}.`
      );
    }

    const role = await this.prisma.role.findUnique({ where: { code } });
    if (!role) {
      throw new DomainError("NOT_FOUND", "Role not found.");
    }

    const permissionRows =
      uniqueKeys.length > 0
        ? await this.prisma.permission.findMany({
            where: { key: { in: uniqueKeys } },
          })
        : [];
    // Catalog constant and database must agree; a missing row means an
    // unseeded environment and MUST NOT degrade into a partial replace.
    if (permissionRows.length !== uniqueKeys.length) {
      throw new DomainError(
        "VALIDATION_FAILED",
        "Permission catalog is out of sync with the reference seed."
      );
    }

    const { after } = await this.prisma.$transaction(async (tx) => {
      // W1 HARDENING: acquire the shared FOR UPDATE lock BEFORE reading the
      // current overrides. Deciding `before`/`removesManage` from a pre-lock
      // snapshot would let a committed concurrent change vanish from this
      // decision; locking first makes every subsequent read final for it.
      await lockActiveMembershipRows(tx, tenantId);

      const baselineRows = await tx.rolePermission.findMany({
        where: { roleId: role.id },
        select: { permission: { select: { key: true } } },
      });
      const baseline = baselineRows.map((row) => row.permission.key);

      const currentOverrides = await tx.tenantRolePermissionOverride.findMany({
        where: { tenantId, roleId: role.id },
      });
      const before = [...applyOverrides(baseline, currentOverrides, role.id)].sort();
      const afterSet = new Set(uniqueKeys);

      // LAST-MANAGER TRIGGER: only fires when THIS write removes the manage
      // key from the role's effective set. The retention decision itself is
      // delegated to the SHARED stranding predicate below — never re-derive
      // it here.
      const removesManage =
        before.includes(MEMBERSHIP_MANAGE_KEY) && !afterSet.has(MEMBERSHIP_MANAGE_KEY);

      // UNIFIED STRANDING PREDICATE (composition-gap fix): evaluated against
      // the post-write view BEFORE any row is rewritten, so a rejection leaves
      // stored state byte-identical under real rollback AND under the
      // in-memory fake. Members of the overridden role cannot count as
      // retainers: their post-write set is exactly `afterSet`, which by
      // premise lacks the manage key.
      if (removesManage) {
        await assertEffectiveManageHolderExists(tx, tenantId, {
          excludeRoleIds: [role.id],
        });
      }

      // Full OVERRIDE-SET replace: clear the tenant's verdicts for this role,
      // then materialize the diff against the baseline. Deterministic order:
      // sort by key so identical payloads produce identical stored order.
      await tx.tenantRolePermissionOverride.deleteMany({ where: { tenantId, roleId: role.id } });
      const grantKeys = uniqueKeys.filter((key) => !baseline.includes(key)).sort();
      const denyKeys = [...new Set(baseline)].filter((key) => !afterSet.has(key)).sort();
      for (const key of grantKeys) {
        await tx.tenantRolePermissionOverride.create({
          data: { tenantId, roleId: role.id, permissionKey: key, granted: true },
        });
      }
      for (const key of denyKeys) {
        await tx.tenantRolePermissionOverride.create({
          data: { tenantId, roleId: role.id, permissionKey: key, granted: false },
        });
      }

      // Audit rides INSIDE the transaction (review WARNING-1): the append and
      // the override rewrite commit atomically or not at all.
      await this.audit.append(
        {
          action: "rbac.role_permissions_overridden",
          tenantId,
          actorUserProfileId: this.requestContext.requireUserProfileId(),
          targetType: "role",
          targetId: role.id,
          metadata: { before, after: [...afterSet].sort() },
        },
        tx
      );

      return { before, after: [...afterSet].sort() };
    });

    return { code: role.code, permissions: after };
  }
}
