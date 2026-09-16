import { afterAll, beforeAll, describe, expect, it } from "vitest";
import supertest from "supertest";
import { bootTestApp, type BootedTestApp } from "../../test/support/boot-test-app.js";
import {
  insertLiveStaffSession,
  seedTwoTenants,
  type TwoTenantFixture,
} from "../../test/support/seed-two-tenants.js";
import { PORTAL_SESSION_COOKIE } from "./portal-session-cookie.js";
import { PORTAL_ACCESS_PERMISSION } from "./portal.constants.js";

interface ErrorEnvelopeBody {
  error: { code: string; message: string; requestId: string };
}

interface PortalAccessBody {
  id: string;
  tenantId: string;
  customerId: string;
  contactEmail: string;
  status: "ACTIVE" | "REVOKED";
}

const PROVISION_EMAIL = "provisioned-holder@portal.test";
const PROVISION_PASSWORD = "provision-portal-password";
const SECOND_EMAIL = "second-holder@portal.test";

function readCookie(res: supertest.Response, name: string): string {
  const cookies = res.headers["set-cookie"] as unknown as string[];
  const match = cookies.find((cookie) => cookie.startsWith(`${name}=`));
  if (!match) {
    throw new Error(`Expected a ${name} cookie in: ${cookies.join(" | ")}`);
  }
  return match.split(";")[0] ?? match;
}

/**
 * EPIC-08 WU2 — staff-operated portal-access provisioning/revocation over real
 * HTTP. Proves the one-active-holder rule (409), cross-tenant masking (404),
 * the `portal` entitlement gate (403 FEATURE_NOT_ENTITLED), the staff
 * permission gate (403 FORBIDDEN), and that revocation both invalidates live
 * portal sessions and writes one STAFF-audited row.
 */
