import { afterAll, beforeAll, describe, expect, it } from "vitest";
import supertest from "supertest";
import { bootTestApp, type BootedTestApp } from "../../test/support/boot-test-app.js";
import { seedRbacActor, seedRoleWithKeys } from "../../test/support/rbac-fixture.js";

interface CapabilitiesBody {
  permissions: string[];
  features: string[];
}

interface ErrorEnvelopeBody {
  error: { code: string; message: string; requestId: string };
}

/**
 * GET /memberships/me/capabilities (UX-037 S1).
 *
 * Discrimination: two tenants with DIFFERENT entitlements and two members of
 * the same tenant with DIFFERENT roles. Each caller sees exactly its own
 * active membership's permissions and its own tenant's features — never the
 * other tenant's features, never the other member's permissions.
 */
describe("caller capabilities endpoint (real HTTP)", () => {
  let booted: BootedTestApp;

  beforeAll(async () => {
    booted = await bootTestApp();
  });

  afterAll(async () => {
    await booted.close();
  });

  function grant(tenantId: string, code: string): void {
    const feature =
      booted.db.prisma.featureCode.findUnique({ where: { code } }) ??
      booted.db.prisma.featureCode.create({ data: { code } });
    booted.db.prisma.tenantEntitlement.create({
      data: { tenantId, featureCodeId: feature.id },
    });
  }

  it("returns exactly the caller's own sorted permissions and its tenant's sorted features", async () => {
    const cashierRole = seedRoleWithKeys(booted.db, "CAP-CASHIER", "Cashier", [
      "sales.sale.create",
      "cash.session.close",
    ]);
    const vetRole = seedRoleWithKeys(booted.db, "CAP-VET", "Vet", ["vet.clinical.create"]);
    const tenantA = booted.db.prisma.tenant.create({
      data: { slug: "cap-tenant-a", name: "Tenant A" },
    });
    const tenantB = booted.db.prisma.tenant.create({
      data: { slug: "cap-tenant-b", name: "Tenant B" },
    });
    grant(tenantA.id, "veterinary");
    grant(tenantA.id, "reports");
    grant(tenantB.id, "multi_branch");
    grant(tenantB.id, "portal");

    const cashierA = seedRbacActor(booted.db, {
      email: "cap-cashier-a@isolation.test",
      tenantId: tenantA.id,
      roleId: cashierRole.role.id,
    });
    const vetA = seedRbacActor(booted.db, {
      email: "cap-vet-a@isolation.test",
      tenantId: tenantA.id,
      roleId: vetRole.role.id,
    });
    const vetB = seedRbacActor(booted.db, {
      email: "cap-vet-b@isolation.test",
      tenantId: tenantB.id,
      roleId: vetRole.role.id,
    });

    const server = booted.app.getHttpServer();
    const cashierBody = (
      await supertest(server)
        .get("/memberships/me/capabilities")
        .set("Cookie", cashierA.cookie)
        .expect(200)
    ).body as CapabilitiesBody;
    const vetABody = (
      await supertest(server)
        .get("/memberships/me/capabilities")
        .set("Cookie", vetA.cookie)
        .expect(200)
    ).body as CapabilitiesBody;
    const vetBBody = (
      await supertest(server)
        .get("/memberships/me/capabilities")
        .set("Cookie", vetB.cookie)
        .expect(200)
    ).body as CapabilitiesBody;

    expect(cashierBody).toEqual({
      permissions: ["cash.session.close", "sales.sale.create"],
      features: ["reports", "veterinary"],
    });
    expect(vetABody).toEqual({
      permissions: ["vet.clinical.create"],
      features: ["reports", "veterinary"],
    });
    expect(vetBBody).toEqual({
      permissions: ["vet.clinical.create"],
      features: ["multi_branch", "portal"],
    });
  });

  it("returns empty sorted lists for a role without grants in a tenant without entitlements", async () => {
    const bareRole = seedRoleWithKeys(booted.db, "CAP-BARE", "Bare");
    const tenant = booted.db.prisma.tenant.create({
      data: { slug: "cap-bare", name: "Bare Tenant" },
    });
    const actor = seedRbacActor(booted.db, { tenantId: tenant.id, roleId: bareRole.role.id });

    const response = await supertest(booted.app.getHttpServer())
      .get("/memberships/me/capabilities")
      .set("Cookie", actor.cookie)
      .expect(200);

    expect(response.body).toEqual({ permissions: [], features: [] });
  });

  it("rejects ANONYMOUS calls with 401 UNAUTHENTICATED", async () => {
    const response = await supertest(booted.app.getHttpServer())
      .get("/memberships/me/capabilities")
      .expect(401);
    expect((response.body as ErrorEnvelopeBody).error.code).toBe("UNAUTHENTICATED");
  });

  it("rejects a session whose only membership is SUSPENDED with 403 FORBIDDEN", async () => {
    const role = seedRoleWithKeys(booted.db, "CAP-SUSP", "Suspended", ["sales.sale.create"]);
    const tenant = booted.db.prisma.tenant.create({
      data: { slug: "cap-suspended", name: "Suspended Member Tenant" },
    });
    grant(tenant.id, "veterinary");
    const actor = seedRbacActor(booted.db, {
      tenantId: tenant.id,
      roleId: role.role.id,
      status: "SUSPENDED",
    });

    const response = await supertest(booted.app.getHttpServer())
      .get("/memberships/me/capabilities")
      .set("Cookie", actor.cookie)
      .expect(403);
    expect((response.body as ErrorEnvelopeBody).error.code).toBe("FORBIDDEN");
    expect(JSON.stringify(response.body)).not.toContain("veterinary");
  });
});
