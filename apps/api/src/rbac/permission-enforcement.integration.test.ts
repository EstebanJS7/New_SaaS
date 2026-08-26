import { Controller, Get } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import supertest from "supertest";
import { PERMISSION_SEEDS } from "@newsaas/database";
import { bootTestApp, type BootedTestApp } from "../../test/support/boot-test-app.js";
import { RequirePermissions } from "./require-permissions.decorator.js";
import {
  seedRbacActor,
  seedRoleWithKeys,
  type RbacActor,
  type SeededRbacRole,
} from "../../test/support/rbac-fixture.js";

interface ErrorEnvelopeBody {
  error: { code: string; message: string; requestId: string };
}

const MANAGE_KEY = "users.membership.manage";

/**
 * ENFORCEMENT BEHAVIOR SUITE (EPIC-02 task 1.8, spec: rbac-enforcement) —
 * real HTTP through the production guard chain. The unit contract lives in
 * permission.guard.test.ts; here every scenario is proven against a booted
 * AppModule so wiring, resolution and envelope mapping are all in play:
 *
 * 1. single key denies members lacking it (and grants admit — data-driven);
 * 2. two declared keys = AND: holding one still 403;
 * 3. a request reaching the chain without membership context fails CLOSED;
 * 4. ADMIN authority is DATA: revoking one seeded key from a fully-granted
 *    role flips the matching route to 403 (no roleCode bypass branch).
 */

describe("single-key enforcement over real HTTP", () => {
  let booted: BootedTestApp;

  beforeAll(async () => {
    booted = await bootTestApp();
  });

  afterAll(async () => {
    await booted.close();
  });

  function seedActorWithKeys(email: string, keys: string[]): { actor: RbacActor } {
    const role = seedRoleWithKeys(
      booted.db,
      `SK-${email.slice(0, 12)}`,
      "Single-key fixture",
      keys
    );
    const tenant = booted.db.prisma.tenant.create({
      data: { slug: `sk-${email.slice(0, 16)}`, name: "Single-key Tenant" },
    });
    return {
      actor: seedRbacActor(booted.db, { email, tenantId: tenant.id, roleId: role.role.id }),
    };
  }

  it("DENIES a member whose role lacks the route's single key", async () => {
    const { actor } = seedActorWithKeys("lacking@enforce.test", ["vet.clinical.create"]);
    const response = await supertest(booted.app.getHttpServer())
      .get("/memberships")
      .set("Cookie", actor.cookie)
      .expect(403);
    expect((response.body as ErrorEnvelopeBody).error.code).toBe("FORBIDDEN");
  });

  it("ADMITS a member whose role holds exactly that key (positive control)", async () => {
    const { actor } = seedActorWithKeys("holding@enforce.test", [MANAGE_KEY]);
    await supertest(booted.app.getHttpServer())
      .get("/memberships")
      .set("Cookie", actor.cookie)
      .expect(200);
  });
});

