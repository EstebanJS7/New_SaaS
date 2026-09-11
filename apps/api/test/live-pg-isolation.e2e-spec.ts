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
import {
  BRANDING_RESET_CLEANUP_PRODUCER,
  type CleanupProducer,
} from "../src/branding/branding-reset-cleanup.producer.js";

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

interface PatientDto {
  id: string;
  tenantId: string;
  name: string;
  speciesId: string;
  breedId: string | null;
  sex: "MALE" | "FEMALE" | "UNKNOWN";
  birthDate: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

interface PatientGuardianDto {
  id: string;
  tenantId: string;
  patientId: string;
  customerId: string;
  isPrimary: boolean;
  isActive: boolean;
  position: number;
  createdAt: string;
  updatedAt: string;
}

interface SpeciesCatalogEntryDto {
  id: string;
  code: string;
  name: string;
  breeds: { id: string; code: string; name: string }[];
}

/** Exact allowlisted key set of the Patient response DTO (WU3 contract). */
const PATIENT_DTO_KEYS = [
  "birthDate",
  "breedId",
  "createdAt",
  "id",
  "isActive",
  "name",
  "sex",
  "speciesId",
  "tenantId",
  "updatedAt",
].sort();

/**
 * Test-only recording fake for the branding reset cleanup producer. It fulfills
 * the production `CleanupProducer` port without constructing a BullMQ Queue or
 * an ioredis connection, so this suite boots with `REDIS_URL` unset while the
 * real Prisma/PostgreSQL setup and every other provider stay untouched.
 */
interface RecordingCleanupProducer extends CleanupProducer {
  readonly enqueued: string[];
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

/**
 * Deterministic synchronization barrier for concurrency tests.
 *
 * Polls `pg_stat_activity` until at least `expected` backends are blocked on a
 * lock, then returns. A test holds a row lock on the contended aggregate and
 * only releases it once this resolves, so every racing transaction is provably
 * parked at the same database boundary before any of them can commit — never a
 * timing-based sleep. Throws on timeout so an unproven overlap can never be
 * mistaken for a passing race.
 */
async function waitForLockWaiters(
  prisma: PrismaService,
  expected: number,
  timeoutMs: number
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const rows = await prisma.$queryRaw<{ blocked: number }[]>`
      SELECT count(*)::int AS blocked
      FROM pg_stat_activity
      WHERE datname = current_database()
        AND wait_event_type = 'Lock'
    `;
    const blocked = rows[0]?.blocked ?? 0;
    if (blocked >= expected) {
      return;
    }
    if (Date.now() >= deadline) {
      throw new Error(
        `Concurrency barrier timed out: expected ${expected} blocked sessions, observed ${blocked}`
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
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
  let serverUrl: string;
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

  // EPIC-05 Patient/guardian live-PG state (global taxonomy, guardian
  // Customers, and the Patient created atomically in the create scenario).
  let dogSpeciesId: string;
  let dogBreedId: string | null;
  let guardianCustomerAId: string;
  let guardianCustomerA2Id: string;
  let guardianCustomerA3Id: string;
  let guardianCustomerBId: string;
  let atomicPatientAId: string;
  let atomicGuardianAId: string;

  // Recording fake installed via overrideProvider below. Referenced by the
  // token-identity regression pin, so it must be the exact injected instance.
  const cleanupProducer: RecordingCleanupProducer = {
    enqueued: [],
    enqueue: (intentId: string) => {
      cleanupProducer.enqueued.push(intentId);
      return Promise.resolve();
    },
  };

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
      .overrideProvider(BRANDING_RESET_CLEANUP_PRODUCER)
      .useValue(cleanupProducer)
      .compile();

    app = moduleRef.createNestApplication<NestFastifyApplication>(
      createFastifyAdapter({
        loggerInstance: createApiLogger({ level: "error" }),
      })
    );
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    await app.listen(0, "127.0.0.1");
    serverUrl = await app.getUrl();

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

    const featureCode = await prisma.featureCode.upsert({
      where: { code: "custom_branding" },
      create: { code: "custom_branding" },
      update: {},
    });
    await prisma.tenantEntitlement.upsert({
      where: {
        tenantId_featureCodeId: { tenantId: tenantA.id, featureCodeId: featureCode.id },
      },
      create: { tenantId: tenantA.id, featureCodeId: featureCode.id },
      update: {},
    });
    await prisma.tenantEntitlement.upsert({
      where: {
        tenantId_featureCodeId: { tenantId: tenantB.id, featureCodeId: featureCode.id },
      },
      create: { tenantId: tenantB.id, featureCodeId: featureCode.id },
      update: {},
    });

    // --- EPIC-05 setup: veterinary entitlement, global taxonomy, guardians ---
    // The `veterinary` grant is explicit: plan mappings never grant access, so
    // both tenants must hold a direct tenant_entitlement row.
    const veterinaryFeature = await prisma.featureCode.upsert({
      where: { code: "veterinary" },
      create: { code: "veterinary" },
      update: {},
    });
    for (const tenantId of [tenantA.id, tenantB.id]) {
      await prisma.tenantEntitlement.upsert({
        where: {
          tenantId_featureCodeId: { tenantId, featureCodeId: veterinaryFeature.id },
        },
        create: { tenantId, featureCodeId: veterinaryFeature.id },
        update: {},
      });
    }

    // Global seeded taxonomy: shared by every tenant and never tenant-filtered.
    const dogSpecies = await prisma.species.findUnique({ where: { code: "dog" } });
    if (!dogSpecies) {
      throw new Error("Reference seed did not create the global dog Species");
    }
    dogSpeciesId = dogSpecies.id;
    const mixedBreed = await prisma.breed.findUnique({
      where: { speciesId_code: { speciesId: dogSpecies.id, code: "mixed" } },
    });
    dogBreedId = mixedBreed?.id ?? null;

    // Guardian Customers live in Core and are referenced by id only.
    const guardianCustomerA = await prisma.customer.create({
      data: {
        tenantId: tenantA.id,
        kind: "INDIVIDUAL",
        displayName: "Guardian Customer A",
        firstName: "Guardian",
        lastName: "A",
      },
    });
    guardianCustomerAId = guardianCustomerA.id;
    guardianCustomerA2Id = (
      await prisma.customer.create({
        data: {
          tenantId: tenantA.id,
          kind: "INDIVIDUAL",
          displayName: "Guardian Customer A2",
          firstName: "Guardian",
          lastName: "A2",
        },
      })
    ).id;
    guardianCustomerA3Id = (
      await prisma.customer.create({
        data: {
          tenantId: tenantA.id,
          kind: "INDIVIDUAL",
          displayName: "Guardian Customer A3",
          firstName: "Guardian",
          lastName: "A3",
        },
      })
    ).id;
    guardianCustomerBId = (
      await prisma.customer.create({
        data: {
          tenantId: tenantB.id,
          kind: "INDIVIDUAL",
          displayName: "Guardian Customer B",
          firstName: "Guardian",
          lastName: "B",
        },
      })
    ).id;
  }, 120_000);

  afterAll(async () => {
    if (app) {
      await app.close();
    }
    restoreDatabaseUrl(previousDatabaseUrl);
    dropDatabase(baseDatabaseUrl, testDatabaseName);
  }, 30_000);

  it("injects the test-only branding reset cleanup producer", () => {
    // Token-identity pin: the suite must resolve the recording fake, proving the
    // Redis-backed producer factory never ran during AppModule compilation.
    expect(app.get(BRANDING_RESET_CLEANUP_PRODUCER)).toBe(cleanupProducer);
  });

  it("creates tenant A customer/address/contact over real HTTP", async () => {
    const customerResponse = await supertest(serverUrl)
      .post("/customers")
      .set("Cookie", ownerACookie)
      .send({ kind: "INDIVIDUAL", displayName: "Live Customer A" })
      .expect(201);
    const customer = customerResponse.body as CustomerDto;
    customerAId = customer.id;
    expect(customer.tenantId).toBe(tenantAId);

    const addressResponse = await supertest(serverUrl)
      .post(`/customers/${customerAId}/addresses`)
      .set("Cookie", ownerACookie)
      .send({ line1: "Live Address 123" })
      .expect(201);
    const address = addressResponse.body as AddressDto;
    addressAId = address.id;
    expect(address.tenantId).toBe(tenantAId);
    expect(address.customerId).toBe(customerAId);

    const contactResponse = await supertest(serverUrl)
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
        request: () =>
          supertest(serverUrl)
            .put(`/customers/${customerAId}`)
            .set("Cookie", ownerBCookie)
            .set("X-Request-Id", NOT_FOUND_REQUEST_ID)
            .send({ displayName: "Tampered" }),
        missingRequest: () =>
          supertest(serverUrl)
            .put(`/customers/${randomUUID()}`)
            .set("Cookie", ownerBCookie)
            .set("X-Request-Id", NOT_FOUND_REQUEST_ID)
            .send({ displayName: "Tampered" }),
      },
      {
        label: "POST /customers/:id/deactivate",
        request: () =>
          supertest(serverUrl)
            .post(`/customers/${customerAId}/deactivate`)
            .set("Cookie", ownerBCookie)
            .set("X-Request-Id", NOT_FOUND_REQUEST_ID)
            .send({}),
        missingRequest: () =>
          supertest(serverUrl)
            .post(`/customers/${randomUUID()}/deactivate`)
            .set("Cookie", ownerBCookie)
            .set("X-Request-Id", NOT_FOUND_REQUEST_ID)
            .send({}),
      },
    ];

    for (const scenario of cases) {
      const response = await scenario.request().expect(404);
      const missingResponse = await scenario.missingRequest().expect(404);
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
        request: () =>
          supertest(serverUrl)
            .put(`/customers/${customerAId}/addresses/${addressAId}`)
            .set("Cookie", ownerBCookie)
            .set("X-Request-Id", NOT_FOUND_REQUEST_ID)
            .send({ line1: "Tampered" }),
        missingRequest: () =>
          supertest(serverUrl)
            .put(`/customers/${customerAId}/addresses/${randomUUID()}`)
            .set("Cookie", ownerBCookie)
            .set("X-Request-Id", NOT_FOUND_REQUEST_ID)
            .send({ line1: "Tampered" }),
      },
      {
        label: "POST address/deactivate",
        request: () =>
          supertest(serverUrl)
            .post(`/customers/${customerAId}/addresses/${addressAId}/deactivate`)
            .set("Cookie", ownerBCookie)
            .set("X-Request-Id", NOT_FOUND_REQUEST_ID)
            .send({}),
        missingRequest: () =>
          supertest(serverUrl)
            .post(`/customers/${customerAId}/addresses/${randomUUID()}/deactivate`)
            .set("Cookie", ownerBCookie)
            .set("X-Request-Id", NOT_FOUND_REQUEST_ID)
            .send({}),
      },
    ];

