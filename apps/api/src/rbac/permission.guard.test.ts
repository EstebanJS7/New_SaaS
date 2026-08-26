import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { ExecutionContext } from "@nestjs/common";
import { DomainError } from "@newsaas/shared";
import { PermissionGuard } from "./permission.guard.js";
import { REQUIRE_PERMISSIONS_KEY } from "./require-permissions.decorator.js";
import { RequestContextService } from "../context/request-context.service.js";

/**
 * Unit contract of the THIRD chain link (EPIC-02 design D1): three-state
 * metadata handling, AND semantics, and fail-closed behavior when upstream
 * context is missing (mis-wiring defense). Runtime discrimination over real
 * HTTP lives in permission-enforcement.integration.test.ts and the probe.
 */

interface RouteMeta {
  isPublic?: boolean;
  permissions?: string[] | null;
}

function makeReflector(meta: RouteMeta) {
  return {
    getAllAndOverride: (key: string): unknown => {
      if (key === "ns:is-public-route") return meta.isPublic ?? false;
      if (key === REQUIRE_PERMISSIONS_KEY) return meta.permissions;
      return undefined;
    },
  };
}

function makeResolver(keys = new Set<string>()) {
  const calls: string[] = [];
  return {
    calls,
    resolveForActiveRequest: (): Promise<Set<string>> => {
      calls.push("resolve");
      return Promise.resolve(keys);
    },
  };
}

function makeExecutionContext(routeOptionsUrl = "/memberships"): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: <T>() => ({ routeOptions: { url: routeOptionsUrl } }) as T,
    }),
    getHandler: (): object => ({}),
    getClass: (): object => ({}),
  } as unknown as ExecutionContext;
}

async function canActivateWith(options: {
  meta: RouteMeta;
  resolvedKeys?: Set<string>;
  authenticatedProfileId?: string;
  membership?: { tenantId?: string; membershipId?: string; roleId?: string; roleCode?: string };
  routeOptionsUrl?: string;
}): Promise<{ result: boolean; error: unknown; resolverCalls: string[] }> {
  const ctx = new RequestContextService();
  const resolver = makeResolver(options.resolvedKeys ?? new Set());
  const guard = new PermissionGuard(makeReflector(options.meta) as never, ctx, resolver as never);
  const context = makeExecutionContext(options.routeOptionsUrl);

  let result = false;
  let error: unknown;

  await ctx.run(`req-${randomUUID()}`, async () => {
    if (options.authenticatedProfileId !== undefined) {
      ctx.setUserProfileId(options.authenticatedProfileId);
    }
    if (options.membership) {
      ctx.setTenantMembership({
        tenantId: options.membership.tenantId ?? randomUUID(),
        membershipId: options.membership.membershipId ?? randomUUID(),
        roleId: options.membership.roleId ?? randomUUID(),
        roleCode: options.membership.roleCode ?? "OWNER",
      });
    }
    try {
      result = await guard.canActivate(context);
    } catch (caught) {
      error = caught;
    }
  });

  return { result, error, resolverCalls: resolver.calls };
}

describe("PermissionGuard (unit)", () => {
  it("skips @Public routes without resolving anything", async () => {
    const { result, error, resolverCalls } = await canActivateWith({
      meta: { isPublic: true },
    });
    expect(error).toBeUndefined();
    expect(result).toBe(true);
    expect(resolverCalls).toEqual([]);
  });

  it("skips the /auth/* surface with the same parity as upstream guards", async () => {
    for (const pattern of ["/auth", "/auth/login", "/auth/me", "/auth/logout"]) {
      const { result, resolverCalls } = await canActivateWith({
        meta: {},
        routeOptionsUrl: pattern,
        // Even a FULLY unauthenticated request must pass /auth/* here —
        // login itself is anonymous; deeper guards do not apply.
        authenticatedProfileId: undefined,
      });
      expect(result, pattern).toBe(true);
      expect(resolverCalls).toEqual([]);
    }
  });

  it("DENIES an undeclared private route pre-handler (deny-by-default)", async () => {
    const { error, resolverCalls } = await canActivateWith({
      meta: { permissions: null },
      authenticatedProfileId: randomUUID(),
      membership: {},
    });
    expect((error as DomainError).code).toBe("FORBIDDEN");
    expect(resolverCalls).toEqual([]);
  });

  it("allows an EXPLICIT EMPTY declaration as authenticated-only (no resolution)", async () => {
    const { result, error, resolverCalls } = await canActivateWith({
      meta: { permissions: [] },
      authenticatedProfileId: randomUUID(),
      membership: {},
    });
    expect(error).toBeUndefined();
    expect(result).toBe(true);
    expect(resolverCalls).toEqual([]);
  });

  it("fails CLOSED as UNAUTHENTICATED when no identity precedes it", async () => {
    const { error, resolverCalls } = await canActivateWith({
      meta: { permissions: ["users.membership.manage"] },
    });
    expect((error as DomainError).code).toBe("UNAUTHENTICATED");
    expect(resolverCalls).toEqual([]);
  });

  it("fails CLOSED as FORBIDDEN when tenant/role context is missing (mis-wiring)", async () => {
    const { error, resolverCalls } = await canActivateWith({
      meta: { permissions: ["users.membership.manage"] },
      authenticatedProfileId: randomUUID(),
    });
    expect((error as DomainError).code).toBe("FORBIDDEN");
    expect(resolverCalls).toEqual([]);
  });

  it("allows when EVERY declared key resolves (subset/AND semantics)", async () => {
    const keys = new Set(["vet.clinical.create", "cash.session.close"]);
    const { result, error, resolverCalls } = await canActivateWith({
      meta: { permissions: ["vet.clinical.create", "cash.session.close"] },
      resolvedKeys: keys,
      authenticatedProfileId: randomUUID(),
      membership: {},
    });
    expect(error).toBeUndefined();
    expect(result).toBe(true);
    expect(resolverCalls).toEqual(["resolve"]);
  });

  it("denies when ONE of multiple declared keys is missing (no OR variant)", async () => {
    const keys = new Set(["vet.clinical.create"]);
    const { error, resolverCalls } = await canActivateWith({
      meta: { permissions: ["vet.clinical.create", "cash.session.close"] },
      resolvedKeys: keys,
      authenticatedProfileId: randomUUID(),
      membership: {},
    });
    expect((error as DomainError).code).toBe("FORBIDDEN");
    expect(resolverCalls).toEqual(["resolve"]);
  });
});
