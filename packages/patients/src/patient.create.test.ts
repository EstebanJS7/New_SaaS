import { describe, expect, it } from "vitest";
import type { AuditAppendInput, AuditAppendTx } from "@newsaas/database";
import { createPatient, toPatientResponse } from "./patient.create.js";
import type {
  PatientAuditAppender,
  PatientCatalog,
  PatientCreateDb,
  PatientCreateTransaction,
  PatientGuardianRow,
  PatientGuardianWhere,
  PatientRow,
} from "./patient.create.js";
import { createPatientBody } from "./patient.zod.js";

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_TENANT_ID = "11111111-1111-4111-8111-111111111112";
const ACTOR_ID = "22222222-2222-4222-8222-222222222222";
const SPECIES_DOG = "33333333-3333-4333-8333-333333333331";
const SPECIES_CAT = "33333333-3333-4333-8333-333333333332";
const BREED_LAB = "44444444-4444-4444-8444-444444444441";
const CUSTOMER_A = "55555555-5555-4555-8555-555555555551";
const FOREIGN_CUSTOMER = "55555555-5555-4555-8555-555555555559";
const CREATED_AT = new Date("2026-10-19T12:00:00.000Z");

interface RecordedAppend {
  readonly input: AuditAppendInput;
  readonly tx: AuditAppendTx | undefined;
}

function matchesGuardian(row: PatientGuardianRow, where: PatientGuardianWhere): boolean {
  if (where.id !== undefined && row.id !== where.id) return false;
  if (row.tenantId !== where.tenantId) return false;
  if (where.patientId !== undefined && row.patientId !== where.patientId) return false;
  if (where.customerId !== undefined && row.customerId !== where.customerId) return false;
  if (where.isPrimary !== undefined && row.isPrimary !== where.isPrimary) return false;
  if (where.isActive !== undefined && row.isActive !== where.isActive) return false;
  return true;
}

/**
 * A stub of the narrow contracts, and nothing else: no Nest module, no request
 * context, no entitlement gate, no database. If `createPatient` ever needs one of
 * those, this test stops compiling — which is the point of the interfaces
 * ([[DEC-073]]).
 *
 * The fake transaction snapshots both tables and restores them on a throw, so the
 * rollback assertions below mean what they say.
 */
function makeHarness() {
  const patients: PatientRow[] = [];
  const guardians: PatientGuardianRow[] = [];
  const appends: RecordedAppend[] = [];
  let transactions = 0;

  const customerTenants = new Map([
    [CUSTOMER_A, TENANT_ID],
    [FOREIGN_CUSTOMER, OTHER_TENANT_ID],
  ]);
  const species = new Set([SPECIES_DOG, SPECIES_CAT]);
  const breeds = new Map([[BREED_LAB, SPECIES_DOG]]);

  const tx: PatientCreateTransaction = {
    patient: {
      create: ({ data }) => {
        const created: PatientRow = {
          id: `pat-${patients.length + 1}`,
          ...data,
          createdAt: CREATED_AT,
          updatedAt: CREATED_AT,
        };
        patients.push(created);
        return Promise.resolve(created);
      },
    },
    patientGuardian: {
      findFirst: ({ where }) =>
        Promise.resolve(guardians.find((row) => matchesGuardian(row, where)) ?? null),
      create: ({ data }) => {
        const created: PatientGuardianRow = {
          id: `grd-${guardians.length + 1}`,
          ...data,
          createdAt: CREATED_AT,
          updatedAt: CREATED_AT,
        };
        guardians.push(created);
        return Promise.resolve(created);
      },
      updateMany: ({ where, data }) => {
        const matching = guardians.filter((row) => matchesGuardian(row, where));
        for (const row of matching) Object.assign(row, data);
        return Promise.resolve({ count: matching.length });
      },
    },
    customer: {
      findFirst: ({ where }) =>
        Promise.resolve(customerTenants.get(where.id) === where.tenantId ? { id: where.id } : null),
    },
    auditLog: { create: () => Promise.resolve({ id: "audit-1" }) },
  };

  const db: PatientCreateDb = {
    $transaction: <T>(work: (scope: PatientCreateTransaction) => Promise<T>): Promise<T> => {
      transactions += 1;
      const patientSnapshot = patients.map((row) => ({ ...row }));
      const guardianSnapshot = guardians.map((row) => ({ ...row }));
      const rollback = (): void => {
        patients.splice(0, patients.length, ...patientSnapshot);
        guardians.splice(0, guardians.length, ...guardianSnapshot);
      };
      return work(tx).catch((error: unknown) => {
        rollback();
        throw error;
      });
    },
  };

  const catalog: PatientCatalog = {
    species: {
      findFirst: ({ where }) => Promise.resolve(species.has(where.id) ? { id: where.id } : null),
    },
    breed: {
      findFirst: ({ where }) =>
        Promise.resolve(breeds.get(where.id) === where.speciesId ? { id: where.id } : null),
    },
  };

  const audit: PatientAuditAppender = {
    append: (input, txArg) => {
      appends.push({ input, tx: txArg });
      return Promise.resolve({ id: "audit-1" });
    },
  };

  return {
    patients,
    guardians,
    appends,
    catalog,
    db,
    audit,
    transactionCount: () => transactions,
  };
}

function patientInput(overrides: Record<string, unknown> = {}) {
  return {
    name: "Bobby",
    speciesId: SPECIES_DOG,
    breedId: BREED_LAB,
    sex: "MALE" as const,
    ...overrides,
  };
}

