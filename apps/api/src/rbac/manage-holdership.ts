import { DomainError } from "@newsaas/shared";

/**
 * UNIFIED STRANDING PREDICATE (composition-gap fix, re-judge 2026-08-26).
 *
 * One invariant serves BOTH administration flows that can change which ACTIVE
 * memberships effectively hold the governance key:
 *
 * - the tenant override-replace command (`rbac-admin.service.ts`);
 * - the membership role-assignment command (`tenant-membership.repository.ts`).
 *
 * INVARIANT: after the commanded write, at least one ACTIVE membership of the
 * tenant must hold a role whose EFFECTIVE permission set (platform baseline
 * ⊕ that tenant's override verdicts) contains `users.membership.manage`.
 *
 * HISTORY: the two flows previously used DIFFERENT predicates — effective-
 * holdership on the override path versus administrator-class SEAT COUNTING on
 * the assignment path. Seat counting cannot see override denials, so stripping
 * the key from ADMIN via an override and then demoting the OWNER passed both
 * checks individually while composing into a permanently locked-out tenant
 * (zero effective holders ⇒ every `/rbac/*` and `/memberships*` route 403s
 * forever). This module is the single shared implementation; the retired
 * seat-count logic must not be reintroduced.
 */

/** Catalog key whose holder can administer memberships/roles of a tenant. */
export const MEMBERSHIP_MANAGE_KEY = "users.membership.manage";

/** Single stable message behind every stranding 409 — byte-equivalence by construction. */
export const LAST_MANAGER_CONFLICT_MESSAGE =
  "Cannot remove the last effective holder of users.membership.manage from the tenant.";

/**
 * Applies DEC-003 override semantics to one role's baseline key set:
 * effective = (baseline ∪ granted=true) − granted=false.
 */
export function applyOverrides(
  baseline: Iterable<string>,
  overrides: readonly { roleId: string; permissionKey: string; granted: boolean }[],
  roleId: string
): Set<string> {
  const keys = new Set(baseline);
  for (const override of overrides) {
    if (override.roleId !== roleId) continue;
    if (override.granted) {
      keys.add(override.permissionKey);
    } else {
      keys.delete(override.permissionKey);
    }
  }
  return keys;
}

/** Structural transaction contract consumed by this module. Both callers'
 * transaction handles (`RbacAdminTx` and the generated
 * `Prisma.TransactionClient`) satisfy it structurally. */
export interface ManageHoldershipTx {
  tenantMembership: {
    findMany: (args: {
      where: { tenantId: string; status: string };
    }) => Promise<{ id: string; roleId: string }[]>;
  };
  rolePermission: {
    findMany: (args: {
      where: { roleId: string };
      select?: unknown;
    }) => Promise<{ permission: { key: string } }[]>;
  };
  tenantRolePermissionOverride: {
    findMany: (args: {
      where: { tenantId?: string; roleId?: string };
    }) => Promise<{ roleId: string; permissionKey: string; granted: boolean }[]>;
  };
}

/** Raw-SQL seam for the shared SELECT ... FOR UPDATE serialization lock. */
export interface LockingTx {
  $queryRaw: (query: TemplateStringsArray, ...values: unknown[]) => Promise<unknown[]>;
}

/**
 * Locking protocol (review CRITICAL-2): SELECT ... FOR UPDATE every ACTIVE
 * membership row of the current tenant FIRST, decide SECOND. The row set is
 * deliberately broader than administrator-class roles because a non-admin
 * role can hold `users.membership.manage` through a tenant override. Both
 * mutation flows therefore serialize on the same tenant-wide, deterministic
 * lock order before evaluating effective holdership or mutating state.
 *
 * The stranding predicate below also scans ALL active members: effective
 * holdership is decided by permission sets, not by seat class. The in-memory
 * fake cannot prove READ COMMITTED interleaving/serialization; that live-PG
 * evidence remains explicitly deferred to TD-006.
 */
export async function lockActiveMembershipRows(tx: LockingTx, tenantId: string): Promise<void> {
  await tx.$queryRaw`
    SELECT "id"
    FROM "tenant_membership"
    WHERE "tenant_id" = ${tenantId}::uuid
      AND "status" = 'ACTIVE'
    ORDER BY "id" ASC
    FOR UPDATE`;
}

/**
 * Options expressing the POST-WRITE membership view a command must be judged
 * against WITHOUT having written yet (callers evaluate before their own write
 * so a rejection leaves nothing behind even where the transaction boundary
 * cannot roll back in-memory fakes).
 */
export interface EffectiveHoldershipView {
  /** Memberships being rewritten by the in-flight command: their CURRENT role must not count as retention. */
  readonly excludeMembershipIds?: readonly string[];
  /** Role(s) those excluded memberships are being moved TO — post-write candidates. */
  readonly candidateRoleIds?: readonly string[];
  /** Roles losing the manage key via the in-flight override rewrite: their CURRENT members cannot retain through them. */
  readonly excludeRoleIds?: readonly string[];
}

/**
 * Throws `CONFLICT` unless, in the post-write view implied by `view`, some
 * ACTIVE membership of `tenantId` holds a role whose EFFECTIVE permission set
 * contains `users.membership.manage`. MUST run inside the caller's transaction
 * (after the shared FOR UPDATE lock, before the caller's write/audit append),
 * so a rejection strands nothing and emits no audit row.
 */
export async function assertEffectiveManageHolderExists(
  tx: ManageHoldershipTx,
  tenantId: string,
  view: EffectiveHoldershipView = {}
): Promise<void> {
  const memberships = await tx.tenantMembership.findMany({
    where: { tenantId, status: "ACTIVE" },
  });

  // Candidate role universe = roles of surviving active memberships ⊕ the
  // explicit post-write candidates − rewritten-away roles.
  const candidateRoleIds = new Set<string>(view.candidateRoleIds ?? []);
  for (const membership of memberships) {
    if (view.excludeMembershipIds?.includes(membership.id)) continue;
    if (view.excludeRoleIds?.includes(membership.roleId)) continue;
    candidateRoleIds.add(membership.roleId);
  }

  for (const roleId of candidateRoleIds) {
    const mappings = await tx.rolePermission.findMany({
      where: { roleId },
      select: { permission: { select: { key: true } } },
    });
    const overrides = await tx.tenantRolePermissionOverride.findMany({
      where: { tenantId, roleId },
    });
    if (
      applyOverrides(
        mappings.map((row) => row.permission.key),
        overrides,
        roleId
      ).has(MEMBERSHIP_MANAGE_KEY)
    ) {
      return; // retained — post-write state keeps a governance holder.
    }
  }

  throw new DomainError("CONFLICT", LAST_MANAGER_CONFLICT_MESSAGE);
}
