import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { DomainError, type RequestContext } from "@newsaas/shared";

/**
 * Mutable ALS store shape. Fields are progressively enriched by server code
 * (middleware → AuthGuard → TenantActiveGuard); the shared `RequestContext`
 * type is the read-side view of the same object.
 */
interface RequestContextStore {
  requestId: string;
  userProfileId?: string;
  tenantId?: string;
  membershipId?: string;
  roleId?: string;
  roleCode?: string;
}

/**
 * Injectable wrapper around {@link AsyncLocalStorage} (design D3).
 *
 * A raw module-global ALS was rejected by design because it cannot be swapped
 * or observed in tests; every consumer therefore injects THIS service, and
 * tests may construct isolated instances freely.
 *
 * Fallbacks outside a request scope (bootstrap, queue/worker contexts) never
 * throw for reads: `getRequestId()` mints a UUID so correlation helpers stay
 * total. The `require*` accessors DO throw domain errors — they encode the
 * post-auth/post-tenancy contracts private routes rely on.
 */
@Injectable()
export class RequestContextService {
  private readonly als = new AsyncLocalStorage<RequestContextStore>();

  /**
   * Runs the callback inside a fresh request context. Called once per request
   * by the ALS-entering middleware; everything downstream (guards, handlers,
   * services) inherits the store through async boundaries automatically.
   */
  run<T>(requestId: string, callback: () => T): T {
    return this.als.run({ requestId }, callback);
  }

  /** Current context snapshot, or undefined when outside any request. */
  get(): RequestContext | undefined {
    const store = this.als.getStore();
    if (!store) return undefined;
    return { ...store };
  }

  /**
   * Identity of the ACTIVE ALS store, or undefined outside any request.
   * Internal seam for per-request memoization (EPIC-02 design D2): consumers
   * key caches on this object so entries are garbage-collected with the
   * request instead of leaking in long-lived maps.
   */
  activeStoreIdentity(): object | undefined {
    return this.als.getStore();
  }

  /** Request ID with a safe generated fallback outside request scope. */
  getRequestId(): string {
    return this.als.getStore()?.requestId ?? randomUUID();
  }

  /** Enriches the context after successful authentication (AuthGuard). */
  setUserProfileId(userProfileId: string): void {
    const store = this.als.getStore();
    if (store) {
      store.userProfileId = userProfileId;
    }
  }

  /**
   * Enriches the context with membership-derived tenancy claims
   * (TenantActiveGuard, tenancy slice). Tenant identity comes exclusively
   * from the session's membership — never from client input. `roleId` rides
   * along as the EPIC-02 enforcement key consumed by PermissionResolver.
   */
  setTenantMembership(membership: {
    tenantId: string;
    membershipId: string;
    roleId: string;
    roleCode: string;
  }): void {
    const store = this.als.getStore();
    if (store) {
      store.tenantId = membership.tenantId;
      store.membershipId = membership.membershipId;
      store.roleId = membership.roleId;
      store.roleCode = membership.roleCode;
    }
  }

  /** Post-authentication contract: throws when no authenticated user exists. */
  requireUserProfileId(): string {
    const userProfileId = this.als.getStore()?.userProfileId;
    if (!userProfileId) {
      throw new DomainError("UNAUTHENTICATED", "Authentication required.");
    }
    return userProfileId;
  }

  /**
   * Post-tenancy contract for tenant-scoped repositories (design D5): throws
   * FORBIDDEN when tenant authority was not resolved server-side.
   */
  requireTenantId(): string {
    const tenantId = this.als.getStore()?.tenantId;
    if (!tenantId) {
      throw new DomainError("FORBIDDEN", "Tenant context was not resolved.");
    }
    return tenantId;
  }

  /**
   * Post-tenancy contract for permission resolution (EPIC-02 design D2):
   * throws FORBIDDEN when the active membership's role id is absent — the
   * PermissionGuard treats that as fail-closed, never as "zero permissions
   * known, allow".
   */
  requireRoleId(): string {
    const roleId = this.als.getStore()?.roleId;
    if (!roleId) {
      throw new DomainError("FORBIDDEN", "Tenant context was not resolved.");
    }
    return roleId;
  }
}
