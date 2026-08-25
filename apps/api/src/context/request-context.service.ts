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
   * from the session's membership — never from client input.
   */
  setTenantMembership(membership: {
    tenantId: string;
    membershipId: string;
    roleCode: string;
  }): void {
    const store = this.als.getStore();
    if (store) {
      store.tenantId = membership.tenantId;
      store.membershipId = membership.membershipId;
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
}
