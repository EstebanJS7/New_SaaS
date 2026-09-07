import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Test } from "@nestjs/testing";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import supertest from "supertest";
import { PrismaService } from "@newsaas/database";
import { AppModule } from "../src/app.module.js";
import { AUTH_CONFIG, readAuthConfig } from "../src/auth/auth.config.js";
import { SessionService } from "../src/auth/session.service.js";
import { STAFF_SESSION_COOKIE } from "../src/auth/session-cookie.js";
import { createApiLogger } from "../src/common/http/api-logger.factory.js";
import { createFastifyAdapter } from "../src/common/http/fastify-adapter.factory.js";

interface ErrorEnvelope {
  error: { code: string };
}

const NOT_FOUND_REQUEST_ID = "live-pg-not-found-proof";

interface CustomerDto {
  id: string;
  tenantId: string;
  kind: "INDIVIDUAL" | "COMPANY";
  displayName: string;
  isActive: boolean;
}

interface AddressDto {
  id: string;
  tenantId: string;
  customerId: string;
  line1: string | null;
  isActive: boolean;
}

interface ContactDto {
  id: string;
  tenantId: string;
  customerId: string;
  kind: "EMAIL" | "PHONE";
  value: string;
  isActive: boolean;
}

function adminDatabaseUrl(baseUrl: string): string {
  const url = new URL(baseUrl);
  url.pathname = "/postgres";
  return url.toString();
}

function createDatabase(baseUrl: string, name: string): void {
  execSync(`psql "${adminDatabaseUrl(baseUrl)}" -c "CREATE DATABASE ${name};"`, {
    stdio: "pipe",
    env: process.env,
  });
}

function dropDatabase(baseUrl: string, name: string): void {
  try {
    execSync(
      `psql "${adminDatabaseUrl(baseUrl)}" -c "DROP DATABASE IF EXISTS ${name} WITH (FORCE);"`,
      { stdio: "pipe", env: process.env }
    );
  } catch {
    // Best-effort cleanup; the test runner may have already torn the container down.
  }
}

function runDatabaseCommand(cwd: string, command: string, databaseUrl: string): void {
  execSync(command, {
    cwd,
    stdio: "pipe",
    env: { ...process.env, DATABASE_URL: databaseUrl },
  });
}

function restoreDatabaseUrl(previousDatabaseUrl: string | undefined): void {
  if (previousDatabaseUrl === undefined) {
    delete process.env.DATABASE_URL;
    return;
  }

  process.env.DATABASE_URL = previousDatabaseUrl;
}

const livePgDatabaseUrl = process.env.DATABASE_URL_TEST ?? process.env.DATABASE_URL;

/**
 * Live PostgreSQL application-path isolation evidence (TD-006 EPIC-03/EPIC-04
 * scope). This suite boots the real AppModule against a disposable PostgreSQL
 * database, applies migrations and reference seeds, and proves that the NestJS
 * guard chain + request context + service query paths return byte-equivalent
 * 404 for cross-tenant Customer/Address/Contact mutations and that
 * tenant-relative TenantBranding mutations remain isolated per tenant.
 *
 * Skipped automatically when no PostgreSQL URL is configured (e.g. local unit
 * runs); the CI migrations job supplies DATABASE_URL_TEST.
 */