describe("portal access provisioning and revocation (real HTTP)", () => {
  let booted: BootedTestApp;
  let fixture: TwoTenantFixture;
  let customerAId: string;
  let customerBId: string;
  let noPermissionCookie: string;

  beforeAll(async () => {
    booted = await bootTestApp();
    fixture = seedTwoTenants(booted.db);
    const prisma = booted.db.prisma;

    // Grant the portal access-management permission to the fixture role used by
    // actors a and b (least-privilege harness still exercises the real resolver).
    const permission =
      prisma.permission.findUnique({ where: { key: PORTAL_ACCESS_PERMISSION } }) ??
      prisma.permission.create({
        data: { key: PORTAL_ACCESS_PERMISSION, name: "Manage customer portal access" },
      });
    prisma.rolePermission.create({
      data: { roleId: fixture.role.id, permissionId: permission.id },
    });

    // Tenant A holds the explicit `portal` grant; tenant B intentionally does NOT.
    const portalFeature = prisma.featureCode.create({ data: { code: "portal" } });
    prisma.tenantEntitlement.create({
      data: { tenantId: fixture.tenants.a.id, featureCodeId: portalFeature.id },
    });

    const createCustomer = (tenantId: string, displayName: string): string =>
      prisma.customer.create({
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
    customerAId = createCustomer(fixture.tenants.a.id, "Portal Access Customer A");
    customerBId = createCustomer(fixture.tenants.b.id, "Portal Access Customer B");

    // A member of tenant A whose role holds NO portal permission. Proves the
    // route-declared `portal.access.manage` is actually enforced (not implied by
    // authentication or membership).
    const restrictedRole = prisma.role.create({
      data: { code: `RECEPTION-${fixture.suffix}`, name: "Reception (no portal perms)" },
    });
    const restrictedProfile = prisma.userProfile.create({
      data: {
        email: `restricted-${fixture.suffix}@isolation.test`,
        displayName: "Restricted Reception",
        status: "active",
      },
    });
    prisma.tenantMembership.create({
      data: {
        tenantId: fixture.tenants.a.id,
        userProfileId: restrictedProfile.id,
        roleId: restrictedRole.id,
        status: "ACTIVE",
      },
    });
    noPermissionCookie = insertLiveStaffSession(booted.db, restrictedProfile.id).cookie;
  });

  afterAll(async () => {
    fixture.cleanup();
    await booted.close();
  });

  const server = (): ReturnType<BootedTestApp["app"]["getHttpServer"]> =>
    booted.app.getHttpServer();

  const holdersFor = (customerId: string): number =>
    [...booted.db.tables.portalAccess.values()].filter((row) => row.customerId === customerId)
      .length;

  it("provisions the holder with a credential and a co-committed STAFF audit row", async () => {
    const requestId = "portal-access-provision";
    const response = await supertest(server())
      .post(`/customers/${customerAId}/portal-access`)
      .set("Cookie", fixture.actors.a.cookie)
      .set("X-Request-Id", requestId)
      .send({ email: PROVISION_EMAIL, password: PROVISION_PASSWORD })
      .expect(201);

    const body = response.body as PortalAccessBody;
    expect(body.tenantId).toBe(fixture.tenants.a.id);
    expect(body.customerId).toBe(customerAId);
    expect(body.contactEmail).toBe(PROVISION_EMAIL);
    expect(body.status).toBe("ACTIVE");
    // No credential material ever leaves the API.
    expect(response.text).not.toContain(PROVISION_PASSWORD);
    expect(response.text.toLowerCase()).not.toContain("hash");

    const holders = [...booted.db.tables.portalAccess.values()].filter(
      (row) => row.customerId === customerAId
    );
    expect(holders).toHaveLength(1);
    const credential = booted.db.tables.portalCredentials.get(holders[0].id);
    expect(credential?.passwordHash).toBeDefined();
    expect(credential?.passwordHash).not.toBe(PROVISION_PASSWORD);

    const audit = booted.db.prisma.auditLog.findFirst({ where: { requestId } });
    expect(audit?.action).toBe("portal_access.provisioned");
    expect(audit?.actorType).toBe("STAFF");
    expect(audit?.targetId).toBe(holders[0].id);

    // The provisioned holder can now authenticate (spec: "can authenticate").
    const login = await supertest(server())
      .post("/portal/login")
      .send({
        tenantSlug: fixture.tenants.a.slug,
        email: PROVISION_EMAIL,
        password: PROVISION_PASSWORD,
      })
      .expect(200);
    const cookie = readCookie(login, PORTAL_SESSION_COOKIE);
    await supertest(server()).get("/portal/me").set("Cookie", cookie).expect(200);
  });

  it("rejects a second holder for the same Customer with 409 and persists nothing", async () => {
    const before = holdersFor(customerAId);
    const response = await supertest(server())
      .post(`/customers/${customerAId}/portal-access`)
      .set("Cookie", fixture.actors.a.cookie)
      .send({ email: SECOND_EMAIL, password: PROVISION_PASSWORD })
      .expect(409);

    expect((response.body as ErrorEnvelopeBody).error.code).toBe("CONFLICT");
    expect(holdersFor(customerAId)).toBe(before);
    // No credential row was created for the rejected second holder.
    expect([...booted.db.tables.portalCredentials.values()]).toHaveLength(before);
  });

  it("rejects a different Customer reusing an ACTIVE login email with 409 and persists nothing", async () => {
    // The login id is (tenant, contactEmail) among ACTIVE holders (D8). Without
    // this rule a second Customer could claim the same email and portal login
    // would resolve an arbitrary holder.
    const secondCustomerId = booted.db.prisma.customer.create({
      data: {
        tenantId: fixture.tenants.a.id,
        kind: "INDIVIDUAL",
        displayName: "Portal Access Customer A2",
        legalName: null,
        taxId: null,
        firstName: null,
        lastName: null,
        documentNumber: null,
        isActive: true,
      },
    }).id;

    const before = booted.db.tables.portalAccess.size;
    const response = await supertest(server())
      .post(`/customers/${secondCustomerId}/portal-access`)
      .set("Cookie", fixture.actors.a.cookie)
      .send({ email: PROVISION_EMAIL, password: PROVISION_PASSWORD })
      .expect(409);

    expect((response.body as ErrorEnvelopeBody).error.code).toBe("CONFLICT");
    expect(booted.db.tables.portalAccess.size).toBe(before);
    expect(holdersFor(secondCustomerId)).toBe(0);
    // The conflict names no other Customer and creates no credential.
    expect(response.text).not.toContain(customerAId);
    expect([...booted.db.tables.portalCredentials.values()]).toHaveLength(before);
  });

  it("masks a cross-tenant Customer as 404 and persists nothing", async () => {
    const before = booted.db.tables.portalAccess.size;
    const response = await supertest(server())
      .post(`/customers/${customerBId}/portal-access`)
      .set("Cookie", fixture.actors.a.cookie)
      .send({ email: SECOND_EMAIL, password: PROVISION_PASSWORD })
      .expect(404);

    expect((response.body as ErrorEnvelopeBody).error.code).toBe("NOT_FOUND");
    expect(response.text).not.toContain(customerBId);
    expect(booted.db.tables.portalAccess.size).toBe(before);
  });

  it("returns 403 FORBIDDEN for a member without portal.access.manage", async () => {
    const response = await supertest(server())
      .post(`/customers/${customerAId}/portal-access`)
      .set("Cookie", noPermissionCookie)
      .send({ email: SECOND_EMAIL, password: PROVISION_PASSWORD })
      .expect(403);
    expect((response.body as ErrorEnvelopeBody).error.code).toBe("FORBIDDEN");
  });

  it("returns 403 FEATURE_NOT_ENTITLED when the tenant lacks the portal grant", async () => {
    const response = await supertest(server())
      .post(`/customers/${customerBId}/portal-access`)
      .set("Cookie", fixture.actors.b.cookie)
      .send({ email: SECOND_EMAIL, password: PROVISION_PASSWORD })
      .expect(403);
    expect((response.body as ErrorEnvelopeBody).error.code).toBe("FEATURE_NOT_ENTITLED");
    expect(holdersFor(customerBId)).toBe(0);
  });

  it("rejects a malformed provisioning body with 400 and persists nothing", async () => {
    const before = booted.db.tables.portalAccess.size;
    const response = await supertest(server())
      .post(`/customers/${customerAId}/portal-access`)
      .set("Cookie", fixture.actors.a.cookie)
      .send({ email: "not-an-email", password: "short" })
      .expect(400);
    expect((response.body as ErrorEnvelopeBody).error.code).toBe("VALIDATION_FAILED");
    expect(booted.db.tables.portalAccess.size).toBe(before);
  });

  it("revokes the holder, invalidates live sessions, and audits the revocation", async () => {
    // A live session obtained through the real login path.
    const login = await supertest(server())
      .post("/portal/login")
      .send({
        tenantSlug: fixture.tenants.a.slug,
        email: PROVISION_EMAIL,
        password: PROVISION_PASSWORD,
      })
      .expect(200);
    const cookie = readCookie(login, PORTAL_SESSION_COOKIE);
    await supertest(server()).get("/portal/me").set("Cookie", cookie).expect(200);

    const requestId = "portal-access-revoke";
    const response = await supertest(server())
      .post(`/customers/${customerAId}/portal-access/revoke`)
      .set("Cookie", fixture.actors.a.cookie)
      .set("X-Request-Id", requestId)
      .expect(201);
    expect((response.body as PortalAccessBody).status).toBe("REVOKED");

    // The previously live session is now rejected, and login is also refused
    // because no ACTIVE holder remains.
    await supertest(server()).get("/portal/me").set("Cookie", cookie).expect(401);
    await supertest(server())
      .post("/portal/login")
      .send({
        tenantSlug: fixture.tenants.a.slug,
        email: PROVISION_EMAIL,
        password: PROVISION_PASSWORD,
      })
      .expect(401);

    const audit = booted.db.prisma.auditLog.findFirst({ where: { requestId } });
    expect(audit?.action).toBe("portal_access.revoked");
    expect(audit?.actorType).toBe("STAFF");
  });

  it("masks a cross-tenant revocation as 404", async () => {
    const response = await supertest(server())
      .post(`/customers/${customerBId}/portal-access/revoke`)
      .set("Cookie", fixture.actors.a.cookie)
      .expect(404);
    expect((response.body as ErrorEnvelopeBody).error.code).toBe("NOT_FOUND");
  });
});