    for (const scenario of cases) {
      const response = await scenario.request().expect(404);
      const missingResponse = await scenario.missingRequest().expect(404);
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
        request: () =>
          supertest(serverUrl)
            .put(`/customers/${customerAId}/contacts/${contactAId}`)
            .set("Cookie", ownerBCookie)
            .set("X-Request-Id", NOT_FOUND_REQUEST_ID)
            .send({ value: "tampered@example.test" }),
        missingRequest: () =>
          supertest(serverUrl)
            .put(`/customers/${customerAId}/contacts/${randomUUID()}`)
            .set("Cookie", ownerBCookie)
            .set("X-Request-Id", NOT_FOUND_REQUEST_ID)
            .send({ value: "tampered@example.test" }),
      },
      {
        label: "POST contact/deactivate",
        request: () =>
          supertest(serverUrl)
            .post(`/customers/${customerAId}/contacts/${contactAId}/deactivate`)
            .set("Cookie", ownerBCookie)
            .set("X-Request-Id", NOT_FOUND_REQUEST_ID)
            .send({}),
        missingRequest: () =>
          supertest(serverUrl)
            .post(`/customers/${customerAId}/contacts/${randomUUID()}/deactivate`)
            .set("Cookie", ownerBCookie)
            .set("X-Request-Id", NOT_FOUND_REQUEST_ID)
            .send({}),
      },
    ];

