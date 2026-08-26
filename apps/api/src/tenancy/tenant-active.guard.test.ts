import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { ExecutionContext } from "@nestjs/common";
import { DomainError } from "@newsaas/shared";
import { TenantActiveGuard } from "./tenant-active.guard.js";
import type { ActiveMembershipResolution } from "./tenant-membership.repository.js";
import { RequestContextService } from "../context/request-context.service.js";

const PROFILE_ID = randomUUID();

function resolution(
  overrides: Partial<ActiveMembershipResolution> = {}
): ActiveMembershipResolution {
  return {
    id: randomUUID(),
    tenantId: randomUUID(),
    userProfileId: PROFILE_ID,
    roleId: randomUUID(),
    roleCode: "OWNER",
    ...overrides,
  };
}

/** Reflector double whose `@Public` answer is configurable per case. */
function makeReflector(isPublic: boolean) {
  return { getAllAndOverride: (): boolean => isPublic };
}

/** Membership-repository double recording the resolver call argument. */
function makeRepo(result: ActiveMembershipResolution | null) {
  const calls: string[] = [];
  return {
    calls,
    resolveActiveForProfile: (
      userProfileId: string
    ): Promise<ActiveMembershipResolution | null> => {
      calls.push(userProfileId);
      return Promise.resolve(result);
    },
  };
}

/**
 * Minimal HTTP-context stand-in: guards only read the request off the switch.
 * Deliberately decoupled from Fastify's deep request types — only the
 * `routeOptions.url` slot this guard consumes is modeled.
 */
function makeExecutionContext(request: { routeOptions?: { url?: string } }): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: <T>() => request as T,
    }),
    // The Reflector call site evaluates [handler, class] BEFORE our double
    // answers — both metadata sources must exist even though they are unused.
    getHandler: (): object => ({}),
    getClass: (): object => ({}),
  } as unknown as ExecutionContext;
}

async function canActivateWith(options: {
  isPublic?: boolean;
  routeOptionsUrl?: string;
  authenticatedProfileId?: string;
  repoResult: ActiveMembershipResolution | null;
}): Promise<{
  result: boolean;
  error: unknown;
  snapshot: ReturnType<RequestContextService["get"]>;
  repoCalls: string[];
}> {
  const ctx = new RequestContextService();
  const repo = makeRepo(options.repoResult);
  const guard = new TenantActiveGuard(
    makeReflector(options.isPublic ?? false) as never,
    ctx,
    repo as never
  );
  const context = makeExecutionContext({
    routeOptions: { url: options.routeOptionsUrl ?? "/memberships" },
  });

  let result = false;
  let error: unknown;
  let snapshot: ReturnType<RequestContextService["get"]>;

  // Mirrors the production lifecycle: guards execute INSIDE the ALS request
  // scope entered by RequestContextMiddleware, so every read/write below sees
  // the same store the real chain would.
  await ctx.run(`req-${randomUUID()}`, () => {
    const exercise = async (): Promise<void> => {
      if (options.authenticatedProfileId) {
        ctx.setUserProfileId(options.authenticatedProfileId);
      }
      try {
        result = await guard.canActivate(context);
      } catch (caught) {
        error = caught;
      }
      snapshot = ctx.get();
    };
    return exercise();
  });

  return { result, error, snapshot: snapshot!, repoCalls: repo.calls };
}

describe("TenantActiveGuard", () => {
  it("skips @Public routes without any membership lookup", async () => {
    const { result, repoCalls } = await canActivateWith({
      isPublic: true,
      repoResult: null,
    });
    expect(result).toBe(true);
    expect(repoCalls).toEqual([]);
  });

  it("skips the /auth/* surface so membership-less sessions keep logout/me", async () => {
    for (const routePattern of ["/auth/login", "/auth/logout", "/auth/me"]) {
      const { result, repoCalls } = await canActivateWith({
        routeOptionsUrl: routePattern,
        authenticatedProfileId: PROFILE_ID,
        repoResult: null,
      });
      expect(result).toBe(true);
      expect(repoCalls).toEqual([]);
    }
  });

  it("fails CLOSED as UNAUTHENTICATED when no identity precedes it (chain contract)", async () => {
    const { error, repoCalls } = await canActivateWith({ repoResult: null });
    expect((error as DomainError).code).toBe("UNAUTHENTICATED");
    expect(repoCalls).toEqual([]);
  });

  it("rejects an authenticated session WITHOUT active membership with FORBIDDEN", async () => {
    // Covers zero memberships; suspended-only sessions resolve identically
    // because the repository matches ACTIVE rows exclusively.
    const { error, repoCalls } = await canActivateWith({
      authenticatedProfileId: PROFILE_ID,
      repoResult: null,
    });
    expect((error as DomainError).code).toBe("FORBIDDEN");
    expect(repoCalls).toEqual([PROFILE_ID]);
  });

  it("populates tenant claims SERVER-SIDE on success and allows the chain through", async () => {
    const expected = resolution();
    const { result, error, snapshot } = await canActivateWith({
      authenticatedProfileId: PROFILE_ID,
      repoResult: expected,
    });
    expect(error).toBeUndefined();
    expect(result).toBe(true);

    expect(snapshot?.userProfileId).toBe(PROFILE_ID);
    expect(snapshot?.tenantId).toBe(expected.tenantId);
    expect(snapshot?.membershipId).toBe(expected.id);
    expect(snapshot?.roleId).toBe(expected.roleId);
    expect(snapshot?.roleCode).toBe(expected.roleCode);
  });
});
