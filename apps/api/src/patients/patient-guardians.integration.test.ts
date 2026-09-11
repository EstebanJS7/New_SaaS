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
import type { AuditLogRow, CustomerRow } from "../../test/support/in-memory-database.js";
import { REQUEST_ID_HEADER } from "../common/errors/request-id.js";

interface GuardianDto {
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

interface ErrorDto {
  error: { code: string };
}

/** Allowlisted guardian surface — a Prisma model or Customer join must fail. */
const GUARDIAN_RESPONSE_KEYS: readonly string[] = [
  "id",
  "tenantId",
  "patientId",
  "customerId",
  "isPrimary",
  "isActive",
  "position",
  "createdAt",
  "updatedAt",
];

/**
 * EPIC-05 WU3.4 guardian boundary over the REAL guard chain and the WU3.1
 * independent fixture. Every factory runs INSIDE its `it`, so no test depends
 * on an id minted by an earlier test (order independence).
 */
describe("Patient guardian HTTP boundary (WU3.4)", () => {
  let booted: BootedTestApp;
  let fixture: PatientHttpFixture;

  beforeAll(async () => {
    booted = await bootTestApp();
    // Keep ONE listening server for the whole suite so supertest never closes
    // and re-binds between requests (repeated binds race and surface as
    // ECONNREFUSED/ECONNRESET when a test issues several sequential calls).
    await booted.app.listen(0);
    fixture = seedPatientHttp(booted.db);
  });

  afterAll(async () => {
    await booted.close();
  });

  const server = () => booted.app.getHttpServer();

  function auditRowsWith(requestId: string): AuditLogRow[] {
    return [...booted.db.tables.audits.values()].filter((row) => row.requestId === requestId);
  }

  /** Fresh Core Customer in `tenantId` so a guardian link has a real reference. */
  function createCustomer(tenantId: string, displayName: string): CustomerRow {
    return booted.db.prisma.customer.create({
      data: {
        tenantId,
        kind: "INDIVIDUAL",
        displayName,
        legalName: null,
        taxId: null,
        firstName: "Guardian",
        lastName: displayName,
        documentNumber: null,
        isActive: true,
      },
    });
  }

  it("denies anonymous callers and mutations missing patients.guardian.manage", async () => {
    const { patient, guardian } = fixture.createPatientA();

    const anonymous = await supertest(server())
      .post(`/patients/${patient.id}/guardians`)
      .send({ customerId: fixture.a.customer.id });
    expect(anonymous.status).toBe(401);
    expect((anonymous.body as ErrorDto).error.code).toBe("UNAUTHENTICATED");

    const readOnlyRole = seedRoleWithKeys(
      booted.db,
      `PATIENTS_GUARD_RO_${fixture.a.tenant.slug}`,
      "Guardian read-only (fixture)",
      ["patients.read"]
    );
    const readOnly = seedRbacActor(booted.db, {
      email: `guard-ro-${fixture.a.tenant.slug}@isolation.test`,
      tenantId: fixture.a.tenant.id,
      roleId: readOnlyRole.role.id,
    });

    const denied = [
      supertest(server())
        .post(`/patients/${patient.id}/guardians`)
        .set("Cookie", readOnly.cookie)
        .send({ customerId: fixture.a.customer.id }),
      supertest(server())
        .put(`/patients/${patient.id}/guardians/${guardian.id}`)
        .set("Cookie", readOnly.cookie)
        .send({ position: 2 }),
      supertest(server())
        .post(`/patients/${patient.id}/guardians/${guardian.id}/primary`)
        .set("Cookie", readOnly.cookie)
        .send({}),
      supertest(server())
        .post(`/patients/${patient.id}/guardians/${guardian.id}/deactivate`)
        .set("Cookie", readOnly.cookie)
        .send({}),
    ];
    for (const request of denied) {
      const response = await request;
      expect(response.status).toBe(403);
      expect((response.body as ErrorDto).error.code).toBe("FORBIDDEN");
    }
  });

  it("requires patients.read on the guardian read routes", async () => {
    const { patient, guardian } = fixture.createPatientA();
    const managerRole = seedRoleWithKeys(
      booted.db,
      `PATIENTS_GUARD_MGR_${fixture.a.tenant.slug}`,
      "Guardian manage-only (fixture)",
      ["patients.guardian.manage"]
    );
    const manager = seedRbacActor(booted.db, {
      email: `guard-mgr-${fixture.a.tenant.slug}@isolation.test`,
      tenantId: fixture.a.tenant.id,
      roleId: managerRole.role.id,
    });

    for (const path of [
      `/patients/${patient.id}/guardians`,
      `/patients/${patient.id}/guardians/${guardian.id}`,
    ]) {
      const response = await supertest(server()).get(path).set("Cookie", manager.cookie);
      expect(response.status, path).toBe(403);
      expect((response.body as ErrorDto).error.code).toBe("FORBIDDEN");
    }
  });

  it("lists only the caller tenant's active guardians with an allowlisted DTO", async () => {
    const { patient } = fixture.createPatientA();
    const secondary = fixture.createGuardian(
      fixture.a,
      patient.id,
      createCustomer(fixture.a.tenant.id, "Secondary").id,
      { position: 1 }
    );
    const inactive = fixture.createGuardian(
      fixture.a,
      patient.id,
      createCustomer(fixture.a.tenant.id, "Inactive").id,
      { isActive: false, position: 2 }
    );
    const { guardian: foreignGuardian } = fixture.createPatientB();

    const response = await supertest(server())
      .get(`/patients/${patient.id}/guardians`)
      .set("Cookie", fixture.a.actor.cookie)
      .expect(200);

    const body = response.body as GuardianDto[];
    const ids = body.map((guardian) => guardian.id);
    expect(ids).toContain(secondary.id);
    expect(ids).not.toContain(inactive.id);
    expect(ids).not.toContain(foreignGuardian.id);
    for (const guardian of body) {
      expect(Object.keys(guardian).sort()).toEqual([...GUARDIAN_RESPONSE_KEYS].sort());
      expect(guardian.tenantId).toBe(fixture.a.tenant.id);
      expect(guardian.patientId).toBe(patient.id);
    }
  });

  it("reads a single guardian by id with the allowlisted DTO", async () => {
    const { patient, guardian } = fixture.createPatientA();

    const response = await supertest(server())
      .get(`/patients/${patient.id}/guardians/${guardian.id}`)
      .set("Cookie", fixture.a.actor.cookie)
      .expect(200);

    const body = response.body as GuardianDto;
    expect(body.id).toBe(guardian.id);
    expect(body.tenantId).toBe(fixture.a.tenant.id);
    expect(body.customerId).toBe(fixture.a.customer.id);
    expect(body.isPrimary).toBe(true);
    expect(Object.keys(body).sort()).toEqual([...GUARDIAN_RESPONSE_KEYS].sort());
  });

  it("rejects a malformed guardian id with VALIDATION_FAILED", async () => {
    const response = await supertest(server())
      .get("/patients/not-a-uuid/guardians")
      .set("Cookie", fixture.a.actor.cookie)
      .expect(400);
    expect((response.body as ErrorDto).error.code).toBe("VALIDATION_FAILED");
  });

  it("links a secondary guardian and co-commits exactly one audit row", async () => {
    const { patient } = fixture.createPatientA();
    const customer = createCustomer(fixture.a.tenant.id, "Link");
    const requestId = randomUUID();

    const response = await supertest(server())
      .post(`/patients/${patient.id}/guardians`)
      .set("Cookie", fixture.a.actor.cookie)
      .set(REQUEST_ID_HEADER, requestId)
      .send({ customerId: customer.id, position: 1 })
      .expect(201);

    const body = response.body as GuardianDto;
    expect(body.customerId).toBe(customer.id);
    expect(body.isPrimary).toBe(false);
    expect(body.isActive).toBe(true);
    expect(body.position).toBe(1);

    const audits = auditRowsWith(requestId);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      action: "patient_guardian.created",
      targetId: body.id,
    });
    expect(audits[0].metadata).toMatchObject({ patientId: patient.id });
    expect(JSON.stringify(audits[0].metadata)).not.toContain(customer.displayName);
  });

