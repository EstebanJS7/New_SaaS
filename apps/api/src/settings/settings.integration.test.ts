import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import supertest from "supertest";
import { bootTestApp, type BootedTestApp } from "../../test/support/boot-test-app.js";
import type { IsolationDatabase } from "../../test/support/in-memory-database.js";
import { insertLiveStaffSession } from "../../test/support/seed-two-tenants.js";

interface ErrorEnvelopeBody {
  error: { code: string; message: string; requestId: string };
}

interface SettingsResponseBody {
  settings: Record<string, unknown>;
}

function seedActorWithPermission(
  db: IsolationDatabase,
  tenantId: string,
  permissionKey: string,
  roleCode: string
): { profileId: string; membershipId: string; roleId: string; cookie: string } {
  const role = db.prisma.role.create({ data: { code: roleCode, name: roleCode } });
  const permission = db.prisma.permission.create({
    data: { key: permissionKey, name: permissionKey },
  });
  db.prisma.rolePermission.create({ data: { roleId: role.id, permissionId: permission.id } });
  const profile = db.prisma.userProfile.create({
    data: {
      email: `${randomUUID()}@settings.test`,
      displayName: "Settings Actor",
      status: "active",
    },
  });
  const membership = db.prisma.tenantMembership.create({
    data: { tenantId, userProfileId: profile.id, roleId: role.id, status: "ACTIVE" },
  });
  const { cookie } = insertLiveStaffSession(db, profile.id);
  return { profileId: profile.id, membershipId: membership.id, roleId: role.id, cookie };
}

