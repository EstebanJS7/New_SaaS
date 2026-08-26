import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { DomainError } from "@newsaas/shared";
import {
  PermissionResolver,
  type TenantRolePermissionOverrideDelegate,
} from "./permission-resolver.service.js";
import { RequestContextService } from "../context/request-context.service.js";

/** Structural doubles counting queries (design D2: ONE resolution/request). */
function makeDoubles(
  keysByRoleId: Map<string, string[]>,
  overridesByTenantRole: Map<string, { granted: boolean; permissionKey: string }[]>
): {
  rolePermission: {
    findMany: (args: unknown) => Promise<{ permission: { key: string } }[]>;
  };
  tenantRolePermissionOverride: TenantRolePermissionOverrideDelegate;
  baselineCalls: string[];
  overrideCalls: string[];
} {
  const baselineCalls: string[] = [];
  const overrideCalls: string[] = [];
  return {
    baselineCalls,
    overrideCalls,
    rolePermission: {
      findMany: (args: unknown) => {
        const roleId = (args as { where: { roleId: string } }).where.roleId;
        baselineCalls.push(roleId);
        return Promise.resolve(
          (keysByRoleId.get(roleId) ?? []).map((key) => ({ permission: { key } }))
        );
      },
    },
    tenantRolePermissionOverride: {
      findMany: (args) => {
        const key = `${args.where.tenantId}|${args.where.roleId}`;
        overrideCalls.push(key);
        return Promise.resolve(overridesByTenantRole.get(key) ?? []);
      },
    },
  };
}

describe("PermissionResolver (unit)", () => {
  it("merges baseline rows with the TENANT's overrides (effective semantics)", async () => {
    const roleId = randomUUID();
    const tenantId = randomUUID();
    // Baseline {a,b}; tenant grants c, denies b ⇒ effective {a,c}.
    const doubles = makeDoubles(
      new Map([[roleId, ["b.key", "a.key"]]]),
      new Map([
        [
          `${tenantId}|${roleId}`,
          [
            { granted: true, permissionKey: "c.key" },
            { granted: false, permissionKey: "b.key" },
          ],
        ],
      ])
    );
    const ctx = new RequestContextService();

    await ctx.run(`req-${randomUUID()}`, () => {
      ctx.setTenantMembership({
        tenantId,
        membershipId: randomUUID(),
        roleId,
        roleCode: "OWNER",
      });
      return new PermissionResolver(
        {
          rolePermission: doubles.rolePermission,
          tenantRolePermissionOverride: doubles.tenantRolePermissionOverride,
        },
        ctx
      ).resolveForActiveRequest();
    });

    // Baseline lookup keyed by role; overrides lookup keyed by BOTH scopes.
    expect(doubles.baselineCalls).toEqual([roleId]);
    expect(doubles.overrideCalls).toEqual([`${tenantId}|${roleId}`]);
  });

  it("returns exactly the merged effective set", async () => {
    const roleId = randomUUID();
    const tenantId = randomUUID();
    const doubles = makeDoubles(
      new Map([[roleId, ["b.key", "a.key"]]]),
      new Map([
        [
          `${tenantId}|${roleId}`,
          [
            { granted: true, permissionKey: "c.key" },
            { granted: false, permissionKey: "b.key" },
          ],
        ],
      ])
    );
    const ctx = new RequestContextService();
    const resolver = new PermissionResolver(
      {
        rolePermission: doubles.rolePermission,
        tenantRolePermissionOverride: doubles.tenantRolePermissionOverride,
      },
      ctx
    );

    await ctx.run(`req-${randomUUID()}`, () => {
      ctx.setTenantMembership({
        tenantId,
        membershipId: randomUUID(),
        roleId,
        roleCode: "OWNER",
      });
      return resolver.resolveForActiveRequest();
    });

    // Re-run in a fresh request scope to observe the RESOLVED value (the
    // first run's promise was consumed by the callback above).
    const second = await ctx.run(`req-${randomUUID()}`, () => {
      ctx.setTenantMembership({
        tenantId,
        membershipId: randomUUID(),
        roleId,
        roleCode: "OWNER",
      });
      return resolver.resolveForActiveRequest();
    });
    expect(second).toEqual(new Set(["a.key", "c.key"]));
  });

  it("resolves ONCE per request even with multiple consumers (memoized on ALS store)", async () => {
    const roleId = randomUUID();
    const tenantId = randomUUID();
    const doubles = makeDoubles(new Map([[roleId, ["vet.clinical.create"]]]), new Map());
    const ctx = new RequestContextService();
    const resolver = new PermissionResolver(
      {
        rolePermission: doubles.rolePermission,
        tenantRolePermissionOverride: doubles.tenantRolePermissionOverride,
      },
      ctx
    );

    await ctx.run(`req-${randomUUID()}`, async () => {
      ctx.setTenantMembership({
        tenantId,
        membershipId: randomUUID(),
        roleId,
        roleCode: "OWNER",
      });
      const first = await resolver.resolveForActiveRequest();
      const second = await resolver.resolveForActiveRequest();
      expect(first).toEqual(second);
      expect(first).toEqual(new Set(["vet.clinical.create"]));
    });

    expect(doubles.baselineCalls).toEqual([roleId]);
    expect(doubles.overrideCalls).toEqual([`${tenantId}|${roleId}`]);
  });

  it("does NOT leak memoized keys across requests (fresh store, fresh query)", async () => {
    const roleIdA = randomUUID();
    const roleIdB = randomUUID();
    const doubles = makeDoubles(
      new Map([
        [roleIdA, ["a.key"]],
        [roleIdB, ["b.key"]],
      ]),
      new Map()
    );
    const ctx = new RequestContextService();
    const resolver = new PermissionResolver(
      {
        rolePermission: doubles.rolePermission,
        tenantRolePermissionOverride: doubles.tenantRolePermissionOverride,
      },
      ctx
    );

    const runRequest = (): Promise<Set<string>> =>
      ctx.run(`req-${randomUUID()}`, () => {
        ctx.setTenantMembership({
          tenantId: randomUUID(),
          membershipId: randomUUID(),
          roleId: roleIdB,
          roleCode: "OWNER",
        });
        return resolver.resolveForActiveRequest();
      });

    await ctx.run(`req-first-${randomUUID()}`, () => {
      ctx.setTenantMembership({
        tenantId: randomUUID(),
        membershipId: randomUUID(),
        roleId: roleIdA,
        roleCode: "OWNER",
      });
      return resolver.resolveForActiveRequest();
    });
    const second = await runRequest();

    expect(second).toEqual(new Set(["b.key"]));
    expect(doubles.baselineCalls).toEqual([roleIdA, roleIdB]);
  });

  it("throws FORBIDDEN when no membership context exists — never an empty allow", async () => {
    const doubles = makeDoubles(new Map(), new Map());
    const ctx = new RequestContextService();

    const outcome: unknown = await ctx.run(`req-${randomUUID()}`, async () => {
      try {
        await new PermissionResolver(
          {
            rolePermission: doubles.rolePermission,
            tenantRolePermissionOverride: doubles.tenantRolePermissionOverride,
          },
          ctx
        ).resolveForActiveRequest();
        return "resolved";
      } catch (error) {
        return error;
      }
    });

    expect(outcome).toBeInstanceOf(DomainError);
    expect((outcome as DomainError).code).toBe("FORBIDDEN");
    expect(doubles.baselineCalls).toEqual([]);
    expect(doubles.overrideCalls).toEqual([]);
  });
});