  it("creates a primary guardian by demoting the current primary (exactly one remains)", async () => {
    const { patient, guardian: formerPrimary } = fixture.createPatientA();
    const replacement = createCustomer(fixture.a.tenant.id, "Primary swap");

    const response = await supertest(server())
      .post(`/patients/${patient.id}/guardians`)
      .set("Cookie", fixture.a.actor.cookie)
      .send({ customerId: replacement.id, isPrimary: true })
      .expect(201);

    const body = response.body as GuardianDto;
    expect(body.isPrimary).toBe(true);
    expect(booted.db.tables.patientGuardians.get(formerPrimary.id)?.isPrimary).toBe(false);

    const primaries = [...booted.db.tables.patientGuardians.values()].filter(
      (row) => row.patientId === patient.id && row.isPrimary && row.isActive
    );
    expect(primaries).toHaveLength(1);
    expect(primaries[0].id).toBe(body.id);
  });

  it("updates guardian ordering and audits only the written field", async () => {
    const { patient, guardian } = fixture.createPatientA();
    const auditsBefore = booted.db.tables.audits.size;

    const response = await supertest(server())
      .put(`/patients/${patient.id}/guardians/${guardian.id}`)
      .set("Cookie", fixture.a.actor.cookie)
      .send({ position: 5 })
      .expect(200);

    expect((response.body as GuardianDto).position).toBe(5);
    expect(booted.db.tables.audits.size).toBe(auditsBefore + 1);
    const audit = [...booted.db.tables.audits.values()].find(
      (row) => row.action === "patient_guardian.updated" && row.targetId === guardian.id
    );
    expect(audit?.metadata).toMatchObject({ changedFields: ["position"], patientId: patient.id });
  });