describe("createPatient", () => {
  it("creates an active patient and its guardian, co-committing both audit rows", async () => {
    const harness = makeHarness();

    const created = await createPatient({
      db: harness.db,
      audit: harness.audit,
      tenantId: TENANT_ID,
      actorUserProfileId: ACTOR_ID,
      input: patientInput({ primaryGuardianCustomerId: CUSTOMER_A }),
      catalog: harness.catalog,
    });

    expect(created).toMatchObject({ tenantId: TENANT_ID, name: "Bobby", isActive: true });
    expect(harness.guardians).toHaveLength(1);
    expect(harness.guardians[0]).toMatchObject({
      patientId: created.id,
      customerId: CUSTOMER_A,
      isPrimary: true,
      isActive: true,
    });

    expect(harness.appends.map((entry) => entry.input.action)).toEqual([
      "patient.created",
      "patient_guardian.created",
    ]);
    expect(harness.appends[0]?.input).toMatchObject({
      tenantId: TENANT_ID,
      actorUserProfileId: ACTOR_ID,
      targetType: "patient",
      targetId: created.id,
      metadata: { schemaVersion: 1, changedFields: ["name", "speciesId", "breedId", "sex"] },
    });
    expect(harness.appends[1]?.input).toMatchObject({
      targetType: "patient_guardian",
      targetId: harness.guardians[0]?.id,
      metadata: {
        schemaVersion: 1,
        changedFields: ["customerId", "isPrimary"],
        patientId: created.id,
      },
    });
    // Both audit rows join the transaction the patient was written in.
    for (const entry of harness.appends) {
      expect(entry.tx).toBeDefined();
    }
  });

  it("creates an inactive patient without a guardian", async () => {
    const harness = makeHarness();

    const created = await createPatient({
      db: harness.db,
      audit: harness.audit,
      tenantId: TENANT_ID,
      actorUserProfileId: ACTOR_ID,
      input: patientInput({ isActive: false }),
      catalog: harness.catalog,
    });

    expect(created.isActive).toBe(false);
    expect(harness.guardians).toHaveLength(0);
    expect(harness.appends.map((entry) => entry.input.action)).toEqual(["patient.created"]);
  });

  it("refuses an active patient with no guardian before opening a transaction", async () => {
    const harness = makeHarness();

    await expect(
      createPatient({
        db: harness.db,
        audit: harness.audit,
        tenantId: TENANT_ID,
        actorUserProfileId: ACTOR_ID,
        input: patientInput(),
        catalog: harness.catalog,
      })
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });

    expect(harness.transactionCount()).toBe(0);
    expect(harness.patients).toHaveLength(0);
    expect(harness.appends).toHaveLength(0);
  });

  it("refuses an unknown species before opening a transaction", async () => {
    const harness = makeHarness();

    await expect(
      createPatient({
        db: harness.db,
        audit: harness.audit,
        tenantId: TENANT_ID,
        actorUserProfileId: ACTOR_ID,
        input: patientInput({
          speciesId: "99999999-9999-4999-8999-999999999999",
          primaryGuardianCustomerId: CUSTOMER_A,
        }),
        catalog: harness.catalog,
      })
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });

    expect(harness.transactionCount()).toBe(0);
    expect(harness.appends).toHaveLength(0);
  });

  it("refuses a breed that does not belong to the selected species", async () => {
    const harness = makeHarness();

    await expect(
      createPatient({
        db: harness.db,
        audit: harness.audit,
        tenantId: TENANT_ID,
        actorUserProfileId: ACTOR_ID,
        input: patientInput({ speciesId: SPECIES_CAT, primaryGuardianCustomerId: CUSTOMER_A }),
        catalog: harness.catalog,
      })
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });

    expect(harness.patients).toHaveLength(0);
  });

  it("refuses a guardian from another tenant and rolls the patient back", async () => {
    const harness = makeHarness();

    await expect(
      createPatient({
        db: harness.db,
        audit: harness.audit,
        tenantId: TENANT_ID,
        actorUserProfileId: ACTOR_ID,
        input: patientInput({ primaryGuardianCustomerId: FOREIGN_CUSTOMER }),
        catalog: harness.catalog,
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    expect(harness.patients).toHaveLength(0);
    expect(harness.guardians).toHaveLength(0);
    expect(harness.appends).toHaveLength(0);
  });

  it("maps a stored row to the allowlisted response without guardian fields", () => {
    const response = toPatientResponse({
      id: "pat-1",
      tenantId: TENANT_ID,
      name: "Bobby",
      speciesId: SPECIES_DOG,
      breedId: null,
      sex: "MALE",
      birthDate: CREATED_AT,
      isActive: true,
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
    });

    expect(response).not.toHaveProperty("primaryGuardianCustomerId");
    expect(response.birthDate).toBe(CREATED_AT.toISOString());
  });
});

describe("the create schema stays the single source of the rules", () => {
  it("requires a primary guardian for an active patient and allows an inactive one without", () => {
    expect(createPatientBody.safeParse(patientInput()).success).toBe(false);
    expect(
      createPatientBody.safeParse(patientInput({ primaryGuardianCustomerId: CUSTOMER_A })).success
    ).toBe(true);
    expect(createPatientBody.safeParse(patientInput({ isActive: false })).success).toBe(true);
  });
});
