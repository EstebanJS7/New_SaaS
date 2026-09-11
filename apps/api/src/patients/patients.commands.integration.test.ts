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
import type { AuditLogRow } from "../../test/support/in-memory-database.js";
import { REQUEST_ID_HEADER } from "../common/errors/request-id.js";

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

interface ErrorDto {
  error: { code: string };
}

/** Same allowlisted surface the read suite pins (never a Prisma model). */
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
 * EPIC-05 WU3.3 Patient command boundary over the REAL guard chain and the
 * WU3.1 independent fixture. Every factory runs INSIDE its `it`, so no test
 * depends on an id minted by an earlier test (order independence).
 */
describe("Patients command HTTP boundary (WU3.3)", () => {
  let booted: BootedTestApp;
  let fixture: PatientHttpFixture;

  beforeAll(async () => {
    booted = await bootTestApp();
    fixture = seedPatientHttp(booted.db);
  });

  afterAll(async () => {
    await booted.close();
  });

  const server = () => booted.app.getHttpServer();

  function auditRowsWith(requestId: string): AuditLogRow[] {
    return [...booted.db.tables.audits.values()].filter((row) => row.requestId === requestId);
  }

  /** Valid active-create body; callers override the guardian or lifecycle flag. */
  function activeCreateBody(primaryGuardianCustomerId: string) {
    return {
      name: "Firulais",
      speciesId: fixture.species.id,
      breedId: fixture.breed.id,
      sex: "MALE" as const,
      primaryGuardianCustomerId,
    };
  }

  it("denies anonymous callers and every command missing its permission key", async () => {
    const anonymous = await supertest(server())
      .post("/patients")
      .send(activeCreateBody(fixture.a.customer.id));
    expect(anonymous.status).toBe(401);
    expect((anonymous.body as ErrorDto).error.code).toBe("UNAUTHENTICATED");

    const readOnlyRole = seedRoleWithKeys(
      booted.db,
      `PATIENTS_CMD_READONLY_${fixture.a.tenant.slug}`,
      "Command read-only (fixture)",
      ["patients.read"]
    );
    const readOnly = seedRbacActor(booted.db, {
      email: `cmd-readonly-${fixture.a.tenant.slug}@isolation.test`,
      tenantId: fixture.a.tenant.id,
      roleId: readOnlyRole.role.id,
    });

    const denied = [
      supertest(server())
        .post("/patients")
        .set("Cookie", readOnly.cookie)
        .send(activeCreateBody(fixture.a.customer.id)),
      supertest(server())
        .put(`/patients/${randomUUID()}`)
        .set("Cookie", readOnly.cookie)
        .send({ name: "Nope" }),
      supertest(server())
        .post(`/patients/${randomUUID()}/deactivate`)
        .set("Cookie", readOnly.cookie)
        .send({}),
    ];
    for (const response of await Promise.all(denied)) {
      expect(response.status).toBe(403);
      expect((response.body as ErrorDto).error.code).toBe("FORBIDDEN");
    }
  });

  it("creates an active Patient with its primary guardian, an allowlisted DTO, and one atomic audit pair", async () => {
    const requestId = randomUUID();
    const response = await supertest(server())
      .post("/patients")
      .set("Cookie", fixture.a.actor.cookie)
      .set(REQUEST_ID_HEADER, requestId)
      .send(activeCreateBody(fixture.a.customer.id))
      .expect(201);

    const body = response.body as PatientDto;
    expect(Object.keys(body).sort()).toEqual([...PATIENT_RESPONSE_KEYS].sort());
    expect(body).not.toHaveProperty("primaryGuardianCustomerId");
    expect(body.tenantId).toBe(fixture.a.tenant.id);
    expect(body.isActive).toBe(true);

    const guardians = [...booted.db.tables.patientGuardians.values()].filter(
      (row) => row.patientId === body.id
    );
    expect(guardians).toHaveLength(1);
    expect(guardians[0]).toMatchObject({
      tenantId: fixture.a.tenant.id,
      customerId: fixture.a.customer.id,
      isPrimary: true,
      isActive: true,
    });

    // Atomic audit: both rows co-commit under the SAME request and carry ids,
    // never the CONFIDENTIAL name value.
    const audits = auditRowsWith(requestId);
    const patientAudit = audits.find((row) => row.action === "patient.created");
    const guardianAudit = audits.find((row) => row.action === "patient_guardian.created");
    expect(patientAudit?.targetId).toBe(body.id);
    expect(guardianAudit?.targetId).toBe(guardians[0].id);
    expect(patientAudit?.requestId).toBe(guardianAudit?.requestId);
    expect(JSON.stringify(audits.map((row) => row.metadata))).not.toContain(body.name);
  });

  it("rejects an active create without primaryGuardianCustomerId and persists nothing", async () => {
    const patientsBefore = booted.db.tables.patients.size;
    const guardiansBefore = booted.db.tables.patientGuardians.size;

    const response = await supertest(server())
      .post("/patients")
      .set("Cookie", fixture.a.actor.cookie)
      .send({ name: "Sin Tutor", speciesId: fixture.species.id, sex: "UNKNOWN" })
      .expect(400);

    expect((response.body as ErrorDto).error.code).toBe("VALIDATION_FAILED");
    expect(booted.db.tables.patients.size).toBe(patientsBefore);
    expect(booted.db.tables.patientGuardians.size).toBe(guardiansBefore);
  });

  it("creates an inactive Patient without a guardian", async () => {
    const response = await supertest(server())
      .post("/patients")
      .set("Cookie", fixture.a.actor.cookie)
      .send({ name: "Dormilón", speciesId: fixture.species.id, sex: "UNKNOWN", isActive: false })
      .expect(201);

    const body = response.body as PatientDto;
    expect(body.isActive).toBe(false);
    expect(
      [...booted.db.tables.patientGuardians.values()].filter((row) => row.patientId === body.id)
    ).toHaveLength(0);
  });

  it("updates a Patient and co-commits exactly one audit row for the changed field", async () => {
    const { patient } = fixture.createPatientA();
    const auditsBefore = booted.db.tables.audits.size;

    const response = await supertest(server())
      .put(`/patients/${patient.id}`)
      .set("Cookie", fixture.a.actor.cookie)
      .send({ name: "Bobby II" })
      .expect(200);

    expect((response.body as PatientDto).name).toBe("Bobby II");
    expect(booted.db.tables.audits.size).toBe(auditsBefore + 1);
    const audit = [...booted.db.tables.audits.values()].find(
      (row) => row.action === "patient.updated" && row.targetId === patient.id
    );
    expect(audit?.metadata).toMatchObject({ changedFields: ["name"] });
  });

  it("activates an inactive Patient with a primary guardian and returns 409 without one", async () => {
    const createInactive = await supertest(server())
      .post("/patients")
      .set("Cookie", fixture.a.actor.cookie)
      .send({ name: "En espera", speciesId: fixture.species.id, sex: "UNKNOWN", isActive: false })
      .expect(201);
    const inactiveId = (createInactive.body as PatientDto).id;

    const conflict = await supertest(server())
      .put(`/patients/${inactiveId}`)
      .set("Cookie", fixture.a.actor.cookie)
      .send({ isActive: true })
      .expect(409);
    expect((conflict.body as ErrorDto).error.code).toBe("CONFLICT");

    const activated = await supertest(server())
      .put(`/patients/${inactiveId}`)
      .set("Cookie", fixture.a.actor.cookie)
      .send({ isActive: true, primaryGuardianCustomerId: fixture.a.customer.id })
      .expect(200);

    expect((activated.body as PatientDto).isActive).toBe(true);
    const primaries = [...booted.db.tables.patientGuardians.values()].filter(
      (row) => row.patientId === inactiveId && row.isPrimary && row.isActive
    );
    expect(primaries).toHaveLength(1);
  });

  it("deactivates a Patient idempotently (repeat is a no-op that still audits)", async () => {
    const { patient } = fixture.createPatientA();

    const first = await supertest(server())
      .post(`/patients/${patient.id}/deactivate`)
      .set("Cookie", fixture.a.actor.cookie)
      .send({})
      .expect(201);
    expect((first.body as PatientDto).isActive).toBe(false);

    const second = await supertest(server())
      .post(`/patients/${patient.id}/deactivate`)
      .set("Cookie", fixture.a.actor.cookie)
      .send({})
      .expect(201);
    expect((second.body as PatientDto).isActive).toBe(false);
    expect((second.body as PatientDto).id).toBe(patient.id);
  });

  it("masks foreign Patient PUT and deactivate as byte-equivalent 404 without mutating it", async () => {
    const { patient: foreignPatient } = fixture.createPatientB();

    await expectCrossTenant404({
      app: booted.app,
      cookie: fixture.a.actor.cookie,
      nonexistentUrl: `/patients/${randomUUID()}`,
      foreignUrl: `/patients/${foreignPatient.id}`,
      method: "PUT",
      body: { name: "Secuestrado" },
      forbiddenIdentifiers: [foreignPatient.id, fixture.b.tenant.id],
    });

    await expectCrossTenant404({
      app: booted.app,
      cookie: fixture.a.actor.cookie,
      nonexistentUrl: `/patients/${randomUUID()}/deactivate`,
      foreignUrl: `/patients/${foreignPatient.id}/deactivate`,
      method: "POST",
      body: {},
      forbiddenIdentifiers: [foreignPatient.id, fixture.b.tenant.id],
    });

    const after = booted.db.tables.patients.get(foreignPatient.id);
    expect(after).toMatchObject({ name: foreignPatient.name, isActive: true });
  });

  it("masks a foreign primary guardian Customer as byte-equivalent 404 and persists nothing", async () => {
    const patientsBefore = booted.db.tables.patients.size;
    const guardiansBefore = booted.db.tables.patientGuardians.size;

    await expectCrossTenant404({
      app: booted.app,
      cookie: fixture.a.actor.cookie,
      nonexistentUrl: "/patients",
      foreignUrl: "/patients",
      method: "POST",
      body: activeCreateBody(randomUUID()),
      foreignBody: activeCreateBody(fixture.b.customer.id),
      forbiddenIdentifiers: [fixture.b.customer.id, fixture.b.tenant.id],
    });

    expect(booted.db.tables.patients.size).toBe(patientsBefore);
    expect(booted.db.tables.patientGuardians.size).toBe(guardiansBefore);
  });

  it("denies every command when the tenant lacks the veterinary entitlement", async () => {
    const calls = [
      supertest(server())
        .post("/patients")
        .set("Cookie", fixture.c.actor.cookie)
        .send(activeCreateBody(fixture.c.customer.id)),
      supertest(server())
        .put(`/patients/${randomUUID()}`)
        .set("Cookie", fixture.c.actor.cookie)
        .send({ name: "No" }),
      supertest(server())
        .post(`/patients/${randomUUID()}/deactivate`)
        .set("Cookie", fixture.c.actor.cookie)
        .send({}),
    ];
    for (const response of await Promise.all(calls)) {
      expect(response.status).toBe(403);
      expect((response.body as ErrorDto).error.code).toBe("FEATURE_NOT_ENTITLED");
    }
  });
});