describe("Settings HTTP surface (real HTTP, full guard chain)", () => {
  let booted: BootedTestApp;

  beforeAll(async () => {
    booted = await bootTestApp();
  });

  afterAll(async () => {
    await booted.close();
  });

  function createTenant(): { id: string; slug: string } {
    return booted.db.prisma.tenant.create({
      data: { slug: `settings-${randomUUID().slice(0, 8)}`, name: "Settings Tenant" },
    });
  }

  it("GET /settings/:namespace returns defaults for an authenticated member", async () => {
    const actor = seedActorWithPermission(
      booted.db,
      createTenant().id,
      "users.membership.manage",
      "RECEPTIONIST"
    );

    const response = await supertest(booted.app.getHttpServer())
      .get("/settings/sales")
      .set("Cookie", actor.cookie)
      .expect(200);

    expect((response.body as SettingsResponseBody).settings).toEqual({
      defaultCurrency: "PYG",
      requireCustomerForInvoice: false,
    });
  });

  it("GET /settings/:namespace is reachable without the write permission", async () => {
    const actor = seedActorWithPermission(
      booted.db,
      createTenant().id,
      "scheduling.appointment.manage",
      "RECEPTIONIST"
    );

    const response = await supertest(booted.app.getHttpServer())
      .get("/settings/sales")
      .set("Cookie", actor.cookie)
      .expect(200);

    expect((response.body as SettingsResponseBody).settings).toEqual({
      defaultCurrency: "PYG",
      requireCustomerForInvoice: false,
    });
  });

  it("GET /settings/:namespace rejects anonymous calls with 401", async () => {
    const response = await supertest(booted.app.getHttpServer()).get("/settings/sales").expect(401);
    expect((response.body as ErrorEnvelopeBody).error.code).toBe("UNAUTHENTICATED");
  });

  it("PUT /settings/:namespace writes values when permission + entitlement are present", async () => {
    const tenant = createTenant();
    const actor = seedActorWithPermission(booted.db, tenant.id, "sales.settings.manage", "ADMIN");
    const featureCode = booted.db.prisma.featureCode.create({ data: { code: "sales" } });
    booted.db.prisma.tenantEntitlement.create({
      data: { tenantId: tenant.id, featureCodeId: featureCode.id },
    });

    const response = await supertest(booted.app.getHttpServer())
      .put("/settings/sales")
      .set("Cookie", actor.cookie)
      .send({ defaultCurrency: "USD" })
      .expect(200);

    expect((response.body as SettingsResponseBody).settings).toEqual({
      defaultCurrency: "USD",
      requireCustomerForInvoice: false,
    });

    const readBack = await supertest(booted.app.getHttpServer())
      .get("/settings/sales")
      .set("Cookie", actor.cookie)
      .expect(200);
    expect((readBack.body as SettingsResponseBody).settings).toEqual({
      defaultCurrency: "USD",
      requireCustomerForInvoice: false,
    });
  });

  it("PUT /settings/:namespace returns 403 FORBIDDEN without the permission", async () => {
    const actor = seedActorWithPermission(
      booted.db,
      createTenant().id,
      "users.membership.manage",
      "RECEPTIONIST"
    );

    const response = await supertest(booted.app.getHttpServer())
      .put("/settings/sales")
      .set("Cookie", actor.cookie)
      .send({ defaultCurrency: "USD" })
      .expect(403);

    expect((response.body as ErrorEnvelopeBody).error.code).toBe("FORBIDDEN");
  });

  it("PUT /settings/:namespace returns 403 FEATURE_NOT_ENTITLED without the feature grant", async () => {
    const actor = seedActorWithPermission(
      booted.db,
      createTenant().id,
      "sales.settings.manage",
      "ADMIN"
    );

    const response = await supertest(booted.app.getHttpServer())
      .put("/settings/sales")
      .set("Cookie", actor.cookie)
      .send({ defaultCurrency: "USD" })
      .expect(403);

    expect((response.body as ErrorEnvelopeBody).error.code).toBe("FEATURE_NOT_ENTITLED");
  });

  it("PUT /settings/:namespace returns 400 VALIDATION_FAILED for unknown fields", async () => {
    const tenant = createTenant();
    const actor = seedActorWithPermission(booted.db, tenant.id, "sales.settings.manage", "ADMIN");
    const featureCode = booted.db.prisma.featureCode.create({ data: { code: "sales" } });
    booted.db.prisma.tenantEntitlement.create({
      data: { tenantId: tenant.id, featureCodeId: featureCode.id },
    });

    const response = await supertest(booted.app.getHttpServer())
      .put("/settings/sales")
      .set("Cookie", actor.cookie)
      .send({ apiKey: "secret" })
      .expect(400);

    expect((response.body as ErrorEnvelopeBody).error.code).toBe("VALIDATION_FAILED");
  });

  it("PUT /settings/:namespace returns 400 VALIDATION_FAILED for wrong-typed values", async () => {
    const tenant = createTenant();
    const actor = seedActorWithPermission(booted.db, tenant.id, "sales.settings.manage", "ADMIN");
    const featureCode = booted.db.prisma.featureCode.create({ data: { code: "sales" } });
    booted.db.prisma.tenantEntitlement.create({
      data: { tenantId: tenant.id, featureCodeId: featureCode.id },
    });

    const response = await supertest(booted.app.getHttpServer())
      .put("/settings/sales")
      .set("Cookie", actor.cookie)
      .send({ requireCustomerForInvoice: "false" })
      .expect(400);

    expect((response.body as ErrorEnvelopeBody).error.code).toBe("VALIDATION_FAILED");
  });

  it("PUT /settings/:namespace returns 404 NOT_FOUND for unregistered namespaces", async () => {
    const actor = seedActorWithPermission(
      booted.db,
      createTenant().id,
      "sales.settings.manage",
      "ADMIN"
    );

    const response = await supertest(booted.app.getHttpServer())
      .put("/settings/nope")
      .set("Cookie", actor.cookie)
      .send({ defaultCurrency: "USD" })
      .expect(404);

    expect((response.body as ErrorEnvelopeBody).error.code).toBe("NOT_FOUND");
  });

  it("GET /settings/:namespace for a non-entitled tenant still returns defaults", async () => {
    const actor = seedActorWithPermission(
      booted.db,
      createTenant().id,
      "users.membership.manage",
      "RECEPTIONIST"
    );

    const response = await supertest(booted.app.getHttpServer())
      .get("/settings/sales")
      .set("Cookie", actor.cookie)
      .expect(200);

    expect((response.body as SettingsResponseBody).settings).toEqual({
      defaultCurrency: "PYG",
      requireCustomerForInvoice: false,
    });
  });

  it("does not expose tenant identifiers in error responses", async () => {
    const tenant = createTenant();
    const actor = seedActorWithPermission(
      booted.db,
      tenant.id,
      "users.membership.manage",
      "RECEPTIONIST"
    );

    const response = await supertest(booted.app.getHttpServer())
      .put("/settings/sales")
      .set("Cookie", actor.cookie)
      .send({ defaultCurrency: "USD" })
      .expect(403);

    expect(response.text).not.toContain(tenant.id);
    expect(response.text).not.toContain(tenant.slug);
  });
});
