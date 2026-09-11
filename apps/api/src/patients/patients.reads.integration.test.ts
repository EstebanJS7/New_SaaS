import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import supertest from "supertest";
import { bootTestApp, type BootedTestApp } from "../../test/support/boot-test-app.js";
import { expectCrossTenant404 } from "../../test/support/expect-cross-tenant-404.js";
import {
  seedPatientHttp,
  type PatientHttpFixture,
} from "../../test/support/patient-http-fixture.js";
import { seedRbacActor, seedRoleWithKeys } from "../../test/support/rbac-fixture.js";

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

interface BreedCatalogDto {
  id: string;
  code: string;
  name: string;
}

interface SpeciesCatalogDto {
  id: string;
  code: string;
  name: string;
  breeds: BreedCatalogDto[];
}

interface ErrorDto {
  error: { code: string };
}

const PATIENT_RESPONSE_KEYS: readonly string[] = [
  "id",
  "tenantId",
  "name",
  "speciesId",
  "breedId",
  "sex",
  "birthDate",
  "isActive",
  "createdAt",
  "updatedAt",
];

/**
 * EPIC-05 WU3.2 read boundary: `GET /patients`, `GET /patients/catalog`, and
 * `GET /patients/:id` over the REAL guard chain and the WU3.1 independent
 * fixture. Every factory runs INSIDE its `it`, so no test depends on an id
 * minted by an earlier test (order independence).
 */
describe("Patients reads and catalog HTTP boundary (WU3.2)", () => {
  let booted: BootedTestApp;
  let fixture: PatientHttpFixture;

  beforeAll(async () => {
    booted = await bootTestApp();
    fixture = seedPatientHttp(booted.db);
  });

  afterAll(async () => {
    await booted.close();
  });

  it("requires patients.read on every read route", async () => {
    const readLessRole = seedRoleWithKeys(
      booted.db,
      `PATIENTS_READLESS_${fixture.a.tenant.slug}`,
      "Read-less (fixture)",
      []
    );
    const readLess = seedRbacActor(booted.db, {
      email: `readless-${fixture.a.tenant.slug}@isolation.test`,
      tenantId: fixture.a.tenant.id,
      roleId: readLessRole.role.id,
    });

    for (const path of ["/patients", "/patients/catalog", `/patients/${randomUUID()}`]) {
      await supertest(booted.app.getHttpServer())
        .get(path)
        .set("Cookie", readLess.cookie)
        .expect(403);
    }
  });

  it("lists only the caller tenant's active Patients with an allowlisted DTO", async () => {
    const { patient: activeA } = fixture.createPatientA();
    const { patient: inactiveA } = fixture.createPatientA({ isActive: false });
    const { patient: activeB } = fixture.createPatientB();

    const response = await supertest(booted.app.getHttpServer())
      .get("/patients")
      .set("Cookie", fixture.a.actor.cookie)
      .expect(200);

    const body = response.body as PatientDto[];
    const ids = body.map((patient) => patient.id);
    expect(ids).toContain(activeA.id);
    expect(ids).not.toContain(inactiveA.id);
    expect(ids).not.toContain(activeB.id);

    const listed = body.find((patient) => patient.id === activeA.id);
    expect(listed).toBeDefined();
    expect(Object.keys(listed ?? {}).sort()).toEqual([...PATIENT_RESPONSE_KEYS].sort());
    expect(listed).not.toHaveProperty("primaryGuardianCustomerId");
  });

  it("reads a single Patient by id with the allowlisted DTO", async () => {
    const { patient } = fixture.createPatientA();

    const response = await supertest(booted.app.getHttpServer())
      .get(`/patients/${patient.id}`)
      .set("Cookie", fixture.a.actor.cookie)
      .expect(200);

    const body = response.body as PatientDto;
    expect(body.id).toBe(patient.id);
    expect(body.tenantId).toBe(fixture.a.tenant.id);
    expect(body.isActive).toBe(true);
    expect(Object.keys(body).sort()).toEqual([...PATIENT_RESPONSE_KEYS].sort());
    expect(body).not.toHaveProperty("primaryGuardianCustomerId");
  });

  it("returns the same global Species/Breed catalog to every tenant (never tenant-filtered)", async () => {
    const [asA, asB] = await Promise.all([
      supertest(booted.app.getHttpServer())
        .get("/patients/catalog")
        .set("Cookie", fixture.a.actor.cookie)
        .expect(200),
      supertest(booted.app.getHttpServer())
        .get("/patients/catalog")
        .set("Cookie", fixture.b.actor.cookie)
        .expect(200),
    ]);

    const catalogA = asA.body as SpeciesCatalogDto[];
    const catalogB = asB.body as SpeciesCatalogDto[];
    expect(catalogA).toEqual(catalogB);

    const species = catalogA.find((entry) => entry.id === fixture.species.id);
    expect(species).toMatchObject({
      id: fixture.species.id,
      code: fixture.species.code,
      name: fixture.species.name,
    });
    expect(species?.breeds).toEqual([
      { id: fixture.breed.id, code: fixture.breed.code, name: fixture.breed.name },
    ]);

    // GLOBAL reference data: no tenant-private identifier is ever exposed.
    const serialized = JSON.stringify(catalogA);
    expect(serialized).not.toContain(fixture.a.tenant.id);
    expect(serialized).not.toContain(fixture.b.tenant.id);
  });

  it("masks a foreign Patient read as a byte-equivalent 404", async () => {
    const { patient: foreignPatient } = fixture.createPatientB();

    await expectCrossTenant404({
      app: booted.app,
      cookie: fixture.a.actor.cookie,
      nonexistentUrl: `/patients/${randomUUID()}`,
      foreignUrl: `/patients/${foreignPatient.id}`,
      forbiddenIdentifiers: [foreignPatient.id, fixture.b.tenant.id],
    });
  });

  it("rejects a malformed Patient id with VALIDATION_FAILED", async () => {
    const response = await supertest(booted.app.getHttpServer())
      .get("/patients/not-a-uuid")
      .set("Cookie", fixture.a.actor.cookie)
      .expect(400);

    expect((response.body as ErrorDto).error.code).toBe("VALIDATION_FAILED");
  });

  it("denies every read route when the tenant lacks the veterinary entitlement", async () => {
    for (const path of ["/patients", "/patients/catalog", `/patients/${randomUUID()}`]) {
      const response = await supertest(booted.app.getHttpServer())
        .get(path)
        .set("Cookie", fixture.c.actor.cookie);
      expect(response.status, path).toBe(403);
      expect((response.body as ErrorDto).error.code).toBe("FEATURE_NOT_ENTITLED");
    }
  });
});
