import { afterAll, beforeAll, describe, expect, it } from "vitest";
import supertest from "supertest";
import { bootTestApp, type BootedTestApp } from "./boot-test-app.js";
import { seedTwoTenants, type TwoTenantFixture } from "./seed-two-tenants.js";

interface MembershipListBody {
  memberships: { id: string; tenantId: string; userProfileId: string; status: string }[];
}

/**
 * Harness SELF-TEST (tasks 5.2): proves the support utilities themselves work
 * before any isolation suite relies on them — production-module boot over the
 * shared adapter factory, dual-tenant seeding with working cookies, and true
 * dual-context isolation (each tenant observes ONLY its own rows).
 */
describe("isolation harness (self-test)", () => {
  let booted: BootedTestApp;
  let fixture: TwoTenantFixture;

  beforeAll(async () => {
    booted = await bootTestApp();
    fixture = seedTwoTenants(booted.db);
  });

  afterAll(async () => {
    await booted.close();
  });

  it("boots the PRODUCTION module graph and authenticates both seeded tenants", async () => {
    const server = booted.app.getHttpServer();

    const asA = await supertest(server)
      .get("/memberships")
      .set("Cookie", fixture.actors.a.cookie)
      .expect(200);
    const asB = await supertest(server)
      .get("/memberships")
      .set("Cookie", fixture.actors.b.cookie)
      .expect(200);

    const listA = (asA.body as MembershipListBody).memberships;
    const listB = (asB.body as MembershipListBody).memberships;

    // Tenant A's roster holds BOTH seeded A-memberships (ACTIVE + SUSPENDED):
    // the repository scopes by TENANT only — status filtering is not part of
    // the isolation contract. Tenant B has exactly its one membership.
    expect(listA.map((entry) => entry.tenantId)).toEqual([
      fixture.tenants.a.id,
      fixture.tenants.a.id,
    ]);
    expect(listB.map((entry) => entry.tenantId)).toEqual([fixture.tenants.b.id]);
    expect(listA.map((entry) => entry.status).sort()).toEqual(["ACTIVE", "SUSPENDED"]);

    // Dual-context isolation: strictly disjoint worlds.
    const identifiersB = [fixture.tenants.b.id, fixture.actors.b.membership!.id];
    for (const identifier of identifiersB) {
      expect(JSON.stringify(asA.body)).not.toContain(identifier);
    }
    expect(JSON.stringify(asB.body)).not.toContain(fixture.tenants.a.id);
  });

  it("issues INDEPENDENT apps/stores per boot (no cross-boot bleed)", async () => {
    const otherBoot: BootedTestApp = await bootTestApp();
    try {
      // The second boot's boundary knows nothing about the first boot's data.
      expect(otherBoot.db.tables.memberships.size).toBe(0);
      const anonymous = await supertest(otherBoot.app.getHttpServer())
        .get("/memberships")
        .expect(401);
      expect((anonymous.body as { error: { code: string } }).error.code).toBe("UNAUTHENTICATED");
    } finally {
      await otherBoot.close();
    }
  });

  it("cleanup() removes every fixture row (ephemeral guarantee)", () => {
    const tables = booted.db.tables;
    expect(tables.tenants.size).toBeGreaterThan(0);
    expect(tables.profiles.size).toBeGreaterThan(0);

    fixture.cleanup();

    expect(tables.tenants.size).toBe(0);
    expect(tables.roles.size).toBe(0);
    expect(tables.profiles.size).toBe(0);
    expect(tables.sessions.size).toBe(0);
    expect(tables.memberships.size).toBe(0);
  });
});