  it("rejects demoting the sole primary of an active Patient with 409", async () => {
    const { patient, guardian } = fixture.createPatientA();

    const response = await supertest(server())
      .put(`/patients/${patient.id}/guardians/${guardian.id}`)
      .set("Cookie", fixture.a.actor.cookie)
      .send({ isPrimary: false })
      .expect(409);

    expect((response.body as ErrorDto).error.code).toBe("CONFLICT");
    expect(booted.db.tables.patientGuardians.get(guardian.id)?.isPrimary).toBe(true);
  });

  it("promotes a secondary guardian transactionally and audits the primary change", async () => {
    const { patient, guardian: primary } = fixture.createPatientA();
    const secondary = fixture.createGuardian(
      fixture.a,
      patient.id,
      createCustomer(fixture.a.tenant.id, "Promoted").id,
      { position: 1 }
    );

    const response = await supertest(server())
      .post(`/patients/${patient.id}/guardians/${secondary.id}/primary`)
      .set("Cookie", fixture.a.actor.cookie)
      .send({})
      .expect(201);

    const body = response.body as GuardianDto;
    expect(body.id).toBe(secondary.id);
    expect(body.isPrimary).toBe(true);
    expect(body.isActive).toBe(true);
    expect(booted.db.tables.patientGuardians.get(primary.id)?.isPrimary).toBe(false);

    const audited = [...booted.db.tables.audits.values()].find(
      (row) => row.action === "patient_guardian.primary_changed" && row.targetId === secondary.id
    );
    expect(audited).toBeDefined();
  });

  it("treats set-primary as idempotent for the current primary (no extra audit)", async () => {
    const { patient, guardian } = fixture.createPatientA();
    const auditsBefore = booted.db.tables.audits.size;

    const response = await supertest(server())
      .post(`/patients/${patient.id}/guardians/${guardian.id}/primary`)
      .set("Cookie", fixture.a.actor.cookie)
      .send({})
      .expect(201);

    expect((response.body as GuardianDto).id).toBe(guardian.id);
    expect(booted.db.tables.audits.size).toBe(auditsBefore);
  });

  it("deactivates a secondary guardian idempotently and audits each call", async () => {
    const { patient } = fixture.createPatientA();
    const secondary = fixture.createGuardian(
      fixture.a,
      patient.id,
      createCustomer(fixture.a.tenant.id, "Deactivated").id,
      { position: 1 }
    );

    const first = await supertest(server())
      .post(`/patients/${patient.id}/guardians/${secondary.id}/deactivate`)
      .set("Cookie", fixture.a.actor.cookie)
      .send({})
      .expect(201);
    expect((first.body as GuardianDto).isActive).toBe(false);

    const second = await supertest(server())
      .post(`/patients/${patient.id}/guardians/${secondary.id}/deactivate`)
      .set("Cookie", fixture.a.actor.cookie)
      .send({})
      .expect(201);
    expect((second.body as GuardianDto).isActive).toBe(false);
    expect((second.body as GuardianDto).id).toBe(secondary.id);

    const audits = [...booted.db.tables.audits.values()].filter(
      (row) => row.action === "patient_guardian.deactivated" && row.targetId === secondary.id
    );
    expect(audits.length).toBeGreaterThanOrEqual(2);
  });