    for (const scenario of cases) {
      const response = await scenario.request().expect(404);
      const missingResponse = await scenario.missingRequest().expect(404);
      expect((response.body as ErrorEnvelope).error.code, scenario.label).toBe("NOT_FOUND");
      expect(response.text, scenario.label).toBe(missingResponse.text);
    }

    const after = await prisma.customerContact.findUnique({ where: { id: contactAId } });
    expect(after?.value).toBe("live@example.test");
    expect(after?.isActive).toBe(true);
  });

  it("tenant-relative authorized branding mutation succeeds for each tenant without affecting the other", async () => {
    const aResponse = await supertest(serverUrl)
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

    const bResponse = await supertest(serverUrl)
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

  /**
   * EPIC-05 Patient application-path evidence (H1 hardening, task 5.1).
   *
   * Proves over real HTTP + real PostgreSQL that atomic Patient create/activate,
   * the global catalog, byte-equivalent cross-tenant masking, and the
   * exactly-one-active-primary invariant hold at the application boundary — the
   * gap the in-memory harness (TD-006) cannot close.
   */
  describe("EPIC-05 patient application-path isolation", () => {
    const countActivePrimaries = (patientId: string): Promise<number> =>
      prisma.patientGuardian.count({
        where: { patientId, isPrimary: true, isActive: true },
      });

    const createActivePatient = async (name: string): Promise<PatientDto> => {
      const response = await supertest(serverUrl)
        .post("/patients")
        .set("Cookie", ownerACookie)
        .send({
          name,
          speciesId: dogSpeciesId,
          breedId: dogBreedId,
          sex: "FEMALE",
          primaryGuardianCustomerId: guardianCustomerAId,
        })
        .expect(201);
      return response.body as PatientDto;
    };

    it("serves the same global Species/Breed catalog to every entitled tenant", async () => {
      const aResponse = await supertest(serverUrl)
        .get("/patients/catalog")
        .set("Cookie", ownerACookie)
        .expect(200);
      const bResponse = await supertest(serverUrl)
        .get("/patients/catalog")
        .set("Cookie", ownerBCookie)
        .expect(200);

      // Identical bytes: the taxonomy is global and never tenant-filtered.
      expect(aResponse.text).toBe(bResponse.text);

      const catalog = aResponse.body as SpeciesCatalogEntryDto[];
      const dog = catalog.find((entry) => entry.id === dogSpeciesId);
      expect(dog?.code).toBe("dog");
      expect(dog?.breeds.map((breed) => breed.code)).toEqual(
        expect.arrayContaining(["mixed", "labrador_retriever"])
      );
      // No tenant-private data is joined into the shared catalog DTO.
      expect(aResponse.text).not.toContain(tenantAId);
      expect(aResponse.text).not.toContain(tenantBId);
    });

    it("atomically creates an active Patient with exactly one primary guardian and co-committed audit", async () => {
      const requestId = "live-pg-patient-atomic-create";
      const response = await supertest(serverUrl)
        .post("/patients")
        .set("Cookie", ownerACookie)
        .set("X-Request-Id", requestId)
        .send({
          name: "Live Atomic Patient",
          speciesId: dogSpeciesId,
          breedId: dogBreedId,
          sex: "FEMALE",
          primaryGuardianCustomerId: guardianCustomerAId,
        })
        .expect(201);

      const patient = response.body as PatientDto;
      atomicPatientAId = patient.id;
      expect(patient.tenantId).toBe(tenantAId);
      expect(patient.isActive).toBe(true);

      // Allowlisted DTO: no Prisma internals and no primaryGuardianCustomerId.
      expect(Object.keys(patient).sort()).toEqual(PATIENT_DTO_KEYS);
      expect(
        (patient as unknown as Record<string, unknown>).primaryGuardianCustomerId
      ).toBeUndefined();

      const guardians = await prisma.patientGuardian.findMany({
        where: { tenantId: tenantAId, patientId: patient.id },
      });
      expect(guardians).toHaveLength(1);
      atomicGuardianAId = guardians[0].id;
      expect(guardians[0].customerId).toBe(guardianCustomerAId);
      expect(guardians[0].isPrimary).toBe(true);
      expect(guardians[0].isActive).toBe(true);

      // The Patient row and its primary link committed in one transaction, and
      // both audit rows share the server-owned request id.
      const auditRows = await prisma.auditLog.findMany({
        where: { requestId, tenantId: tenantAId },
      });
      expect(auditRows.map((row) => row.action).sort()).toEqual([
        "patient.created",
        "patient_guardian.created",
      ]);
      expect(auditRows.every((row) => row.targetId !== null)).toBe(true);
    });

    it("rejects an active Patient create without a primary guardian and persists nothing", async () => {
      const before = await prisma.patient.count({ where: { tenantId: tenantAId } });
      const response = await supertest(serverUrl)
        .post("/patients")
        .set("Cookie", ownerACookie)
        .send({ name: "No Guardian", speciesId: dogSpeciesId, sex: "UNKNOWN" })
        .expect(400);
      expect((response.body as ErrorEnvelope).error.code).toBe("VALIDATION_FAILED");
      const after = await prisma.patient.count({ where: { tenantId: tenantAId } });
      expect(after).toBe(before);
    });

    it("activates an inactive Patient by establishing exactly one primary guardian", async () => {
      const created = await supertest(serverUrl)
        .post("/patients")
        .set("Cookie", ownerACookie)
        .send({
          name: "Live Inactive To Activate",
          speciesId: dogSpeciesId,
          sex: "MALE",
          isActive: false,
        })
        .expect(201);
      const patient = created.body as PatientDto;
      expect(patient.isActive).toBe(false);
      expect(await countActivePrimaries(patient.id)).toBe(0);

      const activated = await supertest(serverUrl)
        .put(`/patients/${patient.id}`)
        .set("Cookie", ownerACookie)
        .send({ isActive: true, primaryGuardianCustomerId: guardianCustomerAId })
        .expect(200);
      expect((activated.body as PatientDto).isActive).toBe(true);
      expect(await countActivePrimaries(patient.id)).toBe(1);
    });

    it("returns 409 when activating without a primary guardian and keeps the Patient inactive", async () => {
      const created = await supertest(serverUrl)
        .post("/patients")
        .set("Cookie", ownerACookie)
        .send({
          name: "Live Inactive No Guardian",
          speciesId: dogSpeciesId,
          sex: "UNKNOWN",
          isActive: false,
        })
        .expect(201);
      const patient = created.body as PatientDto;

      const response = await supertest(serverUrl)
        .put(`/patients/${patient.id}`)
        .set("Cookie", ownerACookie)
        .send({ isActive: true })
        .expect(409);
      expect((response.body as ErrorEnvelope).error.code).toBe("CONFLICT");

      const row = await prisma.patient.findUnique({ where: { id: patient.id } });
      expect(row?.isActive).toBe(false);
      expect(await countActivePrimaries(patient.id)).toBe(0);
    });

    it("swaps the primary guardian in one transaction and keeps exactly one", async () => {
      const patient = await createActivePatient("Live Primary Swap");
      const linked = await supertest(serverUrl)
        .post(`/patients/${patient.id}/guardians`)
        .set("Cookie", ownerACookie)
        .send({ customerId: guardianCustomerA2Id, isPrimary: false })
        .expect(201);
      const secondary = linked.body as PatientGuardianDto;

      await supertest(serverUrl)
        .post(`/patients/${patient.id}/guardians/${secondary.id}/primary`)
        .set("Cookie", ownerACookie)
        .expect(201);

      const primaries = await prisma.patientGuardian.findMany({
        where: { patientId: patient.id, isPrimary: true, isActive: true },
      });
      expect(primaries).toHaveLength(1);
      expect(primaries[0].id).toBe(secondary.id);
      expect(primaries[0].customerId).toBe(guardianCustomerA2Id);
    });

    it("masks cross-tenant Patient mutations as byte-equivalent 404 and leaves tenant A unchanged", async () => {
      const before = await prisma.patient.findUnique({ where: { id: atomicPatientAId } });
      expect(before?.isActive).toBe(true);

      const cases = [
        {
          label: "GET patient",
          request: () =>
            supertest(serverUrl)
              .get(`/patients/${atomicPatientAId}`)
              .set("Cookie", ownerBCookie)
              .set("X-Request-Id", NOT_FOUND_REQUEST_ID),
          missingRequest: () =>
            supertest(serverUrl)
              .get(`/patients/${randomUUID()}`)
              .set("Cookie", ownerBCookie)
              .set("X-Request-Id", NOT_FOUND_REQUEST_ID),
        },
        {
          label: "PUT patient",
          request: () =>
            supertest(serverUrl)
              .put(`/patients/${atomicPatientAId}`)
              .set("Cookie", ownerBCookie)
              .set("X-Request-Id", NOT_FOUND_REQUEST_ID)
              .send({ name: "Tampered" }),
          missingRequest: () =>
            supertest(serverUrl)
              .put(`/patients/${randomUUID()}`)
              .set("Cookie", ownerBCookie)
              .set("X-Request-Id", NOT_FOUND_REQUEST_ID)
              .send({ name: "Tampered" }),
        },
        {
          label: "POST patient/deactivate",
          request: () =>
            supertest(serverUrl)
              .post(`/patients/${atomicPatientAId}/deactivate`)
              .set("Cookie", ownerBCookie)
              .set("X-Request-Id", NOT_FOUND_REQUEST_ID)
              .send({}),
          missingRequest: () =>
            supertest(serverUrl)
              .post(`/patients/${randomUUID()}/deactivate`)
              .set("Cookie", ownerBCookie)
              .set("X-Request-Id", NOT_FOUND_REQUEST_ID)
              .send({}),
        },
      ];

      for (const scenario of cases) {
        const response = await scenario.request().expect(404);
        const missingResponse = await scenario.missingRequest().expect(404);
        expect((response.body as ErrorEnvelope).error.code, scenario.label).toBe("NOT_FOUND");
        expect(response.text, scenario.label).toBe(missingResponse.text);
        expect(response.text, scenario.label).not.toContain(tenantAId);
      }

      const after = await prisma.patient.findUnique({ where: { id: atomicPatientAId } });
      expect(after?.name).toBe(before?.name);
      expect(after?.isActive).toBe(true);
    });

    it("rejects a cross-tenant guardian Customer with 404 and persists nothing", async () => {
      const before = await prisma.patient.count({ where: { tenantId: tenantAId } });
      const response = await supertest(serverUrl)
        .post("/patients")
        .set("Cookie", ownerACookie)
        .set("X-Request-Id", NOT_FOUND_REQUEST_ID)
        .send({
          name: "Cross Tenant Guardian",
          speciesId: dogSpeciesId,
          sex: "UNKNOWN",
          primaryGuardianCustomerId: guardianCustomerBId,
        })
        .expect(404);
      expect((response.body as ErrorEnvelope).error.code).toBe("NOT_FOUND");
      expect(response.text).not.toContain(guardianCustomerBId);
      const after = await prisma.patient.count({ where: { tenantId: tenantAId } });
      expect(after).toBe(before);
    });

    it("masks cross-tenant guardian reads and promotion as byte-equivalent 404", async () => {
      const cases = [
        {
          label: "GET guardian list",
          request: () =>
            supertest(serverUrl)
              .get(`/patients/${atomicPatientAId}/guardians`)
              .set("Cookie", ownerBCookie)
              .set("X-Request-Id", NOT_FOUND_REQUEST_ID),
          missingRequest: () =>
            supertest(serverUrl)
              .get(`/patients/${randomUUID()}/guardians`)
              .set("Cookie", ownerBCookie)
              .set("X-Request-Id", NOT_FOUND_REQUEST_ID),
        },
        {
          label: "GET guardian",
          request: () =>
            supertest(serverUrl)
              .get(`/patients/${atomicPatientAId}/guardians/${atomicGuardianAId}`)
              .set("Cookie", ownerBCookie)
              .set("X-Request-Id", NOT_FOUND_REQUEST_ID),
          missingRequest: () =>
            supertest(serverUrl)
              .get(`/patients/${atomicPatientAId}/guardians/${randomUUID()}`)
              .set("Cookie", ownerBCookie)
              .set("X-Request-Id", NOT_FOUND_REQUEST_ID),
        },
        {
          label: "POST guardian/primary",
          request: () =>
            supertest(serverUrl)
              .post(`/patients/${atomicPatientAId}/guardians/${atomicGuardianAId}/primary`)
              .set("Cookie", ownerBCookie)
              .set("X-Request-Id", NOT_FOUND_REQUEST_ID)
              .send({}),
          missingRequest: () =>
            supertest(serverUrl)
              .post(`/patients/${atomicPatientAId}/guardians/${randomUUID()}/primary`)
              .set("Cookie", ownerBCookie)
              .set("X-Request-Id", NOT_FOUND_REQUEST_ID)
              .send({}),
        },
      ];

      for (const scenario of cases) {
        const response = await scenario.request().expect(404);
        const missingResponse = await scenario.missingRequest().expect(404);
        expect((response.body as ErrorEnvelope).error.code, scenario.label).toBe("NOT_FOUND");
        expect(response.text, scenario.label).toBe(missingResponse.text);
        expect(response.text, scenario.label).not.toContain(atomicPatientAId);
        expect(response.text, scenario.label).not.toContain(atomicGuardianAId);
      }
    });

    it("forces an overlapping primary-promotion race at the demote boundary and keeps exactly one primary", async () => {
      const patient = await createActivePatient("Live Concurrency Primary");
      const second = (
        await supertest(serverUrl)
          .post(`/patients/${patient.id}/guardians`)
          .set("Cookie", ownerACookie)
          .send({ customerId: guardianCustomerA2Id, isPrimary: false })
          .expect(201)
      ).body as PatientGuardianDto;
      const third = (
        await supertest(serverUrl)
          .post(`/patients/${patient.id}/guardians`)
          .set("Cookie", ownerACookie)
          .send({ customerId: guardianCustomerA3Id, isPrimary: false })
          .expect(201)
      ).body as PatientGuardianDto;

      const currentPrimary = await prisma.patientGuardian.findFirst({
        where: { tenantId: tenantAId, patientId: patient.id, isPrimary: true, isActive: true },
      });
      if (!currentPrimary) {
        throw new Error("Expected the freshly created Patient to have an active primary guardian");
      }

      // Deterministic overlap mechanism: hold an exclusive row lock on the
      // current primary guardian from a dedicated transaction, then start both
      // promotions. Each promotion must run `demoteActivePrimary` BEFORE it can
      // promote its own target, so both ride the same contended UPDATE and park
      // there until this barrier is released. `waitForLockWaiters` proves both
      // are actually blocked at that boundary before release; there is no
      // sleep-based timing assumption and no dependence on the event-loop
      // scheduling of `Promise.all`.
      let releaseBarrier!: () => void;
      const barrierReleased = new Promise<void>((resolve) => {
        releaseBarrier = resolve;
      });
      let signalBarrierReady!: () => void;
      const barrierReady = new Promise<void>((resolve) => {
        signalBarrierReady = resolve;
      });

      const barrierTransaction = prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw`
            SELECT "id" FROM "patient_guardian"
            WHERE "id" = ${currentPrimary.id}::uuid
            FOR UPDATE
          `;
          signalBarrierReady();
          await barrierReleased;
        },
        { timeout: 20_000, maxWait: 10_000 }
      );

      await barrierReady;

      // `.then` both dispatches the HTTP request and returns a promise for its
      // response, so BOTH promotions are already in flight before the barrier
      // wait below; they are awaited only after the overlap is proven.
      const promotions = [
        supertest(serverUrl)
          .post(`/patients/${patient.id}/guardians/${second.id}/primary`)
          .set("Cookie", ownerACookie),
        supertest(serverUrl)
          .post(`/patients/${patient.id}/guardians/${third.id}/primary`)
          .set("Cookie", ownerACookie),
      ].map((request) => request.then((response) => response));

      try {
        await waitForLockWaiters(prisma, 2, 10_000);
      } finally {
        releaseBarrier();
        await barrierTransaction;
      }

      // With a proven overlap on the same demote row, the partial unique index
      // admits exactly one promotion: the other transaction's promotion UPDATE
      // raises Prisma P2002 on `patient_guardian_primary_active_key`.
      const results = await Promise.all(promotions);
      const successes = results.filter((result) => result.status >= 200 && result.status < 300);
      const failures = results.filter((result) => result.status >= 300);
      expect(successes).toHaveLength(1);
      expect(failures).toHaveLength(1);

      // Truthful current error surface: the P2002 loser is mapped by the global
      // filter to 500 INTERNAL, not 409 CONFLICT. Mapping this race to CONFLICT
      // is TD-011; this assertion pins the observed behavior until then.
      expect(failures[0].status).toBe(500);
      expect((failures[0].body as ErrorEnvelope).error.code).toBe("INTERNAL");

      const winnerIndex = results.findIndex(
        (result) => result.status >= 200 && result.status < 300
      );
      const winnerGuardianId = winnerIndex === 0 ? second.id : third.id;

      // The invariant survives the race: exactly one active primary, and it is
      // the winner's guardian — never the loser's, never zero, never two.
      const primaries = await prisma.patientGuardian.findMany({
        where: { patientId: patient.id, isPrimary: true, isActive: true },
      });
      expect(primaries).toHaveLength(1);
      expect(primaries[0].id).toBe(winnerGuardianId);
    }, 20_000);
  });
});