describe("AND semantics over real HTTP (synthetic two-key route)", () => {
  const handler = vi.fn((): Record<string, boolean> => ({ touched: true }));

  @Controller("and-probe")
  class TwoKeyProbeController {
    // Two keys on ONE declaration: the conjunction under test.
    @RequirePermissions("vet.clinical.create", "cash.session.close")
    @Get()
    probe(): Record<string, boolean> {
      return handler();
    }
  }

  let booted: BootedTestApp;

  beforeAll(async () => {
    booted = await bootTestApp({ extraControllers: [TwoKeyProbeController] });
  });

  afterAll(async () => {
    await booted.close();
  });

  function seedActorWithKeys(email: string, keys: string[]): RbacActor {
    const role = seedRoleWithKeys(booted.db, `AND-${email.slice(0, 10)}`, "AND fixture", keys);
    const tenant = booted.db.prisma.tenant.create({
      data: { slug: `and-${email.slice(0, 14)}`, name: "AND Tenant" },
    });
    return seedRbacActor(booted.db, { email, tenantId: tenant.id, roleId: role.role.id });
  }

  it("admits ONLY when EVERY declared key resolves — one of two is still 403", async () => {
    const both = seedActorWithKeys("both-keys@enforce.test", [
      "vet.clinical.create",
      "cash.session.close",
    ]);
    const onlyOne = seedActorWithKeys("one-key@enforce.test", ["vet.clinical.create"]);

    const allowed = await supertest(booted.app.getHttpServer())
      .get("/and-probe")
      .set("Cookie", both.cookie)
      .expect(200);
    expect(allowed.body).toEqual({ touched: true });

    const denied = await supertest(booted.app.getHttpServer())
      .get("/and-probe")
      .set("Cookie", onlyOne.cookie)
      .expect(403);
    expect((denied.body as ErrorEnvelopeBody).error.code).toBe("FORBIDDEN");

    // Pre-handler denial proof: exactly the admitted request reached the body.
    expect(handler).toHaveBeenCalledTimes(1);
  });
});

describe("fail-closed without membership context", () => {
  let booted: BootedTestApp;

  beforeAll(async () => {
    booted = await bootTestApp();
  });

  afterAll(async () => {
    await booted.close();
  });

  it("rejects an AUTHENTICATED session without any membership with FORBIDDEN", async () => {
    const actor = seedRbacActor(booted.db, {
      email: "membership-less@enforce.test",
      // No tenant/role ⇒ no ACTIVE membership for TenantActiveGuard to resolve.
      withMembership: false,
    });
    const response = await supertest(booted.app.getHttpServer())
      .get("/memberships")
      .set("Cookie", actor.cookie)
      .expect(403);
    expect((response.body as ErrorEnvelopeBody).error.code).toBe("FORBIDDEN");
  });
});

describe("ADMIN authority is data, not code", () => {
  let booted: BootedTestApp;

  beforeAll(async () => {
    booted = await bootTestApp();
  });

  afterAll(async () => {
    await booted.close();
  });

  function seedFullyGrantedActor(email: string): {
    actor: RbacActor;
    /** Keep the WHOLE seeded role handle — detaching `revoke` would break its `this`. */
    role: SeededRbacRole;
  } {
    const allKeys = PERMISSION_SEEDS.map((entry) => entry.key);
    const adminLike = seedRoleWithKeys(
      booted.db,
      `ADM-${email.slice(0, 10)}`,
      "Admin-like",
      allKeys
    );
    const tenant = booted.db.prisma.tenant.create({
      data: { slug: `adm-${email.slice(0, 12)}`, name: "Admin-data Tenant" },
    });
    const actor = seedRbacActor(booted.db, {
      email,
      tenantId: tenant.id,
      roleId: adminLike.role.id,
    });
    return { actor, role: adminLike };
  }

  it("flips to 403 the moment ONE granted key is revoked from the role mapping", async () => {
    const first = seedFullyGrantedActor("admin-data@enforce.test");
    const second = seedFullyGrantedActor("admin-intact@enforce.test");

    // Both pass while the mapping rows are complete...
    await supertest(booted.app.getHttpServer())
      .get("/memberships")
      .set("Cookie", first.actor.cookie)
      .expect(200);

    // ...revoking the exact declared key from ACTOR's role (data mutation
    // only — no code change) removes the ability for THAT role alone.
    first.role.revoke(MANAGE_KEY);

    const denied = await supertest(booted.app.getHttpServer())
      .get("/memberships")
      .set("Cookie", first.actor.cookie)
      .expect(403);
    expect((denied.body as ErrorEnvelopeBody).error.code).toBe("FORBIDDEN");

    // The untouched twin keeps access — proving the verdict followed the ROW.
    await supertest(booted.app.getHttpServer())
      .get("/memberships")
      .set("Cookie", second.actor.cookie)
      .expect(200);
  });
});
