import { afterAll, beforeAll, describe, expect, it } from "vitest";
import supertest from "supertest";
import { bootTestApp, type BootedTestApp } from "../../test/support/boot-test-app.js";
import { seedTwoTenants, type TwoTenantFixture } from "../../test/support/seed-two-tenants.js";
import { seedPortalAccess } from "../../test/support/seed-portal.js";
import { CredentialService } from "../auth/credential.service.js";
import { STAFF_SESSION_COOKIE } from "../auth/session-cookie.js";
import { PORTAL_SESSION_COOKIE } from "./portal-session-cookie.js";

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

/** Extracts the `name=value` pair of the first Set-Cookie with that name. */
function readCookie(res: supertest.Response, name: string): string {
  const cookies = res.headers["set-cookie"] as unknown as string[];
  const match = cookies.find((cookie) => cookie.startsWith(`${name}=`));
  if (!match) {
    throw new Error(`Expected a ${name} cookie in: ${cookies.join(" | ")}`);
  }
  return match.split(";")[0] ?? match;
}

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

  describe("portal login / logout", () => {
    it("authenticates a holder, sets ONLY the portal cookie, and serves /portal/me", async () => {
      const login = await supertest(server())
        .post("/portal/login")
        .send({
          tenantSlug: fixture.tenants.a.slug,
          email: HOLDER_EMAIL,
          password: HOLDER_PASSWORD,
        })
        .expect(200);

      const body = login.body as { portal: { portalAccessId: string; customerId: string } };
      expect(body.portal.portalAccessId).toBe(holderAId);
      expect(body.portal.customerId).toBe(customerAId);

      const portalsessionCookie = readCookie(login, PORTAL_SESSION_COOKIE);
      const setCookieHeader = login.headers["set-cookie"] as unknown as string[];
      expect(setCookieHeader.some((entry) => entry.startsWith(`${STAFF_SESSION_COOKIE}=`))).toBe(
        false
      );

      const me = await supertest(server())
        .get("/portal/me")
        .set("Cookie", portalsessionCookie)
        .expect(200);
      expect((me.body as PortalMeBody).portal.portalAccessId).toBe(holderAId);
    });

    it("rejects the holder email under the WRONG tenant slug with 401", async () => {
      const response = await supertest(server())
        .post("/portal/login")
        .send({
          tenantSlug: fixture.tenants.b.slug,
          email: HOLDER_EMAIL,
          password: HOLDER_PASSWORD,
        })
        .expect(401);
      expect((response.body as ErrorEnvelopeBody).error.code).toBe("UNAUTHENTICATED");
    });

    it("returns the byte-identical 401 envelope for a wrong password and an unknown holder", async () => {
      const requestId = "portal-login-enumeration-proof";
      const wrongPassword = await supertest(server())
        .post("/portal/login")
        .set("X-Request-Id", requestId)
        .send({
          tenantSlug: fixture.tenants.a.slug,
          email: HOLDER_EMAIL,
          password: "definitely-wrong-password",
        })
        .expect(401);
      const unknownHolder = await supertest(server())
        .post("/portal/login")
        .set("X-Request-Id", requestId)
        .send({
          tenantSlug: fixture.tenants.a.slug,
          email: "nobody@portal.test",
          password: HOLDER_PASSWORD,
        })
        .expect(401);

      expect(wrongPassword.text).toBe(unknownHolder.text);
      expect((wrongPassword.body as ErrorEnvelopeBody).error.code).toBe("UNAUTHENTICATED");
      // No cookie is issued on any failure path.
      expect(wrongPassword.headers["set-cookie"]).toBeUndefined();
    });

    it("denies login for a valid holder in an unentitled tenant (403, no session issued)", async () => {
      const response = await supertest(server())
        .post("/portal/login")
        .send({
          tenantSlug: fixture.tenants.b.slug,
          email: HOLDER_B_EMAIL,
          password: HOLDER_PASSWORD,
        })
        .expect(403);
      expect((response.body as ErrorEnvelopeBody).error.code).toBe("FEATURE_NOT_ENTITLED");
      expect(response.headers["set-cookie"]).toBeUndefined();
    });

    it("revokes the presented session on logout and rejects replays with 401", async () => {
      const login = await supertest(server())
        .post("/portal/login")
        .send({
          tenantSlug: fixture.tenants.a.slug,
          email: HOLDER_EMAIL,
          password: HOLDER_PASSWORD,
        })
        .expect(200);
      const cookie = readCookie(login, PORTAL_SESSION_COOKIE);

      await supertest(server()).get("/portal/me").set("Cookie", cookie).expect(200);
      await supertest(server()).post("/portal/logout").set("Cookie", cookie).expect(204);
      await supertest(server()).get("/portal/me").set("Cookie", cookie).expect(401);
    });

    it("records PORTAL-attributed audit rows for login success and failure", async () => {
      const successRequestId = "portal-login-audit-success";
      await supertest(server())
        .post("/portal/login")
        .set("X-Request-Id", successRequestId)
        .send({
          tenantSlug: fixture.tenants.a.slug,
          email: HOLDER_EMAIL,
          password: HOLDER_PASSWORD,
        })
        .expect(200);

      const failedRequestId = "portal-login-audit-failure";
      await supertest(server())
        .post("/portal/login")
        .set("X-Request-Id", failedRequestId)
        .send({
          tenantSlug: fixture.tenants.a.slug,
          email: HOLDER_EMAIL,
          password: "nope-not-the-password",
        })
        .expect(401);

      const success = booted.db.prisma.auditLog.findFirst({
        where: { requestId: successRequestId },
      });
      expect(success?.action).toBe("portal.login_succeeded");
      expect(success?.actorType).toBe("PORTAL");
      expect(success?.actorPortalAccessId).toBe(holderAId);
      expect(success?.actorUserProfileId).toBeUndefined();

      const failure = booted.db.prisma.auditLog.findFirst({
        where: { requestId: failedRequestId },
      });
      expect(failure?.action).toBe("portal.login_failed");
      expect(failure?.actorType).toBe("PORTAL");
      expect(failure?.actorPortalAccessId).toBe(holderAId);
    });

    it("fails closed when two ACTIVE holders share the login email instead of resolving an arbitrary holder", async () => {
      // The partial unique index (tenant_id, contact_email) WHERE ACTIVE forbids
      // this state; the in-memory boundary does not enforce indexes, so seed the
      // legacy/out-of-band shape directly to prove the LOGIN path itself refuses
      // to pick one holder.
      const passwordHash = await booted.app.get(CredentialService).hash(HOLDER_PASSWORD);
      const ambiguousEmail = "ambiguous-holder@portal.test";

      const createCustomer = (displayName: string): string =>
        booted.db.prisma.customer.create({
          data: {
            tenantId: fixture.tenants.a.id,
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

      for (const displayName of ["Ambiguous Holder One", "Ambiguous Holder Two"]) {
        seedPortalAccess(booted.db, {
          tenantId: fixture.tenants.a.id,
          customerId: createCustomer(displayName),
          contactEmail: ambiguousEmail,
          passwordHash,
        });
      }

      const requestId = "portal-login-ambiguous-identity";
      const response = await supertest(server())
        .post("/portal/login")
        .set("X-Request-Id", requestId)
        .send({
          tenantSlug: fixture.tenants.a.slug,
          email: ambiguousEmail,
          password: HOLDER_PASSWORD,
        })
        .expect(401);

      expect((response.body as ErrorEnvelopeBody).error.code).toBe("UNAUTHENTICATED");
      // No session is issued on the ambiguous path.
      expect(response.headers["set-cookie"]).toBeUndefined();

      // No single holder is authoritative, so the failure must not be pinned to
      // an arbitrary one: it stays SYSTEM-attributed.
      const audit = booted.db.prisma.auditLog.findFirst({ where: { requestId } });
      expect(audit?.action).toBe("portal.login_failed");
      expect(audit?.actorType).toBe("SYSTEM");
      expect(audit?.actorPortalAccessId).toBeUndefined();
    });

    it("fails closed on case-variant duplicates of the same canonical login email", async () => {
      // The DB key is (tenant_id, lower(contact_email)) WHERE ACTIVE and login
      // matches case-insensitively, so "Holder@…" and "holder@…" are ONE
      // identity. The in-memory boundary does not enforce indexes, so seed the
      // pre-fix shape directly: the canonical read must see BOTH rows and fail
      // closed instead of authenticating as whichever one a case-sensitive
      // lookup happened to hit.
      const passwordHash = await booted.app.get(CredentialService).hash(HOLDER_PASSWORD);
      const lowerEmail = "case-variant-holder@portal.test";

      const createCustomer = (displayName: string): string =>
        booted.db.prisma.customer.create({
          data: {
            tenantId: fixture.tenants.a.id,
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

      for (const contactEmail of [lowerEmail, lowerEmail.toUpperCase()]) {
        seedPortalAccess(booted.db, {
          tenantId: fixture.tenants.a.id,
          customerId: createCustomer(`Case Variant ${contactEmail}`),
          contactEmail,
          passwordHash,
        });
      }

      const requestId = "portal-login-case-variant-identity";
      const response = await supertest(server())
        .post("/portal/login")
        .set("X-Request-Id", requestId)
        .send({
          tenantSlug: fixture.tenants.a.slug,
          email: lowerEmail,
          password: HOLDER_PASSWORD,
        })
        .expect(401);

      expect((response.body as ErrorEnvelopeBody).error.code).toBe("UNAUTHENTICATED");
      expect(response.headers["set-cookie"]).toBeUndefined();

      // Both rows are the same canonical identity, so neither is authoritative:
      // the failure must stay SYSTEM-attributed.
      const audit = booted.db.prisma.auditLog.findFirst({ where: { requestId } });
      expect(audit?.action).toBe("portal.login_failed");
      expect(audit?.actorType).toBe("SYSTEM");
      expect(audit?.actorPortalAccessId).toBeUndefined();
    });
  });
});
