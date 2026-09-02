import { afterAll, beforeAll, describe, expect, it } from "vitest";
import assert from "node:assert";
import supertest from "supertest";
import { bootTestApp, type BootedTestApp } from "../../test/support/boot-test-app.js";
import { seedRoleWithKeys } from "../../test/support/rbac-fixture.js";
import { insertLiveStaffSession } from "../../test/support/seed-two-tenants.js";

interface BrandResponse {
  source: string;
  brand: { theme: { colors: { primary: string } } };
}

interface ErrorEnvelope {
  error: { code: string };
}

interface PublicBrandDto {
  productDisplayName: string;
  accent: string;
}

interface AuditRow {
  action: string;
  tenantId: string;
  metadata: unknown;
}

describe("Branding HTTP boundary", () => {
  let booted: BootedTestApp;
  let tenantAId: string;
  let ownerCookie: string;
  let noPermissionCookie: string;
  let tenantASlug: string;
  let tenantBSlug: string;

  beforeAll(async () => {
    booted = await bootTestApp();
    const db = booted.db;

    tenantASlug = `branding-a`;
    tenantBSlug = `branding-b`;
    const tenantA = db.prisma.tenant.create({ data: { slug: tenantASlug, name: "A" } });
    const tenantB = db.prisma.tenant.create({ data: { slug: tenantBSlug, name: "B" } });
    tenantAId = tenantA.id;

    const brandingRole = seedRoleWithKeys(db, "BRANDING_OWNER", "Branding Owner", [
      "branding.settings.manage",
    ]);
    const noBrandingRole = seedRoleWithKeys(db, "NO_BRANDING", "No Branding", ["customers.read"]);

    const ownerProfile = db.prisma.userProfile.create({
      data: { email: "branding-owner@test.test", displayName: "Owner", status: "active" },
    });
    const noPermissionProfile = db.prisma.userProfile.create({
      data: { email: "no-branding@test.test", displayName: "No Branding", status: "active" },
    });
    const tenantBOwnerProfile = db.prisma.userProfile.create({
      data: {
        email: "branding-b-owner@test.test",
        displayName: "Tenant B Owner",
        status: "active",
      },
    });

    db.prisma.tenantMembership.create({
      data: {
        tenantId: tenantA.id,
        userProfileId: ownerProfile.id,
        roleId: brandingRole.role.id,
        status: "ACTIVE",
      },
    });
    db.prisma.tenantMembership.create({
      data: {
        tenantId: tenantA.id,
        userProfileId: noPermissionProfile.id,
        roleId: noBrandingRole.role.id,
        status: "ACTIVE",
      },
    });
    db.prisma.tenantMembership.create({
      data: {
        tenantId: tenantB.id,
        userProfileId: tenantBOwnerProfile.id,
        roleId: brandingRole.role.id,
        status: "ACTIVE",
      },
    });

    const customBrandingCode = db.prisma.featureCode.create({ data: { code: "custom_branding" } });
    db.prisma.tenantEntitlement.create({
      data: { tenantId: tenantA.id, featureCodeId: customBrandingCode.id },
    });
    db.prisma.tenantEntitlement.create({
      data: { tenantId: tenantB.id, featureCodeId: customBrandingCode.id },
    });

    ownerCookie = insertLiveStaffSession(db, ownerProfile.id).cookie;
    noPermissionCookie = insertLiveStaffSession(db, noPermissionProfile.id).cookie;
    const tenantBOwnerCookie = insertLiveStaffSession(db, tenantBOwnerProfile.id).cookie;
    (booted as unknown as Record<string, string>).tenantBOwnerCookie = tenantBOwnerCookie;
  });

  afterAll(async () => {
    await booted.close();
  });

  it("GET /branding/current requires authentication", async () => {
    await supertest(booted.app.getHttpServer()).get("/branding/current").expect(401);
  });

  it("GET /branding/current returns preset when no row exists", async () => {
    const response = await supertest(booted.app.getHttpServer())
      .get("/branding/current")
      .set("Cookie", ownerCookie)
      .expect(200);
    const body = response.body as { source: string };
    expect(body.source).toBe("preset");
  });

  it("PUT /branding/current writes tenant overrides and co-commits audit", async () => {
    const update = await supertest(booted.app.getHttpServer())
      .put("/branding/current")
      .set("Cookie", ownerCookie)
      .send({ overrides: { schemaVersion: 1, primary: "#0ea5e9" } })
      .expect(200);
    const body = update.body as BrandResponse;
    expect(body.source).toBe("tenant");
    expect(body.brand.theme.colors.primary).toBe("#0ea5e9");

    const audit = booted.db.tables.audits.values().next().value as AuditRow | undefined;
    assert(audit);
    expect(audit.action).toBe("branding.updated");
    expect(audit.tenantId).toBe(tenantAId);
    expect(audit.metadata).toMatchObject({ schemaVersion: 1 });
  });

  it("PUT /branding/current rejects unknown keys with BRAND_OVERRIDE_UNKNOWN_KEY", async () => {
    const response = await supertest(booted.app.getHttpServer())
      .put("/branding/current")
      .set("Cookie", ownerCookie)
      .send({ overrides: { schemaVersion: 1, fontHeading: "Inter" } })
      .expect(400);

    const body = response.body as ErrorEnvelope;
    expect(body.error.code).toBe("BRAND_OVERRIDE_UNKNOWN_KEY");
  });

  it("PUT /branding/current is denied without the permission", async () => {
    await supertest(booted.app.getHttpServer())
      .put("/branding/current")
      .set("Cookie", noPermissionCookie)
      .send({ overrides: { schemaVersion: 1, primary: "#0ea5e9" } })
      .expect(403);
  });

  it("PUT /branding/current is denied without the custom_branding entitlement", async () => {
    // Tenant A already has the entitlement; tenant B does too in this fixture.
    // Create a third tenant with the permission but no entitlement to isolate
    // the entitlement gate over HTTP.
    const tenantC = booted.db.prisma.tenant.create({ data: { slug: "branding-c", name: "C" } });
    const role = seedRoleWithKeys(booted.db, "BRANDING_C", "Branding C", [
      "branding.settings.manage",
    ]);
    const profile = booted.db.prisma.userProfile.create({
      data: { email: "branding-c@test.test", displayName: "C", status: "active" },
    });
    booted.db.prisma.tenantMembership.create({
      data: {
        tenantId: tenantC.id,
        userProfileId: profile.id,
        roleId: role.role.id,
        status: "ACTIVE",
      },
    });
    const cookie = insertLiveStaffSession(booted.db, profile.id).cookie;

    const response = await supertest(booted.app.getHttpServer())
      .put("/branding/current")
      .set("Cookie", cookie)
      .send({ overrides: { schemaVersion: 1, primary: "#0ea5e9" } })
      .expect(403);

    expect((response.body as ErrorEnvelope).error.code).toBe("FEATURE_NOT_ENTITLED");
  });

  it("denies a tenant B member from mutating tenant A branding (cross-tenant write)", async () => {
    // First, write a tenant A override so there is something to attempt to overwrite.
    await supertest(booted.app.getHttpServer())
      .put("/branding/current")
      .set("Cookie", ownerCookie)
      .send({ overrides: { schemaVersion: 1, primary: "#0ea5e9" } })
      .expect(200);

    const tenantBOwnerCookie = (booted as unknown as Record<string, string>).tenantBOwnerCookie;

    // Tenant B owner tries to PUT using tenant A override payload shape.
    // Their tenant context resolves to B from the session, so upsert touches B only.
    await supertest(booted.app.getHttpServer())
      .put("/branding/current")
      .set("Cookie", tenantBOwnerCookie)
      .send({ overrides: { schemaVersion: 1, primary: "#ef4444" } })
      .expect(200);

    // Tenant A's override must remain unchanged.
    const tenantA = await supertest(booted.app.getHttpServer())
      .get("/branding/current")
      .set("Cookie", ownerCookie)
      .expect(200);
    expect((tenantA.body as BrandResponse).brand.theme.colors.primary).toBe("#0ea5e9");
  });

  it("POST /branding/reset removes overrides idempotently", async () => {
    await supertest(booted.app.getHttpServer())
      .post("/branding/reset")
      .set("Cookie", ownerCookie)
      .send({})
      .expect(200);

    const tenantARow = [...booted.db.tables.tenantBrandings.values()].find(
      (row) => row.tenantId === tenantAId
    );
    expect(tenantARow).toBeUndefined();

    const second = await supertest(booted.app.getHttpServer())
      .post("/branding/reset")
      .set("Cookie", ownerCookie)
      .send({})
      .expect(200);
    const secondBody = second.body as { source: string };
    expect(secondBody.source).toBe("preset");
  });

  it("GET /api/v1/public/tenants/:slug/branding returns the allowlisted DTO", async () => {
    await supertest(booted.app.getHttpServer())
      .put("/branding/current")
      .set("Cookie", ownerCookie)
      .send({ overrides: { schemaVersion: 1, accent: "#f43f5e" } })
      .expect(200);

    const response = await supertest(booted.app.getHttpServer())
      .get(`/api/v1/public/tenants/${tenantASlug}/branding`)
      .expect(200);
    const body = response.body as PublicBrandDto;
    expect(body.productDisplayName).toEqual(expect.any(String));
    expect(body.accent).toBe("#f43f5e");
    expect(body).not.toHaveProperty("tenantId");
    expect(body).not.toHaveProperty("updatedBy");
  });

  it("GET /api/v1/public/tenants/:slug/branding returns 404 for unknown slug", async () => {
    await supertest(booted.app.getHttpServer())
      .get("/api/v1/public/tenants/missing-tenant/branding")
      .expect(404);
  });
});

