import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import { RequestContextService } from "../context/request-context.service.js";
import type { AuditAppendInput, AuditWriter } from "../audit/audit-writer.service.js";
import type { EntitlementsService } from "../entitlements/entitlements.service.js";
import { createPatientBody } from "./patient.zod.js";
import { PatientsService } from "./patients.service.js";
import type {
  PatientDelegate,
  PatientGuardianDelegate,
  PatientGuardianRow,
  PatientGuardianWhere,
  PatientRow,
  PatientsTransaction,
  PatientCustomerDelegate,
  SpeciesDelegate,
  BreedDelegate,
} from "./patients.service.js";

const SPECIES_DOG = "11111111-1111-4111-8111-111111111111";
const SPECIES_CAT = "11111111-1111-4111-8111-111111111112";
const BREED_LAB = "22222222-2222-4222-8222-222222222221";
const CUSTOMER_A = "33333333-3333-4333-8333-333333333331";
const CUSTOMER_B = "33333333-3333-4333-8333-333333333332";
const FOREIGN_CUSTOMER = "33333333-3333-4333-8333-333333333339";

describe("PatientsService", () => {
  let requestContext: RequestContextService;
  let appendMock: Mock<(input: AuditAppendInput, tx?: unknown) => Promise<{ id: string }>>;
  let audit: AuditWriter;
  let entitlementsMock: Mock<(tenantId: string, featureCode: string) => Promise<boolean>>;
  let entitlements: EntitlementsService;
  let patients: Map<string, PatientRow>;
  let guardians: Map<string, PatientGuardianRow>;
  let species: Set<string>;
  let breeds: Map<string, string>;
  let customers: Map<string, string>;
  let service: PatientsService;

  function withContext<T>(work: () => T, tenantId = "tenant-1"): T {
    return requestContext.run("req-1", () => {
      requestContext.setUserProfileId("11111111-1111-4111-8111-111111111100");
      requestContext.setTenantMembership({
        tenantId,
        membershipId: "mem-1",
        roleId: "role-1",
        roleCode: "OWNER",
      });
      return work();
    });
  }

  function makeService(): PatientsService {
    const patientDelegate: PatientDelegate = {
      findMany: ({ where, orderBy }) => {
        let rows = [...patients.values()].filter(
          (row) =>
            row.tenantId === where.tenantId &&
            (where.isActive === undefined || row.isActive === where.isActive)
        );
        if (orderBy?.name) {
          rows = rows.sort((a, b) => a.name.localeCompare(b.name));
          if (orderBy.name === "desc") rows.reverse();
        }
        return Promise.resolve(rows);
      },
      findFirst: ({ where }) =>
        Promise.resolve(
          [...patients.values()].find(
            (row) => row.id === where.id && row.tenantId === where.tenantId
          ) ?? null
        ),
      create: ({ data }) => {
        const now = new Date();
        const created: PatientRow = {
          id: `pat-${patients.size + 1}`,
          ...data,
          createdAt: now,
          updatedAt: now,
        };
        patients.set(created.id, created);
        return Promise.resolve(created);
      },
      updateMany: ({ where, data }) => {
        const row = patients.get(where.id);
        if (row?.tenantId !== where.tenantId) return Promise.resolve({ count: 0 });
        if (where.isActive !== undefined && row.isActive !== where.isActive) {
          return Promise.resolve({ count: 0 });
        }
        Object.assign(row, data, { updatedAt: new Date() });
        return Promise.resolve({ count: 1 });
      },
    };

    const matchesGuardian = (row: PatientGuardianRow, where: PatientGuardianWhere): boolean => {
      if (where.id !== undefined && row.id !== where.id) return false;
      if (row.tenantId !== where.tenantId) return false;
      if (where.patientId !== undefined && row.patientId !== where.patientId) return false;
      if (where.customerId !== undefined && row.customerId !== where.customerId) return false;
      if (where.isPrimary !== undefined && row.isPrimary !== where.isPrimary) return false;
      if (where.isActive !== undefined && row.isActive !== where.isActive) return false;
      return true;
    };

    const guardianDelegate: PatientGuardianDelegate = {
      findMany: ({ where, orderBy }) => {
        let rows = [...guardians.values()].filter(
          (row) =>
            row.tenantId === where.tenantId &&
            row.patientId === where.patientId &&
            (where.isActive === undefined || row.isActive === where.isActive)
        );
        if (orderBy?.position) {
          rows = rows.sort((a, b) => a.position - b.position);
          if (orderBy.position === "desc") rows.reverse();
        }
        return Promise.resolve(rows);
      },
      findFirst: ({ where }) =>
        Promise.resolve([...guardians.values()].find((row) => matchesGuardian(row, where)) ?? null),
      create: ({ data }) => {
        const now = new Date();
        const created: PatientGuardianRow = {
          id: `grd-${guardians.size + 1}`,
          ...data,
          createdAt: now,
          updatedAt: now,
        };
        guardians.set(created.id, created);
        return Promise.resolve(created);
      },
      updateMany: ({ where, data }) => {
        const matching = [...guardians.values()].filter((row) => matchesGuardian(row, where));
        for (const row of matching) Object.assign(row, data, { updatedAt: new Date() });
        return Promise.resolve({ count: matching.length });
      },
    };

    const speciesDelegate: SpeciesDelegate = {
      findFirst: ({ where }) => Promise.resolve(species.has(where.id) ? { id: where.id } : null),
    };

    const breedDelegate: BreedDelegate = {
      findFirst: ({ where }) =>
        Promise.resolve(breeds.get(where.id) === where.speciesId ? { id: where.id } : null),
    };

    const customerDelegate: PatientCustomerDelegate = {
      findFirst: ({ where }) =>
        Promise.resolve(customers.get(where.id) === where.tenantId ? { id: where.id } : null),
    };

    const tx: PatientsTransaction = {
      patient: patientDelegate,
      patientGuardian: guardianDelegate,
      species: speciesDelegate,
      breed: breedDelegate,
      customer: customerDelegate,
      auditLog: { create: vi.fn().mockResolvedValue({ id: "audit-1" }) },
    };

    const prisma = {
      $transaction: async <T>(work: (scope: PatientsTransaction) => Promise<T>): Promise<T> => {
        const patientSnapshot = new Map([...patients].map(([key, row]) => [key, { ...row }]));
        const guardianSnapshot = new Map([...guardians].map(([key, row]) => [key, { ...row }]));
        try {
          return await work(tx);
        } catch (error) {
          patients.clear();
          for (const [key, row] of patientSnapshot) patients.set(key, row);
          guardians.clear();
          for (const [key, row] of guardianSnapshot) guardians.set(key, row);
          throw error;
        }
      },
      patient: patientDelegate,
      patientGuardian: guardianDelegate,
      species: speciesDelegate,
      breed: breedDelegate,
      customer: customerDelegate,
    };

    return new PatientsService(prisma, requestContext, audit, entitlements);
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

  beforeEach(() => {
    requestContext = new RequestContextService();
    appendMock = vi
      .fn<(input: AuditAppendInput, tx?: unknown) => Promise<{ id: string }>>()
      .mockResolvedValue({ id: "audit-1" });
    audit = { append: appendMock } as unknown as AuditWriter;
    entitlementsMock = vi
      .fn<(tenantId: string, featureCode: string) => Promise<boolean>>()
      .mockResolvedValue(true);
    entitlements = { has: entitlementsMock } as unknown as EntitlementsService;

    patients = new Map();
    guardians = new Map();
    species = new Set([SPECIES_DOG, SPECIES_CAT]);
    breeds = new Map([[BREED_LAB, SPECIES_DOG]]);
    customers = new Map([
      [CUSTOMER_A, "tenant-1"],
      [CUSTOMER_B, "tenant-1"],
      [FOREIGN_CUSTOMER, "tenant-2"],
    ]);
    service = makeService();
  });

  it("creates an active patient and its primary guardian atomically", async () => {
    const result = await withContext(() =>
      service.create(patientInput({ primaryGuardianCustomerId: CUSTOMER_A }))
    );

    expect(result.isActive).toBe(true);
    expect(patients.size).toBe(1);
    expect([...guardians.values()]).toHaveLength(1);
    const guardian = [...guardians.values()][0];
    expect(guardian).toMatchObject({ isPrimary: true, isActive: true, customerId: CUSTOMER_A });
    expect(appendMock.mock.calls.map((call) => call[0].action)).toEqual([
      "patient.created",
      "patient_guardian.created",
    ]);
  });

  it("rejects an active create without a primary guardian", async () => {
    await expect(withContext(() => service.create(patientInput()))).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
    });
    expect(patients.size).toBe(0);
    expect(guardians.size).toBe(0);
  });

  it("requires primaryGuardianCustomerId at the Zod boundary for active default", () => {
    expect(createPatientBody.safeParse(patientInput()).success).toBe(false);
    expect(
      createPatientBody.safeParse(patientInput({ primaryGuardianCustomerId: CUSTOMER_A })).success
    ).toBe(true);
    expect(createPatientBody.safeParse(patientInput({ isActive: false })).success).toBe(true);
  });

  it("creates an inactive patient without a guardian", async () => {
    const result = await withContext(() => service.create(patientInput({ isActive: false })));

    expect(result.isActive).toBe(false);
    expect(guardians.size).toBe(0);
    expect(appendMock.mock.calls.map((call) => call[0].action)).toEqual(["patient.created"]);
  });

  it("rejects an unknown species", async () => {
    await expect(
      withContext(() =>
        service.create(patientInput({ speciesId: "99999999-9999-4999-8999-999999999999" }))
      )
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  });

  it("rejects a breed that does not belong to the species", async () => {
    await expect(
      withContext(() => service.create(patientInput({ speciesId: SPECIES_CAT })))
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  });

  it("rejects a cross-tenant primary guardian and persists nothing", async () => {
    await expect(
      withContext(() =>
        service.create(patientInput({ primaryGuardianCustomerId: FOREIGN_CUSTOMER }))
      )
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    expect(patients.size).toBe(0);
    expect(guardians.size).toBe(0);
  });

  it("denies every operation without the veterinary entitlement", async () => {
    entitlementsMock.mockResolvedValue(false);
    await expect(withContext(() => service.list())).rejects.toMatchObject({
      code: "FEATURE_NOT_ENTITLED",
    });
    expect(patients.size).toBe(0);
  });

  it("lists only active patients", async () => {
    await withContext(() =>
      service.create(patientInput({ primaryGuardianCustomerId: CUSTOMER_A }))
    );
    await withContext(() =>
      service.create(patientInput({ name: "Ghost", primaryGuardianCustomerId: CUSTOMER_B }))
    );
    const inactive = await withContext(() =>
      service.create(patientInput({ name: "Inactive", isActive: false }))
    );
    await withContext(() => service.deactivate(inactive.id));

    const list = await withContext(() => service.list());
    expect(list.map((row) => row.name)).toEqual(["Bobby", "Ghost"]);
  });

  it("returns 404 for a cross-tenant patient", async () => {
    const created = await withContext(() =>
      service.create(patientInput({ primaryGuardianCustomerId: CUSTOMER_A }))
    );
    await expect(withContext(() => service.get(created.id), "tenant-2")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("updates identity and audits the changed fields only", async () => {
    const created = await withContext(() =>
      service.create(patientInput({ primaryGuardianCustomerId: CUSTOMER_A }))
    );
    appendMock.mockClear();

    const updated = await withContext(() => service.update(created.id, { name: "Bobby II" }));
    expect(updated.name).toBe("Bobby II");
    expect(appendMock).toHaveBeenCalledTimes(1);
    expect(appendMock.mock.calls[0][0]).toMatchObject({
      action: "patient.updated",
      metadata: { changedFields: ["name"] },
    });
  });

  it("activates an inactive patient and establishes its primary guardian", async () => {
    const created = await withContext(() => service.create(patientInput({ isActive: false })));
    appendMock.mockClear();

    const activated = await withContext(() =>
      service.update(created.id, { isActive: true, primaryGuardianCustomerId: CUSTOMER_A })
    );

    expect(activated.isActive).toBe(true);
    const guardian = [...guardians.values()][0];
    expect(guardian).toMatchObject({ isPrimary: true, isActive: true });
    expect(appendMock.mock.calls.map((call) => call[0].action)).toEqual([
      "patient.updated",
      "patient_guardian.created",
    ]);
  });

  it("returns CONFLICT when activating without a primary guardian", async () => {
    const created = await withContext(() => service.create(patientInput({ isActive: false })));

    await expect(
      withContext(() => service.update(created.id, { isActive: true }))
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(patients.get(created.id)?.isActive).toBe(false);
  });

  it("deactivates a patient idempotently", async () => {
    const created = await withContext(() =>
      service.create(patientInput({ primaryGuardianCustomerId: CUSTOMER_A }))
    );
    const first = await withContext(() => service.deactivate(created.id));
    expect(first.isActive).toBe(false);

    appendMock.mockClear();
    const second = await withContext(() => service.deactivate(created.id));
    expect(second.isActive).toBe(false);
    expect(appendMock).toHaveBeenCalledTimes(1);
    expect(appendMock.mock.calls[0][0].metadata).toMatchObject({ changedFields: [] });
  });

  it("returns an exact allowlisted patient DTO without guardian fields", async () => {
    const result = await withContext(() =>
      service.create(patientInput({ primaryGuardianCustomerId: CUSTOMER_A }))
    );

    expect(Object.keys(result).sort()).toEqual(
      [
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
      ].sort()
    );
    expect(result).not.toHaveProperty("primaryGuardianCustomerId");
  });
});
