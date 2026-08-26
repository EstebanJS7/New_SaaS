import { Inject, Injectable } from "@nestjs/common";
// Value import (not `import type`): the DI token must exist at runtime.
import { PrismaService } from "@newsaas/database";
import { RequestContextService } from "../context/request-context.service.js";

/** Structural delegate contract (generated client and test fakes alike). */
export interface RolePermissionDelegate {
  findMany: (args: {
    where: { roleId: string };
    select: { permission: { select: { key: true } } };
  }) => Promise<{ permission: { key: string } }[]>;
}

/** Tenant-local override verdicts over global role baselines (DEC-003). */
export interface TenantRolePermissionOverrideDelegate {
  findMany: (args: {
    where: { tenantId: string; roleId: string };
  }) => Promise<{ granted: boolean; permissionKey: string }[]>;
}

/**
 * Resolves the EFFECTIVE permission-key set of the ACTIVE membership's role
 * for the ACTIVE tenant — the single EPIC-02 authority lookup (design D2,
 * review CRITICAL-1 resolution).
 *
 * Effective semantics (DEC-003):
 *
 *   effective(tenant, role) =
 *     (role_permission baseline ∪ overrides granted=true)
 *     − overrides granted=false
 *
 * Baseline rows are GLOBAL platform data; overrides are TENANT-local rows.
 * Merging them here means enforcement always evaluates the caller's own
 * tenant reality — no request can ever be authorized by another tenant's
 * configuration.
 *
 * Contract:
 * - ONE resolution per request: the baseline lookup (index-covered by
 *   role_permission's leading unique column) and the tenant-scoped override
 *   lookup (indexed by (tenant_id, role_id)) run together ONCE and are
 *   memoized on the request's ALS store identity, so the guard and any
 *   in-request re-assertion share one resolution instead of racing the
 *   database twice.
 * - No cache across requests in v1 (design D2 escape hatch: Redis keyed by
 *   (tenantId, roleId), deferred per complexity budget).
 * - Zero permissions is a VALID outcome; absence of tenant/role context is a
 *   chain-contract violation handled by `requireTenantId()`/`requireRoleId()`
 *   (the guard asserts all three contexts BEFORE any resolver interaction).
 */
@Injectable()
export class PermissionResolver {
  /** Per-request memo: store object → resolved key set promise (GC'd with it). */
  private readonly memo = new WeakMap<object, Promise<Set<string>>>();

  constructor(
    @Inject(PrismaService)
    private readonly prisma: {
      rolePermission: RolePermissionDelegate;
      tenantRolePermissionOverride: TenantRolePermissionOverrideDelegate;
    },
    private readonly requestContext: RequestContextService
  ) {}

  /**
   * Resolves the active role's EFFECTIVE permission keys for the CURRENT
   * request/tenant. Throws FORBIDDEN when no membership/role context was
   * resolved upstream — callers never see an ambiguous "empty because
   * unresolved" result.
   */
  async resolveForActiveRequest(): Promise<Set<string>> {
    const roleId = this.requestContext.requireRoleId();
    const tenantId = this.requestContext.requireTenantId();

    const store = this.requestContext.activeStoreIdentity();
    if (store) {
      const cached = this.memo.get(store);
      if (cached) {
        return cached;
      }
      const pending = this.queryEffectiveKeys(roleId, tenantId);
      this.memo.set(store, pending);
      return pending;
    }

    // Outside a request scope (bootstrap, jobs): resolve uncached.
    return this.queryEffectiveKeys(roleId, tenantId);
  }

  private async queryEffectiveKeys(roleId: string, tenantId: string): Promise<Set<string>> {
    // Both lookups are indexed and independent — issue them together so the
    // "single resolution per request" pattern stays one round-trip deep.
    const [baselineRows, overrides] = await Promise.all([
      this.prisma.rolePermission.findMany({
        where: { roleId },
        select: { permission: { select: { key: true } } },
      }),
      this.prisma.tenantRolePermissionOverride.findMany({ where: { tenantId, roleId } }),
    ]);

    const keys = new Set(baselineRows.map((row) => row.permission.key));
    for (const override of overrides) {
      if (override.granted) {
        keys.add(override.permissionKey);
      } else {
        keys.delete(override.permissionKey);
      }
    }
    return keys;
  }
}