describe.skipIf(!livePgDatabaseUrl)("live-pg application-path isolation", () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let baseDatabaseUrl: string;
  let testDatabaseName: string;
  let testDatabaseUrl: string;
  let previousDatabaseUrl: string | undefined;

  let tenantAId: string;
  let tenantBId: string;
  let ownerACookie: string;
  let ownerBCookie: string;
  let customerAId: string;
  let addressAId: string;
  let contactAId: string;

  beforeAll(async () => {
    previousDatabaseUrl = process.env.DATABASE_URL;
    baseDatabaseUrl = process.env.DATABASE_URL_TEST ?? process.env.DATABASE_URL ?? "";
    if (!baseDatabaseUrl) {
      throw new Error(
        "DATABASE_URL_TEST or DATABASE_URL is required to provision a disposable isolation database"
      );
    }

    testDatabaseName = `newsaas_isolation_${randomUUID().replace(/-/g, "_")}`;
    testDatabaseUrl = baseDatabaseUrl.replace(/\/[^/]*$/, `/${testDatabaseName}`);

    createDatabase(baseDatabaseUrl, testDatabaseName);

    const databasePackage = new URL("../../../packages/database", import.meta.url).pathname;
    runDatabaseCommand(databasePackage, "pnpm db:deploy", testDatabaseUrl);
    runDatabaseCommand(databasePackage, "pnpm db:seed", testDatabaseUrl);

    // PrismaService reads DATABASE_URL when AppModule constructs its client.
    // Point it at the disposable database only for this application boot.
    process.env.DATABASE_URL = testDatabaseUrl;

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(AUTH_CONFIG)
      .useValue({
        ...readAuthConfig(process.env),
        cookieSecure: false,
      })
      .compile();

    app = moduleRef.createNestApplication<NestFastifyApplication>(
      createFastifyAdapter({
        loggerInstance: createApiLogger({ level: "error" }),
      })
    );
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    prisma = app.get(PrismaService);

    const tenantA = await prisma.tenant.create({ data: { slug: "live-a", name: "Tenant A" } });
    const tenantB = await prisma.tenant.create({ data: { slug: "live-b", name: "Tenant B" } });
    tenantAId = tenantA.id;
    tenantBId = tenantB.id;

    const ownerRole = await prisma.role.findUnique({ where: { code: "OWNER" } });
    if (!ownerRole) {
      throw new Error("Reference seed did not create OWNER role");
    }

    const ownerA = await prisma.userProfile.create({
      data: { email: "owner-a@live.test", displayName: "Owner A", status: "active" },
    });
    const ownerB = await prisma.userProfile.create({
      data: { email: "owner-b@live.test", displayName: "Owner B", status: "active" },
    });

    await prisma.tenantMembership.create({
      data: {
        tenantId: tenantA.id,
        userProfileId: ownerA.id,
        roleId: ownerRole.id,
        status: "ACTIVE",
      },
    });
    await prisma.tenantMembership.create({
      data: {
        tenantId: tenantB.id,
        userProfileId: ownerB.id,
        roleId: ownerRole.id,
        status: "ACTIVE",
      },
    });

    const sessionService = app.get(SessionService);
    const sessionA = await sessionService.issue(ownerA.id);
    const sessionB = await sessionService.issue(ownerB.id);
    ownerACookie = `${STAFF_SESSION_COOKIE}=${sessionA.token}`;
    ownerBCookie = `${STAFF_SESSION_COOKIE}=${sessionB.token}`;

    const featureCode = await prisma.featureCode.create({ data: { code: "custom_branding" } });
    await prisma.tenantEntitlement.create({
      data: { tenantId: tenantA.id, featureCodeId: featureCode.id },
    });
    await prisma.tenantEntitlement.create({
      data: { tenantId: tenantB.id, featureCodeId: featureCode.id },
    });
  }, 120_000);

  afterAll(async () => {
    if (app) {
      await app.close();
    }
    restoreDatabaseUrl(previousDatabaseUrl);
    dropDatabase(baseDatabaseUrl, testDatabaseName);
  }, 30_000);

  it("creates tenant A customer/address/contact over real HTTP", async () => {
    const customerResponse = await supertest(app.getHttpServer())
      .post("/customers")
      .set("Cookie", ownerACookie)
      .send({ kind: "INDIVIDUAL", displayName: "Live Customer A" })
      .expect(201);
    const customer = customerResponse.body as CustomerDto;
    customerAId = customer.id;
    expect(customer.tenantId).toBe(tenantAId);

    const addressResponse = await supertest(app.getHttpServer())
      .post(`/customers/${customerAId}/addresses`)
      .set("Cookie", ownerACookie)
      .send({ line1: "Live Address 123" })
      .expect(201);
    const address = addressResponse.body as AddressDto;
    addressAId = address.id;
    expect(address.tenantId).toBe(tenantAId);
    expect(address.customerId).toBe(customerAId);

    const contactResponse = await supertest(app.getHttpServer())
      .post(`/customers/${customerAId}/contacts`)
      .set("Cookie", ownerACookie)
      .send({ kind: "EMAIL", value: "live@example.test" })
      .expect(201);
    const contact = contactResponse.body as ContactDto;
    contactAId = contact.id;
    expect(contact.tenantId).toBe(tenantAId);
    expect(contact.customerId).toBe(customerAId);
  });

  it("returns byte-equivalent 404 for cross-tenant customer mutations and does not mutate tenant A", async () => {
    const before = await prisma.customer.findUnique({ where: { id: customerAId } });
    expect(before).toBeTruthy();
    expect(before?.isActive).toBe(true);

    const cases = [
      {
        label: "PUT /customers/:id",
        request: supertest(app.getHttpServer())
          .put(`/customers/${customerAId}`)
          .set("Cookie", ownerBCookie)
          .set("X-Request-Id", NOT_FOUND_REQUEST_ID)
          .send({ displayName: "Tampered" }),
        missingRequest: supertest(app.getHttpServer())
          .put(`/customers/${randomUUID()}`)
          .set("Cookie", ownerBCookie)
          .set("X-Request-Id", NOT_FOUND_REQUEST_ID)
          .send({ displayName: "Tampered" }),
      },
      {
        label: "POST /customers/:id/deactivate",
        request: supertest(app.getHttpServer())
          .post(`/customers/${customerAId}/deactivate`)
          .set("Cookie", ownerBCookie)
          .set("X-Request-Id", NOT_FOUND_REQUEST_ID)
          .send({}),
        missingRequest: supertest(app.getHttpServer())
          .post(`/customers/${randomUUID()}/deactivate`)
          .set("Cookie", ownerBCookie)
          .set("X-Request-Id", NOT_FOUND_REQUEST_ID)
          .send({}),
      },
    ];

    for (const scenario of cases) {
      const response = await scenario.request.expect(404);
      const missingResponse = await scenario.missingRequest.expect(404);
      const body = response.body as ErrorEnvelope;
      expect(body.error.code, scenario.label).toBe("NOT_FOUND");
      expect(response.text, scenario.label).toBe(missingResponse.text);
    }

    const after = await prisma.customer.findUnique({ where: { id: customerAId } });
    expect(after?.displayName).toBe("Live Customer A");
    expect(after?.isActive).toBe(true);
  });

  it("returns byte-equivalent 404 for cross-tenant address mutations and does not mutate tenant A", async () => {
    const before = await prisma.customerAddress.findUnique({ where: { id: addressAId } });
    expect(before?.isActive).toBe(true);

    const cases = [
      {
        label: "PUT address",
        request: supertest(app.getHttpServer())
          .put(`/customers/${customerAId}/addresses/${addressAId}`)
          .set("Cookie", ownerBCookie)
          .set("X-Request-Id", NOT_FOUND_REQUEST_ID)
          .send({ line1: "Tampered" }),
        missingRequest: supertest(app.getHttpServer())
          .put(`/customers/${customerAId}/addresses/${randomUUID()}`)
          .set("Cookie", ownerBCookie)
          .set("X-Request-Id", NOT_FOUND_REQUEST_ID)
          .send({ line1: "Tampered" }),
      },
      {
        label: "POST address/deactivate",
        request: supertest(app.getHttpServer())
          .post(`/customers/${customerAId}/addresses/${addressAId}/deactivate`)
          .set("Cookie", ownerBCookie)
          .set("X-Request-Id", NOT_FOUND_REQUEST_ID)
          .send({}),
        missingRequest: supertest(app.getHttpServer())
          .post(`/customers/${customerAId}/addresses/${randomUUID()}/deactivate`)
          .set("Cookie", ownerBCookie)
          .set("X-Request-Id", NOT_FOUND_REQUEST_ID)
          .send({}),
      },
    ];

    for (const scenario of cases) {
      const response = await scenario.request.expect(404);
      const missingResponse = await scenario.missingRequest.expect(404);
      expect((response.body as ErrorEnvelope).error.code, scenario.label).toBe("NOT_FOUND");
      expect(response.text, scenario.label).toBe(missingResponse.text);
    }

    const after = await prisma.customerAddress.findUnique({ where: { id: addressAId } });
    expect(after?.line1).toBe("Live Address 123");
    expect(after?.isActive).toBe(true);
  });

  it("returns byte-equivalent 404 for cross-tenant contact mutations and does not mutate tenant A", async () => {
    const before = await prisma.customerContact.findUnique({ where: { id: contactAId } });
    expect(before?.isActive).toBe(true);

    const cases = [
      {
        label: "PUT contact",
        request: supertest(app.getHttpServer())
          .put(`/customers/${customerAId}/contacts/${contactAId}`)
          .set("Cookie", ownerBCookie)
          .set("X-Request-Id", NOT_FOUND_REQUEST_ID)
          .send({ value: "tampered@example.test" }),
        missingRequest: supertest(app.getHttpServer())
          .put(`/customers/${customerAId}/contacts/${randomUUID()}`)
          .set("Cookie", ownerBCookie)
          .set("X-Request-Id", NOT_FOUND_REQUEST_ID)
          .send({ value: "tampered@example.test" }),
      },
      {
        label: "POST contact/deactivate",
        request: supertest(app.getHttpServer())
          .post(`/customers/${customerAId}/contacts/${contactAId}/deactivate`)
          .set("Cookie", ownerBCookie)
          .set("X-Request-Id", NOT_FOUND_REQUEST_ID)
          .send({}),
        missingRequest: supertest(app.getHttpServer())
          .post(`/customers/${customerAId}/contacts/${randomUUID()}/deactivate`)
          .set("Cookie", ownerBCookie)
          .set("X-Request-Id", NOT_FOUND_REQUEST_ID)
          .send({}),
      },
    ];

    for (const scenario of cases) {
      const response = await scenario.request.expect(404);
      const missingResponse = await scenario.missingRequest.expect(404);
      expect((response.body as ErrorEnvelope).error.code, scenario.label).toBe("NOT_FOUND");
      expect(response.text, scenario.label).toBe(missingResponse.text);
    }

    const after = await prisma.customerContact.findUnique({ where: { id: contactAId } });
    expect(after?.value).toBe("live@example.test");
    expect(after?.isActive).toBe(true);
  });

  it("tenant-relative authorized branding mutation succeeds for each tenant without affecting the other", async () => {
    const aResponse = await supertest(app.getHttpServer())
      .put("/branding/current")
      .set("Cookie", ownerACookie)
      .send({ overrides: { schemaVersion: 1, primary: "#0ea5e9" } })
      .expect(200);
    const aBrand = aResponse.body as {
      source: string;
      brand: { theme: { colors: { primary: string } } };
    };
    expect(aBrand.source).toBe("tenant");
    expect(aBrand.brand.theme.colors.primary).toBe("#0ea5e9");

    const bResponse = await supertest(app.getHttpServer())
      .put("/branding/current")
      .set("Cookie", ownerBCookie)
      .send({ overrides: { schemaVersion: 1, primary: "#ef4444" } })
      .expect(200);
    const bBrand = bResponse.body as {
      source: string;
      brand: { theme: { colors: { primary: string } } };
    };
    expect(bBrand.source).toBe("tenant");
    expect(bBrand.brand.theme.colors.primary).toBe("#ef4444");

    const aRow = await prisma.tenantBranding.findUnique({ where: { tenantId: tenantAId } });
    const bRow = await prisma.tenantBranding.findUnique({ where: { tenantId: tenantBId } });
    expect((aRow?.overrides as Record<string, unknown>).primary).toBe("#0ea5e9");
    expect((bRow?.overrides as Record<string, unknown>).primary).toBe("#ef4444");
  });
});