  it("rejects deactivating the primary guardian of an active Patient with 409", async () => {
    const { patient, guardian } = fixture.createPatientA();

    const response = await supertest(server())
      .post(`/patients/${patient.id}/guardians/${guardian.id}/deactivate`)
      .set("Cookie", fixture.a.actor.cookie)
      .send({})
      .expect(409);

    expect((response.body as ErrorDto).error.code).toBe("CONFLICT");
  });

  it("masks a foreign Patient guardian listing as a byte-equivalent 404", async () => {
    const { patient: foreignPatient } = fixture.createPatientB();

    await expectCrossTenant404({
      app: booted.app,
      cookie: fixture.a.actor.cookie,
      nonexistentUrl: `/patients/${randomUUID()}/guardians`,
      foreignUrl: `/patients/${foreignPatient.id}/guardians`,
      forbiddenIdentifiers: [foreignPatient.id, fixture.b.tenant.id],
    });
  });

  it("masks foreign Guardian GET and set-primary as byte-equivalent 404", async () => {
    const { patient } = fixture.createPatientA();
    const { guardian: foreignGuardian } = fixture.createPatientB();

    await expectCrossTenant404({
      app: booted.app,
      cookie: fixture.a.actor.cookie,
      nonexistentUrl: `/patients/${patient.id}/guardians/${randomUUID()}`,
      foreignUrl: `/patients/${patient.id}/guardians/${foreignGuardian.id}`,
      forbiddenIdentifiers: [foreignGuardian.id, fixture.b.tenant.id],
    });

    await expectCrossTenant404({
      app: booted.app,
      cookie: fixture.a.actor.cookie,
      nonexistentUrl: `/patients/${patient.id}/guardians/${randomUUID()}/primary`,
      foreignUrl: `/patients/${patient.id}/guardians/${foreignGuardian.id}/primary`,
      method: "POST",
      body: {},
      forbiddenIdentifiers: [foreignGuardian.id, fixture.b.tenant.id],
    });
  });

  it("masks a foreign Customer guardian link as a byte-equivalent 404 and persists nothing", async () => {
    const { patient } = fixture.createPatientA();
    const guardiansBefore = booted.db.tables.patientGuardians.size;

    await expectCrossTenant404({
      app: booted.app,
      cookie: fixture.a.actor.cookie,
      nonexistentUrl: `/patients/${patient.id}/guardians`,
      foreignUrl: `/patients/${patient.id}/guardians`,
      method: "POST",
      body: { customerId: randomUUID() },
      foreignBody: { customerId: fixture.b.customer.id },
      forbiddenIdentifiers: [fixture.b.customer.id, fixture.b.tenant.id],
    });

    expect(booted.db.tables.patientGuardians.size).toBe(guardiansBefore);
  });

  it("denies every guardian route when the tenant lacks the veterinary entitlement", async () => {
    const patientId = randomUUID();
    const guardianId = randomUUID();

    const calls = [
      supertest(server())
        .get(`/patients/${patientId}/guardians`)
        .set("Cookie", fixture.c.actor.cookie),
      supertest(server())
        .get(`/patients/${patientId}/guardians/${guardianId}`)
        .set("Cookie", fixture.c.actor.cookie),
      supertest(server())
        .post(`/patients/${patientId}/guardians`)
        .set("Cookie", fixture.c.actor.cookie)
        .send({ customerId: fixture.c.customer.id }),
      supertest(server())
        .put(`/patients/${patientId}/guardians/${guardianId}`)
        .set("Cookie", fixture.c.actor.cookie)
        .send({ position: 1 }),
      supertest(server())
        .post(`/patients/${patientId}/guardians/${guardianId}/primary`)
        .set("Cookie", fixture.c.actor.cookie)
        .send({}),
      supertest(server())
        .post(`/patients/${patientId}/guardians/${guardianId}/deactivate`)
        .set("Cookie", fixture.c.actor.cookie)
        .send({}),
    ];

    for (const request of calls) {
      const response = await request;
      expect(response.status).toBe(403);
      expect((response.body as ErrorDto).error.code).toBe("FEATURE_NOT_ENTITLED");
    }
  });
});
