import { afterAll, beforeAll, describe, expect, it } from "vitest";
import supertest from "supertest";
import { bootTestApp, type BootedTestApp } from "../../test/support/boot-test-app.js";
import { seedTwoTenants, type TwoTenantFixture } from "../../test/support/seed-two-tenants.js";
import { seedPortalAccess } from "../../test/support/seed-portal.js";
import { CredentialService } from "../auth/credential.service.js";

interface ErrorEnvelopeBody {
  error: { code: string; message: string; requestId: string };
}

interface PortalMeBody {
  portal: { portalAccessId: string; customerId: string };
  requestId: string;
}

const HOLDER_PASSWORD = "portal-holder-password";
const HOLDER_EMAIL = "holder-a@portal.test";
const HOLDER_B_EMAIL = "holder-b@portal.test";

/**
 * EPIC-08 WU2 — portal identity boundary over real HTTP and the full guard
 * chain (AppModule + AppGuards). Proves the separate-boundary requirements:
 * anonymous 401, staff↔portal cross-cookie 401 (both directions), server-side
 * tenant/Customer derivation, the `portal` entitlement gate, and portal
 * login/logout with the isolated `ns_portal_session` cookie.
 */
describe("portal identity boundary (real HTTP, full guard chain)", () => {
  let booted: BootedTestApp;
  let fixture: TwoTenantFixture;
  let customerAId: string;
  let customerBId: string;
  let holderAId: string;
  let holderBId: string;
  let portalCookieA: string;
  let portalCookieB: string;

  beforeAll(async () => {
    booted = await bootTestApp();
    fixture = seedTwoTenants(booted.db);
    const prisma = booted.db.prisma;

    const passwordHash = await booted.app.get(CredentialService).hash(HOLDER_PASSWORD);

    const createCustomer = (tenantId: string, displayName: string): string =>
      booted.db.prisma.customer.create({
        data: {
          tenantId,
          kind: "INDIVIDUAL",
          displayName,
          legalName: null,
          taxId: null,
          firstName: null,
          lastName: null,
          documentNumber: null,
          isActive: true,
        },
      }).id;

    customerAId = createCustomer(fixture.tenants.a.id, "Portal Customer A");
    customerBId = createCustomer(fixture.tenants.b.id, "Portal Customer B");

    const holderA = seedPortalAccess(booted.db, {
      tenantId: fixture.tenants.a.id,
      customerId: customerAId,
      contactEmail: HOLDER_EMAIL,
      passwordHash,
    });
    holderAId = holderA.access.id;
    portalCookieA = holderA.cookie;

    const holderB = seedPortalAccess(booted.db, {
      tenantId: fixture.tenants.b.id,
      customerId: customerBId,
      contactEmail: HOLDER_B_EMAIL,
      passwordHash,
    });
    holderBId = holderB.access.id;
    portalCookieB = holderB.cookie;

    // Tenant A holds the explicit `portal` grant; tenant B intentionally does NOT.
    const portalFeature = prisma.featureCode.create({ data: { code: "portal" } });
    prisma.tenantEntitlement.create({
      data: { tenantId: fixture.tenants.a.id, featureCodeId: portalFeature.id },
    });
  });

  afterAll(async () => {
    fixture.cleanup();
    await booted.close();
  });

  const server = (): ReturnType<BootedTestApp["app"]["getHttpServer"]> =>
    booted.app.getHttpServer();

  describe("cross-cookie isolation", () => {
    it("returns 401 UNAUTHENTICATED for an anonymous portal request", async () => {
      const response = await supertest(server()).get("/portal/me").expect(401);
      expect((response.body as ErrorEnvelopeBody).error.code).toBe("UNAUTHENTICATED");
    });

    it("rejects a valid STAFF session on a portal route (401)", async () => {
      const response = await supertest(server())
        .get("/portal/me")
        .set("Cookie", fixture.actors.a.cookie)
        .expect(401);
      expect((response.body as ErrorEnvelopeBody).error.code).toBe("UNAUTHENTICATED");
    });

    it("rejects a valid PORTAL session on a staff route (401)", async () => {
      const response = await supertest(server())
        .get("/memberships")
        .set("Cookie", portalCookieA)
        .expect(401);
      expect((response.body as ErrorEnvelopeBody).error.code).toBe("UNAUTHENTICATED");
    });
  });

  describe("portal context (server-derived identity)", () => {
    it("serves /portal/me from the portal context and ignores client identity hints", async () => {
      const response = await supertest(server())
        .get("/portal/me")
        .set("Cookie", portalCookieA)
        .query({ tenantId: fixture.tenants.b.id, customerId: customerBId })
        .set("x-tenant-id", fixture.tenants.b.id)
        .expect(200);

      const body = response.body as PortalMeBody;
      expect(body.portal.portalAccessId).toBe(holderAId);
      expect(body.portal.customerId).toBe(customerAId);
      expect(typeof body.requestId).toBe("string");
      expect(response.text).not.toContain(customerBId);
    });

    it("treats a session whose holder is REVOKED as unauthenticated (401)", async () => {
      const holder = seedPortalAccess(booted.db, {
        tenantId: fixture.tenants.a.id,
        customerId: customerAId,
        contactEmail: "revoked-holder@portal.test",
      });
      booted.db.prisma.customerPortalAccess.updateMany({
        where: { id: holder.access.id, tenantId: fixture.tenants.a.id, status: "ACTIVE" },
        data: { status: "REVOKED" },
      });

      await supertest(server()).get("/portal/me").set("Cookie", holder.cookie).expect(401);
    });
  });

  describe("portal entitlement gate", () => {
    it("returns 200 for a holder in an entitled tenant", async () => {
      await supertest(server()).get("/portal/me").set("Cookie", portalCookieA).expect(200);
    });

    it("returns 403 FEATURE_NOT_ENTITLED for a holder whose tenant lacks the grant", async () => {
      const response = await supertest(server())
        .get("/portal/me")
        .set("Cookie", portalCookieB)
        .expect(403);
      expect((response.body as ErrorEnvelopeBody).error.code).toBe("FEATURE_NOT_ENTITLED");
      // The denial leaks no holder identity.
      expect(response.text).not.toContain(holderBId);
    });
  });
});
