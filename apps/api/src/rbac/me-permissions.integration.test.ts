import { afterAll, beforeAll, describe, expect, it } from "vitest";
import supertest from "supertest";
import { bootTestApp, type BootedTestApp } from "../../test/support/boot-test-app.js";
import { seedRbacActor, seedRoleWithKeys } from "../../test/support/rbac-fixture.js";

interface PermissionsBody {
  permissions: string[];
}

interface ErrorEnvelopeBody {
  error: { code: string; message: string; requestId: string };
}

/**
 * GET /memberships/me/permissions (EPIC-02 design D4, spec:
 * rbac-enforcement / Effective-permissions endpoint).
 *
 * Discrimination: the SAME profile holds memberships in TWO tenants with
 * DIFFERENT role key sets. The response must equal EXACTLY the key set of the
 * ACTIVE tenant's role (single-membership auto-selection: earliest createdAt)
 * — never the union, never "all known keys". Both orderings are probed so a
 * buggy implementation cannot pass by hardcoding either side.
 */
describe("effective permissions endpoint (real HTTP)", () => {
  const EARLIER = new Date("2026-01-01T00:00:00Z");
  const LATER = new Date("2026-02-01T00:00:00Z");

  let booted: BootedTestApp;

  beforeAll(async () => {
    booted = await bootTestApp();
  });

  afterAll(async () => {
    await booted.close();
  });

  it("lists exactly the ACTIVE tenant role's keys (clinical tenant wins the race)", async () => {
    const clinicalRole = seedRoleWithKeys(booted.db, "CLINICAL", "Clinical", [
      "vet.clinical.create",
    ]);
    const opsRole = seedRoleWithKeys(booted.db, "OPS", "Operations", [
      "cash.session.close",
      "fiscal.invoice.issue",
    ]);
    const tenantA = booted.db.prisma.tenant.create({
      data: { slug: `me-perms-a-${EARLIER.getTime()}`, name: "Clinical Tenant" },
    });
    const tenantB = booted.db.prisma.tenant.create({
      data: { slug: `me-perms-b-${LATER.getTime()}`, name: "Ops Tenant" },
    });

    const actor = seedRbacActor(booted.db, {
      email: "dual-clinical-first@isolation.test",
      // EARLIEST membership becomes the active one (deterministic resolver).
      tenantId: tenantA.id,
      roleId: clinicalRole.role.id,
      createdAt: EARLIER,
    });
    booted.db.prisma.tenantMembership.create({
      data: {
        tenantId: tenantB.id,
        userProfileId: actor.profile.id,
        roleId: opsRole.role.id,
        status: "ACTIVE",
        createdAt: LATER,
      },
    });

    const response = await supertest(booted.app.getHttpServer())
      .get("/memberships/me/permissions")
      .set("Cookie", actor.cookie)
      .expect(200);

    expect((response.body as PermissionsBody).permissions).toEqual(["vet.clinical.create"]);
  });

  it("flips to the OTHER tenant's keys when THAT membership is earlier", async () => {
    const clinicalRole = seedRoleWithKeys(booted.db, "FLIP-CLINICAL", "Clinical", [
      "vet.clinical.create",
    ]);
    const opsRole = seedRoleWithKeys(booted.db, "FLIP-OPS", "Operations", [
      "cash.session.close",
      "fiscal.invoice.issue",
    ]);
    const tenantA = booted.db.prisma.tenant.create({
      data: { slug: `me-flip-a-${LATER.getTime()}`, name: "Flip Clinical Tenant" },
    });
    const tenantB = booted.db.prisma.tenant.create({
      data: { slug: `me-flip-b-${EARLIER.getTime()}`, name: "Flip Ops Tenant" },
    });

    const actor = seedRbacActor(booted.db, {
      email: "dual-ops-first@isolation.test",
      tenantId: tenantA.id,
      roleId: clinicalRole.role.id,
      createdAt: LATER,
    });
    booted.db.prisma.tenantMembership.create({
      data: {
        tenantId: tenantB.id,
        userProfileId: actor.profile.id,
        roleId: opsRole.role.id,
        status: "ACTIVE",
        createdAt: EARLIER,
      },
    });

    const response = await supertest(booted.app.getHttpServer())
      .get("/memberships/me/permissions")
      .set("Cookie", actor.cookie)
      .expect(200);

    expect((response.body as PermissionsBody).permissions).toEqual([
      "cash.session.close",
      "fiscal.invoice.issue",
    ]);
  });

  it("returns an EMPTY sorted set for a role without any grants (authenticated-only route)", async () => {
    const bareRole = seedRoleWithKeys(booted.db, "BARE", "Bare");
    const tenant = booted.db.prisma.tenant.create({
      data: { slug: `me-bare-${bareRole.role.id.slice(0, 8)}`, name: "Bare Tenant" },
    });
    const actor = seedRbacActor(booted.db, {
      email: "bare-role@isolation.test",
      tenantId: tenant.id,
      roleId: bareRole.role.id,
    });

    const response = await supertest(booted.app.getHttpServer())
      .get("/memberships/me/permissions")
      .set("Cookie", actor.cookie)
      .expect(200);

    expect((response.body as PermissionsBody).permissions).toEqual([]);
  });

  it("rejects ANONYMOUS calls with 401 UNAUTHENTICATED", async () => {
    const response = await supertest(booted.app.getHttpServer())
      .get("/memberships/me/permissions")
      .expect(401);
    expect((response.body as ErrorEnvelopeBody).error.code).toBe("UNAUTHENTICATED");
  });
});
