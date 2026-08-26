import { describe, expect, it } from "vitest";
import { DomainError } from "@newsaas/shared";
import { RequestContextMiddleware } from "./request-context.middleware.js";
import { RequestContextService } from "./request-context.service.js";

describe("RequestContextService", () => {
  it("carries the context across async boundaries inside run()", async () => {
    const service = new RequestContextService();

    const observed = await service.run("req-async-1", async () => {
      // Multiple await hops: the ALS store must survive every boundary.
      await Promise.resolve();
      const afterFirstHop = service.get();
      await new Promise<void>((resolve) => setTimeout(resolve, 5));
      return { afterFirstHop, final: service.get() };
    });

    expect(observed.afterFirstHop).toEqual({ requestId: "req-async-1" });
    expect(observed.final).toEqual({ requestId: "req-async-1" });
  });

  it("keeps sibling requests isolated from each other", async () => {
    const service = new RequestContextService();
    const seen: string[] = [];

    const track = (id: string, delayMs: number): Promise<void> =>
      service.run(id, async () => {
        await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
        seen.push(`${id}:${service.getRequestId()}`);
      });

    await Promise.all([track("req-a", 15), track("req-b", 5)]);
    expect(seen.sort()).toEqual(["req-a:req-a", "req-b:req-b"]);
  });

  it("returns safe fallbacks outside any request scope", () => {
    const service = new RequestContextService();

    expect(service.get()).toBeUndefined();
    // Generated UUID keeps correlation helpers total outside requests.
    expect(service.getRequestId()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
  });

  it("restores the outer scope after run() completes", () => {
    const service = new RequestContextService();

    service.run("req-inner", () => {
      expect(service.get()).toBeDefined();
    });

    expect(service.get()).toBeUndefined();
  });

  it("enriches identity and membership progressively", () => {
    const service = new RequestContextService();

    service.run("req-enriched", () => {
      service.setUserProfileId("profile-1");
      service.setTenantMembership({
        tenantId: "tenant-1",
        membershipId: "membership-1",
        roleId: "role-1",
        roleCode: "OWNER",
      });
      expect(service.get()).toEqual({
        requestId: "req-enriched",
        userProfileId: "profile-1",
        tenantId: "tenant-1",
        membershipId: "membership-1",
        roleId: "role-1",
        roleCode: "OWNER",
      });
    });
  });

  it("ignores enrichment when no request scope is active", () => {
    const service = new RequestContextService();
    // Must not throw — background contexts may call setters defensively.
    expect(() => service.setUserProfileId("profile-x")).not.toThrow();
    expect(() =>
      service.setTenantMembership({
        tenantId: "t",
        membershipId: "m",
        roleId: "r",
        roleCode: "OWNER",
      })
    ).not.toThrow();
  });

  it("requireUserProfileId throws UNAUTHENTICATED until a user is set", () => {
    const service = new RequestContextService();

    service.run("req-guarded", () => {
      expect(() => service.requireUserProfileId()).toThrowError(DomainError);
      try {
        service.requireUserProfileId();
      } catch (error) {
        expect((error as DomainError).code).toBe("UNAUTHENTICATED");
      }

      service.setUserProfileId("profile-9");
      expect(service.requireUserProfileId()).toBe("profile-9");
    });

    // Outside request scope the contract still holds.
    expect(() => service.requireUserProfileId()).toThrowError(DomainError);
  });

  it("requireTenantId throws FORBIDDEN until tenancy is resolved", () => {
    const service = new RequestContextService();

    service.run("req-tenant", () => {
      try {
        service.requireTenantId();
        expect.unreachable("expected FORBIDDEN");
      } catch (error) {
        expect((error as DomainError).code).toBe("FORBIDDEN");
      }
    });
  });
});

describe("RequestContextMiddleware", () => {
  it("enters the context with the id stashed by genReqId on the raw request", () => {
    const service = new RequestContextService();
    const middleware = new RequestContextMiddleware(service);
    let nextInsideContext: string | undefined;

    middleware.use({ id: "raw-stashed-id" }, undefined, () => {
      nextInsideContext = service.getRequestId();
    });

    expect(nextInsideContext).toBe("raw-stashed-id");
  });

  it("mints a UUID when the raw request carries no usable id", () => {
    const service = new RequestContextService();
    const middleware = new RequestContextMiddleware(service);
    let observed: string | undefined;

    middleware.use({}, undefined, () => {
      observed = service.getRequestId();
    });

    expect(observed).toMatch(/^[0-9a-f]{8}-/);
  });

  it("runs next() synchronously inside the context", () => {
    const service = new RequestContextService();
    const middleware = new RequestContextMiddleware(service);
    let sawContext = false;
    middleware.use({ id: "sync-check" }, undefined, () => {
      sawContext = service.get()?.requestId === "sync-check";
    });
    expect(sawContext).toBe(true);
  });
});