describe("branding audit atomicity", () => {
  let booted: BootedTestApp;
  let ownerCookie: string;

  beforeAll(async () => {
    booted = await bootTestApp();
    const db = booted.db;

    const tenantA = db.prisma.tenant.create({ data: { slug: "branding-atomic", name: "A" } });
    const role = seedRoleWithKeys(db, "BRANDING_OWNER", "Branding Owner", [
      "branding.settings.manage",
    ]);
    const profile = db.prisma.userProfile.create({
      data: { email: "branding-atomic@test.test", displayName: "Owner", status: "active" },
    });
    db.prisma.tenantMembership.create({
      data: {
        tenantId: tenantA.id,
        userProfileId: profile.id,
        roleId: role.role.id,
        status: "ACTIVE",
      },
    });
    const code = db.prisma.featureCode.create({ data: { code: "custom_branding" } });
    db.prisma.tenantEntitlement.create({
      data: { tenantId: tenantA.id, featureCodeId: code.id },
    });
    ownerCookie = insertLiveStaffSession(db, profile.id).cookie;
  });

  afterAll(async () => {
    await booted.close();
  });

  it("rolls back the tenant branding mutation when the audit write fails", async () => {
    const originalCreate = booted.db.prisma.auditLog.create.bind(booted.db.prisma.auditLog);
    let createCalls = 0;
    booted.db.prisma.auditLog.create = (args) => {
      createCalls += 1;
      if (args.data.action === "branding.updated") {
        throw new Error("audit write forced failure");
      }
      return originalCreate(args);
    };

    await supertest(booted.app.getHttpServer())
      .put("/branding/current")
      .set("Cookie", ownerCookie)
      .send({ overrides: { schemaVersion: 1, primary: "#000000" } })
      .expect(500);

    expect(createCalls).toBeGreaterThan(0);

    // The transaction must roll back BOTH the branding mutation and the audit
    // row: the override was never persisted and no successful audit row exists.
    const after = await supertest(booted.app.getHttpServer())
      .get("/branding/current")
      .set("Cookie", ownerCookie)
      .expect(200);
    expect((after.body as BrandResponse).source).toBe("preset");

    const auditRows = [...booted.db.tables.audits.values()].filter(
      (row) => (row as AuditRow).action === "branding.updated"
    );
    expect(auditRows).toHaveLength(0);
  });
});
