import { afterAll, beforeAll, describe, expect, it } from "vitest";
import assert from "node:assert";
import { createHmac } from "node:crypto";
import supertest from "supertest";
import { bootTestApp, type BootedTestApp } from "../../test/support/boot-test-app.js";
import { createIsolationDatabase } from "../../test/support/in-memory-database.js";
import { seedRoleWithKeys } from "../../test/support/rbac-fixture.js";
import { insertLiveStaffSession } from "../../test/support/seed-two-tenants.js";

const TEST_ASSET_SECRET = "test-integration-secret";

/** Strips the API origin from an absolute URL so supertest can hit the route. */
function pathOf(url: string): string {
  return new URL(url).pathname + new URL(url).search;
}

/** Re-signs a token exactly like the delivery service does (expiry/tamper cases). */
function craftToken(payload: { kind: string; assetId: string; exp: number }): string {
  const signature = createHmac("sha256", TEST_ASSET_SECRET)
    .update(JSON.stringify(payload))
    .digest("base64url");
  return Buffer.from(JSON.stringify({ ...payload, signature })).toString("base64url");
}

function makePngBuffer(size: number): Buffer {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(13, 0);
  const ihdrType = Buffer.from("IHDR");
  const width = Buffer.alloc(4);
  width.writeUInt32BE(1, 0);
  const height = Buffer.alloc(4);
  height.writeUInt32BE(1, 0);
  const rest = Buffer.from([0x08, 0x02, 0x00, 0x00, 0x00]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(0, 0);
  const chunk = Buffer.concat([length, ihdrType, width, height, rest, crc]);
  const payload = Buffer.alloc(Math.max(0, size - signature.length - chunk.length), 0);
  return Buffer.concat([signature, chunk, payload]);
}

interface BrandResponse {
  source: string;
  brand: {
    theme: { colors: { primary: string } };
    assets?: { logoLightUrl?: string; logoDarkUrl?: string; faviconUrl?: string };
  };
}

interface ErrorEnvelope {
  error: { code: string };
}

interface PublicBrandDto {
  productDisplayName: string;
  accent: string;
  primary?: string;
  logoLightUrl?: string;
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
  let tenantBOwnerCookie: string;

  beforeAll(async () => {
    process.env.BRANDING_ASSETS_ENABLED = "true";
    process.env.BRANDING_ASSET_URL_SECRET = "test-integration-secret";
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
    tenantBOwnerCookie = insertLiveStaffSession(db, tenantBOwnerProfile.id).cookie;
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

  it("POST /branding/reset persists a PENDING cleanup intent without deleting storage in-request", async () => {
    await supertest(booted.app.getHttpServer())
      .post("/branding/assets/logoLight")
      .set("Cookie", ownerCookie)
      .attach("file", makePngBuffer(1024), "logo.png")
      .expect(201);

    const asset = [...booted.db.tables.brandingAssets.values()].find(
      (row) => row.tenantId === tenantAId && row.kind === "LOGO_LIGHT"
    );
    assert(asset);
    booted.cleanupProducer.enqueued.length = 0;

    await supertest(booted.app.getHttpServer())
      .post("/branding/reset")
      .set("Cookie", ownerCookie)
      .send({})
      .expect(200);

    const intents = [...booted.db.tables.brandingResetCleanupIntents.values()].filter(
      (row) => row.tenantId === tenantAId
    );
    expect(intents).toHaveLength(1);
    expect(intents[0]?.status).toBe("PENDING");
    expect(intents[0]?.storageKeys).toEqual([asset.assetKey]);
    // Enqueue is post-commit and carries the intent id as the dedupe job id.
    expect(booted.cleanupProducer.enqueued).toEqual([intents[0]?.id]);

    // Storage is an external boundary: reset must not delete bytes in-request;
    // the durable PENDING intent is what drives worker cleanup (U6).
    expect(booted.db.storage.hasKey(asset.assetKey)).toBe(true);
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

  it("GET /api/v1/public/tenants/:slug/branding hides a suspended slug behind the identical unknown-slug envelope", async () => {
    const suspendedSlug = "branding-suspended";
    booted.db.prisma.tenant.create({
      data: { slug: suspendedSlug, name: "Suspended", status: "SUSPENDED" },
    });

    // Pin the request id on both requests so the envelopes are comparable
    // byte-for-byte: a SUSPENDED slug must not be distinguishable from an
    // unknown slug, including error code, message, and correlation id.
    const requestId = "req-suspended-parity";
    const unknown = await supertest(booted.app.getHttpServer())
      .get("/api/v1/public/tenants/missing-tenant/branding")
      .set("x-request-id", requestId)
      .expect(404);
    const suspended = await supertest(booted.app.getHttpServer())
      .get(`/api/v1/public/tenants/${suspendedSlug}/branding`)
      .set("x-request-id", requestId)
      .expect(404);

    expect(suspended.body).toEqual(unknown.body);
    expect((suspended.body as ErrorEnvelope).error.code).toBe("NOT_FOUND");
  });

  it("GET /branding/current returns asset URLs only (never keys or buckets)", async () => {
    await supertest(booted.app.getHttpServer())
      .post("/branding/assets/logoLight")
      .set("Cookie", ownerCookie)
      .attach("file", makePngBuffer(1024), "logo.png")
      .expect(201);

    const response = await supertest(booted.app.getHttpServer())
      .get("/branding/current")
      .set("Cookie", ownerCookie)
      .expect(200);

    const body = response.body as {
      source: string;
      brand: { assets?: { logoLightUrl?: string } };
    };
    expect(body.source).toBe("tenant");
    // Canonical rendering URL: branding assets are intentionally public, so the
    // staff resolved brand uses the same API-local anonymous HMAC URL as the
    // portal, never the relative protected route or a storage URL.
    expect(body.brand.assets?.logoLightUrl).toMatch(
      /^http:\/\/localhost:3001\/api\/v1\/public\/branding\/assets\/logoLight\/content\?token=/
    );
    expect(body.brand.assets?.logoLightUrl).not.toContain("assetKey");
    expect(body.brand.assets?.logoLightUrl).not.toContain("bucket");
    expect(body.brand.assets?.logoLightUrl).not.toContain("memory://");
    expect(JSON.stringify(body)).not.toContain("assetKey");
    expect(JSON.stringify(body)).not.toContain("bucket");
  });

  it("resolves the same primary token and logo URL for staff and portal audiences", async () => {
    await supertest(booted.app.getHttpServer())
      .put("/branding/current")
      .set("Cookie", ownerCookie)
      .send({ overrides: { schemaVersion: 1, primary: "#0ea5e9" } })
      .expect(200);

    await supertest(booted.app.getHttpServer())
      .post("/branding/assets/logoLight")
      .set("Cookie", ownerCookie)
      .attach("file", makePngBuffer(1024), "logo.png")
      .expect(201);

    // Authoritative scenario: the staff layout (private endpoint) and the
    // portal layout (public endpoint) must render the exact same resolved
    // primary token and the exact same logo URL for the same tenant.
    const staff = await supertest(booted.app.getHttpServer())
      .get("/branding/current")
      .set("Cookie", ownerCookie)
      .expect(200);
    const portal = await supertest(booted.app.getHttpServer())
      .get(`/api/v1/public/tenants/${tenantASlug}/branding`)
      .expect(200);

    const staffBody = staff.body as BrandResponse;
    const portalBody = portal.body as PublicBrandDto;

    expect(staffBody.brand.theme.colors.primary).toBe("#0ea5e9");
    expect(portalBody.primary).toBe("#0ea5e9");
    expect(staffBody.brand.assets?.logoLightUrl).toBe(portalBody.logoLightUrl);
    expect(portalBody.logoLightUrl).toMatch(
      /^http:\/\/localhost:3001\/api\/v1\/public\/branding\/assets\/logoLight\/content\?token=/
    );
  });

  it("public DTO refreshes the signed URL after replacement and old URL is revoked", async () => {
    await supertest(booted.app.getHttpServer())
      .post("/branding/assets/logoLight")
      .set("Cookie", ownerCookie)
      .attach("file", makePngBuffer(1024), "logo.png")
      .expect(201);

    const firstPublic = await supertest(booted.app.getHttpServer())
      .get(`/api/v1/public/tenants/${tenantASlug}/branding`)
      .expect(200);
    const firstUrl = (firstPublic.body as { logoLightUrl?: string }).logoLightUrl;
    expect(firstUrl).toMatch(
      /^http:\/\/localhost:3001\/api\/v1\/public\/branding\/assets\/logoLight\/content\?token=/
    );

    // Wait a tick so updatedAt changes and the cache revision differs.
    await new Promise((resolve) => setTimeout(resolve, 10));

    await supertest(booted.app.getHttpServer())
      .post("/branding/assets/logoLight")
      .set("Cookie", ownerCookie)
      .attach("file", makePngBuffer(2048), "logo.png")
      .expect(201);

    const secondPublic = await supertest(booted.app.getHttpServer())
      .get(`/api/v1/public/tenants/${tenantASlug}/branding`)
      .expect(200);
    const secondUrl = (secondPublic.body as { logoLightUrl?: string }).logoLightUrl;

    expect(secondUrl).not.toBe(firstUrl);

    // The public route is anonymous and token-verified; no cookie is sent.
    await supertest(booted.app.getHttpServer()).get(pathOf(firstUrl!)).expect(404);

    const refreshedContent = await supertest(booted.app.getHttpServer())
      .get(pathOf(secondUrl!))
      .expect(200);
    expect((refreshedContent.body as Buffer).length).toBe(2048);
  });

  it("public DTO contains no private fields", async () => {
    await supertest(booted.app.getHttpServer())
      .put("/branding/current")
      .set("Cookie", ownerCookie)
      .send({ overrides: { schemaVersion: 1, accent: "#f43f5e" } })
      .expect(200);

    await supertest(booted.app.getHttpServer())
      .post("/branding/assets/logoLight")
      .set("Cookie", ownerCookie)
      .attach("file", makePngBuffer(1024), "logo.png")
      .expect(201);

    const response = await supertest(booted.app.getHttpServer())
      .get(`/api/v1/public/tenants/${tenantASlug}/branding`)
      .expect(200);

    const body = response.body as Record<string, unknown>;
    expect(body).toHaveProperty("productDisplayName");
    expect(body).toHaveProperty("accent");
    expect(body).toHaveProperty("logoLightUrl");
    expect(body).not.toHaveProperty("tenantId");
    expect(body).not.toHaveProperty("updatedBy");
    expect(body).not.toHaveProperty("assetKey");
    expect(body).not.toHaveProperty("bucket");
  });
});

describe("Branding asset HTTP boundary", () => {
  let booted: BootedTestApp;
  let ownerCookie: string;
  let tenantBOwnerCookieLocal: string;
  let noPermissionCookieLocal: string;
  let tenantAId: string;

  beforeAll(async () => {
    process.env.BRANDING_ASSETS_ENABLED = "true";
    process.env.BRANDING_ASSET_URL_SECRET = "test-integration-secret";
    booted = await bootTestApp();
    const db = booted.db;

    const tenantA = db.prisma.tenant.create({ data: { slug: "asset-a", name: "A" } });
    const tenantB = db.prisma.tenant.create({ data: { slug: "asset-b", name: "B" } });
    tenantAId = tenantA.id;

    const brandingRole = seedRoleWithKeys(db, "BRANDING_OWNER", "Branding Owner", [
      "branding.settings.manage",
    ]);
    const noBrandingRole = seedRoleWithKeys(db, "NO_BRANDING", "No Branding", ["customers.read"]);

    const ownerProfile = db.prisma.userProfile.create({
      data: { email: "asset-owner@test.test", displayName: "Owner", status: "active" },
    });
    const noPermissionProfile = db.prisma.userProfile.create({
      data: { email: "asset-no-branding@test.test", displayName: "No Branding", status: "active" },
    });
    const tenantBOwnerProfile = db.prisma.userProfile.create({
      data: { email: "asset-b-owner@test.test", displayName: "Tenant B Owner", status: "active" },
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
    noPermissionCookieLocal = insertLiveStaffSession(db, noPermissionProfile.id).cookie;
    tenantBOwnerCookieLocal = insertLiveStaffSession(db, tenantBOwnerProfile.id).cookie;
  });

  beforeEach(() => {
    booted.db.tables.brandingAssets.clear();
    booted.db.tables.tenantBrandings.clear();
    booted.db.tables.audits.clear();
    booted.db.storage.clear();
  });

  afterAll(async () => {
    await booted.close();
  });

  it("POST /branding/assets/logoLight accepts a valid PNG and returns an API-local signed URL", async () => {
    const response = await supertest(booted.app.getHttpServer())
      .post("/branding/assets/logoLight")
      .set("Cookie", ownerCookie)
      .attach("file", makePngBuffer(1024), "logo.png")
      .expect(201);

    const body = response.body as { kind: string; contentType: string; url: string };
    expect(body.kind).toBe("logoLight");
    expect(body.contentType).toBe("image/png");
    expect(body.url).toMatch(/^\/branding\/assets\/logoLight\/content\?token=/);
    expect(body.url).not.toContain("memory://");
    expect(body.url).not.toContain("bucket");
    expect(body.url).not.toContain("asset_key");

    const asset = [...booted.db.tables.brandingAssets.values()].find(
      (row) => row.tenantId === tenantAId
    );
    assert(asset);
    expect(asset.kind).toBe("LOGO_LIGHT");

    const audit = [...booted.db.tables.audits.values()].find(
      (row) => (row as AuditRow).action === "branding.asset.created"
    );
    assert(audit);
    expect((audit as AuditRow).tenantId).toBe(tenantAId);
  });

  it("POST /branding/assets/logoLight rejects a 3 MiB PNG with 413", async () => {
    const response = await supertest(booted.app.getHttpServer())
      .post("/branding/assets/logoLight")
      .set("Cookie", ownerCookie)
      .attach("file", makePngBuffer(3 * 1024 * 1024), "logo.png")
      .expect(413);

    const body = response.body as ErrorEnvelope;
    expect(body.error.code).toBe("PAYLOAD_TOO_LARGE");
    expect(booted.db.tables.brandingAssets.size).toBe(0);
  });

  it("POST /branding/assets/logoLight rejects a disguised non-image with 400", async () => {
    // A plain text payload named logo.png: declared MIME is image/png but the
    // magic-byte sniff cannot identify it, so the content check rejects it.
    const response = await supertest(booted.app.getHttpServer())
      .post("/branding/assets/logoLight")
      .set("Cookie", ownerCookie)
      .attach("file", Buffer.from("this is not an image"), "logo.png")
      .expect(400);

    const body = response.body as ErrorEnvelope;
    expect(body.error.code).toBe("VALIDATION_FAILED");
    expect(booted.db.tables.brandingAssets.size).toBe(0);
  });

  it("GET /branding/assets/logoLight returns 404 for Tenant B (no asset)", async () => {
    // Seed Tenant A with an asset first to prove the endpoint is functional.
    await supertest(booted.app.getHttpServer())
      .post("/branding/assets/logoLight")
      .set("Cookie", ownerCookie)
      .attach("file", makePngBuffer(1024), "logo.png")
      .expect(201);

    // Tenant B has no logoLight asset; the endpoint resolves to Tenant B from
    // the session and returns 404, hiding Tenant A's asset existence.
    const response = await supertest(booted.app.getHttpServer())
      .get("/branding/assets/logoLight")
      .set("Cookie", tenantBOwnerCookieLocal)
      .expect(404);

    const body = response.body as ErrorEnvelope;
    expect(body.error.code).toBe("NOT_FOUND");
  });

  it("POST /branding/assets/logoLight returns 403 without the manage permission", async () => {
    await supertest(booted.app.getHttpServer())
      .post("/branding/assets/logoLight")
      .set("Cookie", noPermissionCookieLocal)
      .attach("file", makePngBuffer(1024), "logo.png")
      .expect(403);
  });

  it("POST /branding/assets/logoLight returns 403 without the custom_branding entitlement", async () => {
    const tenantC = booted.db.prisma.tenant.create({ data: { slug: "asset-c", name: "C" } });
    const role = seedRoleWithKeys(booted.db, "BRANDING_C", "Branding C", [
      "branding.settings.manage",
    ]);
    const profile = booted.db.prisma.userProfile.create({
      data: { email: "asset-c@test.test", displayName: "C", status: "active" },
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
      .post("/branding/assets/logoLight")
      .set("Cookie", cookie)
      .attach("file", makePngBuffer(1024), "logo.png")
      .expect(403);

    expect((response.body as ErrorEnvelope).error.code).toBe("FEATURE_NOT_ENTITLED");
  });

  // API invariant (DEC-004, design D1): tenant identity is authoritative from
  // the authenticated request context only. Upload/remove/signed-URL routes
  // accept no client-supplied tenant id, so a "foreign target" cannot be
  // expressed; a client tenant id is never trusted. Equivalent isolation is
  // proven by the tenant-relative tests below plus the cross-tenant
  // access/removal cases that follow.
  it("keeps a tenant B upload tenant-relative and never touches tenant A", async () => {
    // Seed Tenant A with an asset.
    await supertest(booted.app.getHttpServer())
      .post("/branding/assets/logoLight")
      .set("Cookie", ownerCookie)
      .attach("file", makePngBuffer(1024), "logo.png")
      .expect(201);

    // Tenant B owner uploads a logo. Their tenant context resolves to B, so
    // this creates a Tenant B asset without touching Tenant A.
    await supertest(booted.app.getHttpServer())
      .post("/branding/assets/logoLight")
      .set("Cookie", tenantBOwnerCookieLocal)
      .attach("file", makePngBuffer(2048), "logo-b.png")
      .expect(201);

    // Tenant A's asset must remain exactly one row with the original size.
    const tenantAAssets = [...booted.db.tables.brandingAssets.values()].filter(
      (row) => row.tenantId === tenantAId
    );
    expect(tenantAAssets).toHaveLength(1);
    expect(tenantAAssets[0]?.byteSize).toBe(1024);

    // Tenant B must have its own separate asset.
    const tenantBAssets = [...booted.db.tables.brandingAssets.values()].filter(
      (row) => row.tenantId !== tenantAId
    );
    expect(tenantBAssets).toHaveLength(1);
    expect(tenantBAssets[0]?.byteSize).toBe(2048);
  });

  it("never accepts a client-supplied tenant id as authority", async () => {
    const foreignTenantId = "00000000-0000-0000-0000-000000000000";

    await supertest(booted.app.getHttpServer())
      .post("/branding/assets/favicon")
      .query({ tenantId: foreignTenantId })
      .set("Cookie", ownerCookie)
      .set("x-tenant-id", foreignTenantId)
      .attach("file", makePngBuffer(256), "favicon.png")
      .expect(201);

    const rows = [...booted.db.tables.brandingAssets.values()];
    // The foreign id must never be written or treated as authority.
    expect(rows.some((row) => row.tenantId === foreignTenantId)).toBe(false);
    const tenantAFavicons = rows.filter(
      (row) => row.tenantId === tenantAId && row.kind === "FAVICON"
    );
    expect(tenantAFavicons).toHaveLength(1);
  });

  it("GET /branding/assets/:kind/content proxies bytes without exposing storage internals", async () => {
    const upload = await supertest(booted.app.getHttpServer())
      .post("/branding/assets/logoLight")
      .set("Cookie", ownerCookie)
      .attach("file", makePngBuffer(1024), "logo.png")
      .expect(201);

    const signedUrl = (upload.body as { url: string }).url;
    const contentResponse = await supertest(booted.app.getHttpServer())
      .get(signedUrl)
      .set("Cookie", ownerCookie)
      .expect(200)
      .expect("Content-Type", "image/png");

    expect(contentResponse.body).toBeInstanceOf(Buffer);
    expect((contentResponse.body as Buffer).length).toBe(1024);
  });

  it("GET /branding/assets/:kind/content rejects a tampered token", async () => {
    await supertest(booted.app.getHttpServer())
      .post("/branding/assets/logoLight")
      .set("Cookie", ownerCookie)
      .attach("file", makePngBuffer(1024), "logo.png")
      .expect(201);

    const response = await supertest(booted.app.getHttpServer())
      .get("/branding/assets/logoLight/content?token=tampered")
      .set("Cookie", ownerCookie)
      .expect(400);

    expect((response.body as ErrorEnvelope).error.code).toBe("VALIDATION_FAILED");
  });

  it("GET /branding/assets/:kind/content returns 404 after the asset is removed", async () => {
    const upload = await supertest(booted.app.getHttpServer())
      .post("/branding/assets/logoLight")
      .set("Cookie", ownerCookie)
      .attach("file", makePngBuffer(1024), "logo.png")
      .expect(201);

    const signedUrl = (upload.body as { url: string }).url;

    await supertest(booted.app.getHttpServer())
      .delete("/branding/assets/logoLight")
      .set("Cookie", ownerCookie)
      .expect(200);

    await supertest(booted.app.getHttpServer())
      .get(signedUrl)
      .set("Cookie", ownerCookie)
      .expect(404);
  });

  it("replacement revokes the prior signed URL and keeps only one row per kind", async () => {
    const first = await supertest(booted.app.getHttpServer())
      .post("/branding/assets/logoLight")
      .set("Cookie", ownerCookie)
      .attach("file", makePngBuffer(1024), "logo.png")
      .expect(201);

    const firstUrl = (first.body as { url: string }).url;

    // Wait a tick so updatedAt timestamps differ, proving cache invalidation.
    await new Promise((resolve) => setTimeout(resolve, 10));

    const second = await supertest(booted.app.getHttpServer())
      .post("/branding/assets/logoLight")
      .set("Cookie", ownerCookie)
      .attach("file", makePngBuffer(2048), "logo.png")
      .expect(201);

    const secondUrl = (second.body as { url: string }).url;
    expect(secondUrl).not.toBe(firstUrl);

    // Only one BrandingAsset row exists for this tenant+kind (unique
    // constraint satisfied by delete-before-create ordering).
    const assets = [...booted.db.tables.brandingAssets.values()].filter(
      (row) => row.tenantId === tenantAId && row.kind === "LOGO_LIGHT"
    );
    expect(assets).toHaveLength(1);
    expect(assets[0]?.byteSize).toBe(2048);

    // The prior content URL is no longer valid because the asset row is gone.
    await supertest(booted.app.getHttpServer())
      .get(firstUrl)
      .set("Cookie", ownerCookie)
      .expect(404);

    // The new content URL serves the replacement bytes.
    const contentResponse = await supertest(booted.app.getHttpServer())
      .get(secondUrl)
      .set("Cookie", ownerCookie)
      .expect(200);
    expect((contentResponse.body as Buffer).length).toBe(2048);
  });

  it("delivers public signed asset bytes anonymously via the token route", async () => {
    await supertest(booted.app.getHttpServer())
      .post("/branding/assets/logoLight")
      .set("Cookie", ownerCookie)
      .attach("file", makePngBuffer(1024), "logo.png")
      .expect(201);

    const publicResponse = await supertest(booted.app.getHttpServer())
      .get("/api/v1/public/tenants/asset-a/branding")
      .expect(200);
    const url = (publicResponse.body as { logoLightUrl?: string }).logoLightUrl;
    expect(url).toMatch(
      /^http:\/\/localhost:3001\/api\/v1\/public\/branding\/assets\/logoLight\/content\?token=/
    );

    // No cookie, no auth header: the HMAC token alone grants delivery.
    const content = await supertest(booted.app.getHttpServer())
      .get(pathOf(url!))
      .expect(200)
      .expect("Content-Type", "image/png");
    expect((content.body as Buffer).length).toBe(1024);
  });

  it("rejects an expired anonymous asset token", async () => {
    await supertest(booted.app.getHttpServer())
      .post("/branding/assets/logoLight")
      .set("Cookie", ownerCookie)
      .attach("file", makePngBuffer(1024), "logo.png")
      .expect(201);

    const asset = [...booted.db.tables.brandingAssets.values()].find(
      (row) => row.tenantId === tenantAId && row.kind === "LOGO_LIGHT"
    );
    assert(asset);
    const token = craftToken({ kind: "logoLight", assetId: asset.id, exp: Date.now() - 1000 });

    const response = await supertest(booted.app.getHttpServer())
      .get(`/api/v1/public/branding/assets/logoLight/content?token=${token}`)
      .expect(403);
    expect((response.body as ErrorEnvelope).error.code).toBe("FORBIDDEN");
  });

  it("rejects a tampered anonymous asset token", async () => {
    await supertest(booted.app.getHttpServer())
      .post("/branding/assets/logoLight")
      .set("Cookie", ownerCookie)
      .attach("file", makePngBuffer(1024), "logo.png")
      .expect(201);

    const asset = [...booted.db.tables.brandingAssets.values()].find(
      (row) => row.tenantId === tenantAId && row.kind === "LOGO_LIGHT"
    );
    assert(asset);
    const valid = craftToken({ kind: "logoLight", assetId: asset.id, exp: Date.now() + 60_000 });
    const decoded = JSON.parse(Buffer.from(valid, "base64url").toString("utf8")) as {
      signature: string;
    };
    decoded.signature =
      decoded.signature.slice(0, -1) + (decoded.signature.endsWith("A") ? "B" : "A");
    const tampered = Buffer.from(JSON.stringify(decoded)).toString("base64url");

    const response = await supertest(booted.app.getHttpServer())
      .get(`/api/v1/public/branding/assets/logoLight/content?token=${tampered}`)
      .expect(400);
    expect((response.body as ErrorEnvelope).error.code).toBe("VALIDATION_FAILED");
  });

  it("hides tenant A's asset content from a tenant B staff session", async () => {
    const upload = await supertest(booted.app.getHttpServer())
      .post("/branding/assets/logoLight")
      .set("Cookie", ownerCookie)
      .attach("file", makePngBuffer(1024), "logo.png")
      .expect(201);
    const signedUrl = (upload.body as { url: string }).url;

    // Tenant B presents Tenant A's signed URL to the private content route:
    // the request-context tenant (B) has no matching asset, so it is hidden.
    await supertest(booted.app.getHttpServer())
      .get(signedUrl)
      .set("Cookie", tenantBOwnerCookieLocal)
      .expect(404);

    await supertest(booted.app.getHttpServer())
      .get(signedUrl)
      .set("Cookie", ownerCookie)
      .expect(200);
  });

  it("does not let a tenant B member remove tenant A's asset", async () => {
    await supertest(booted.app.getHttpServer())
      .post("/branding/assets/logoLight")
      .set("Cookie", ownerCookie)
      .attach("file", makePngBuffer(1024), "logo.png")
      .expect(201);

    const response = await supertest(booted.app.getHttpServer())
      .delete("/branding/assets/logoLight")
      .set("Cookie", tenantBOwnerCookieLocal)
      .expect(200);
    expect((response.body as { removed: boolean }).removed).toBe(false);

    const remaining = [...booted.db.tables.brandingAssets.values()].filter(
      (row) => row.tenantId === tenantAId && row.kind === "LOGO_LIGHT"
    );
    expect(remaining).toHaveLength(1);
    await supertest(booted.app.getHttpServer())
      .get("/branding/assets/logoLight")
      .set("Cookie", ownerCookie)
      .expect(200);
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

describe("Tenant lifecycle boundary fake parity", () => {
  it("defaults an omitted tenant status to ACTIVE", () => {
    const db = createIsolationDatabase();
    const active = db.prisma.tenant.create({ data: { slug: "parity-active", name: "Active" } });
    expect(active.status).toBe("ACTIVE");
  });

  it("excludes a SUSPENDED row from an ACTIVE status filter", () => {
    const db = createIsolationDatabase();
    const active = db.prisma.tenant.create({ data: { slug: "parity-active", name: "Active" } });
    db.prisma.tenant.create({
      data: { slug: "parity-suspended", name: "Suspended", status: "SUSPENDED" },
    });

    expect(
      db.prisma.tenant.findUnique({ where: { slug: "parity-active", status: "ACTIVE" } })
    ).toEqual(active);
    expect(
      db.prisma.tenant.findUnique({ where: { slug: "parity-suspended", status: "ACTIVE" } })
    ).toBeNull();
  });
});
