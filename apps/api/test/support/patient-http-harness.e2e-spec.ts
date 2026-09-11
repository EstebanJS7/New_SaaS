import { randomUUID } from "node:crypto";
import { Controller, Get, Post, Put } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DomainError } from "@newsaas/shared";
import { RequirePermissions } from "../../src/rbac/require-permissions.decorator.js";
import { bootTestApp, type BootedTestApp } from "./boot-test-app.js";
import { expectCrossTenant404 } from "./expect-cross-tenant-404.js";
import { seedPatientHttp, type PatientHttpFixture } from "./patient-http-fixture.js";

/**
 * Tenant-scoped probe route used ONLY to self-test the generalized 404 helper.
 * It always masks its target as NOT_FOUND, exactly like a real foreign-UUID
 * miss, so GET/POST/PUT byte-equivalence can be proven before any Patient
 * route exists (WU3.2+ reuse the helper against the real controllers). The
 * empty `@RequirePermissions()` declaration is the authenticated-only contract
 * bucket that keeps the deny-by-default PermissionGuard from rejecting it.
 */
@Controller("harness")
@RequirePermissions()
class HarnessProbeController {
  @Get(":id")
  read(): never {
    throw new DomainError("NOT_FOUND", "Harness probe resource was not found.");
  }

  @Put(":id")
  update(): never {
    throw new DomainError("NOT_FOUND", "Harness probe resource was not found.");
  }

  @Post(":id")
  command(): never {
    throw new DomainError("NOT_FOUND", "Harness probe resource was not found.");
  }
}

/**
 * Harness SELF-TEST for EPIC-05 WU3.1: proves the test-only boundary works
 * before any integration suite depends on it — the in-memory Patient/Guardian
 * delegates are tenant-safe and roll back, the shared 404 helper generalizes to
 * commands, and the fixture seeds isolated tenants. Every factory is invoked
 * INSIDE an `it` so no suite can ever depend on an id from a previous test.
 */
describe("patient HTTP harness (self-test)", () => {
  let booted: BootedTestApp;
  let fixture: PatientHttpFixture;

  beforeAll(async () => {
    booted = await bootTestApp({ extraControllers: [HarnessProbeController] });
    fixture = seedPatientHttp(booted.db);
  });

  afterAll(async () => {
    await booted.close();
  });

  it("seeds three isolated tenants with grants, global taxonomy and customers", () => {
    const { tables } = booted.db;
    expect(tables.tenants.size).toBe(3);
    expect(tables.species.size).toBe(1);
    expect(tables.breeds.size).toBe(1);
    expect(tables.customers.size).toBe(3);

    const entitled = new Set([...tables.entitlements.values()].map((grant) => grant.tenantId));
    expect(entitled.has(fixture.a.tenant.id)).toBe(true);
    expect(entitled.has(fixture.b.tenant.id)).toBe(true);
    // Tenant C is permissioned but WITHOUT the veterinary entitlement.
    expect(entitled.has(fixture.c.tenant.id)).toBe(false);
  });

  it("scopes the Patient and Guardian delegates to the owning tenant", () => {
    const { patient: patientA, guardian: guardianA } = fixture.createPatientA();
    const { patient: patientB } = fixture.createPatientB();
    const prisma = booted.db.prisma;

    const listedA = prisma.patient.findMany({ where: { tenantId: fixture.a.tenant.id } });
    expect(listedA.map((row) => row.id)).toContain(patientA.id);
    expect(listedA.map((row) => row.id)).not.toContain(patientB.id);

    // A foreign patient id under A's tenant resolves to null (never the row).
    expect(
      prisma.patient.findFirst({ where: { id: patientB.id, tenantId: fixture.a.tenant.id } })
    ).toBeNull();

    const guardiansA = prisma.patientGuardian.findMany({
      where: { tenantId: fixture.a.tenant.id, patientId: patientA.id },
    });
    expect(guardiansA.map((row) => row.id)).toEqual([guardianA.id]);
    expect(
      prisma.patientGuardian.findFirst({
        where: { id: guardianA.id, tenantId: fixture.b.tenant.id, patientId: patientA.id },
      })
    ).toBeNull();
  });

  it("rolls back Patient writes when the transaction throws", async () => {
    const before = booted.db.tables.patients.size;
    await expect(
      booted.db.prisma.$transaction((tx) => {
        tx.patient.create({
          data: {
            tenantId: fixture.a.tenant.id,
            name: "Rollback probe",
            speciesId: fixture.species.id,
            breedId: null,
            sex: "UNKNOWN",
            birthDate: null,
            isActive: false,
          },
        });
        return Promise.reject(new Error("rollback probe"));
      })
    ).rejects.toThrow("rollback probe");
    expect(booted.db.tables.patients.size).toBe(before);
  });

  it("masks foreign GET/POST/PUT byte-equivalently with one shared request id", async () => {
    const { patient: foreignPatient } = fixture.createPatientB();
    for (const method of ["GET", "POST", "PUT"] as const) {
      await expectCrossTenant404({
        app: booted.app,
        cookie: fixture.a.actor.cookie,
        method,
        body: { note: "probe" },
        nonexistentUrl: `/harness/${randomUUID()}`,
        foreignUrl: `/harness/${foreignPatient.id}`,
        forbiddenIdentifiers: [foreignPatient.id, fixture.b.tenant.id],
      });
    }
  });
});
