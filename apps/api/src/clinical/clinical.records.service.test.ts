import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import type { AuditAppendInput, AuditWriter } from "../audit/audit-writer.service.js";
import { RequestContextService } from "../context/request-context.service.js";
import type { EntitlementsService } from "../entitlements/entitlements.service.js";
import type { PermissionResolver } from "../rbac/permission-resolver.service.js";
import { CLINICAL_PERMISSIONS } from "./clinical.permissions.js";
import { ClinicalRecordsService } from "./clinical.records.service.js";
import type {
  ClinicalDewormingRow,
  ClinicalRecordDelegate,
  ClinicalRecordsPrisma,
  ClinicalRecordsTransaction,
  ClinicalStudyRow,
  ClinicalTreatmentRow,
  ClinicalVaccinationRow,
  ClinicalWeightRow,
  DewormingCreateData,
  DewormingUpdateData,
  StudyCreateData,
  StudyUpdateData,
  TreatmentCreateData,
  TreatmentUpdateData,
  VaccinationCreateData,
  VaccinationUpdateData,
  WeightCreateData,
  WeightUpdateData,
} from "./clinical.records.service.js";

const PATIENT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const ACTOR = "11111111-1111-4111-8111-111111111100";
const TENANT_A = "tenant-1";

const ALL_CLINICAL_PERMISSIONS = new Set<string>(Object.values(CLINICAL_PERMISSIONS));

interface RowBase {
  id: string;
  tenantId: string;
  patientId: string;
  createdAt: Date;
  updatedAt: Date;
}

describe("ClinicalRecordsService (WU2B specialized records)", () => {
  let requestContext: RequestContextService;
  let appendMock: Mock<(input: AuditAppendInput, tx?: unknown) => Promise<{ id: string }>>;
  let audit: AuditWriter;
  let entitlementsMock: Mock<(tenantId: string, featureCode: string) => Promise<boolean>>;
  let entitlements: EntitlementsService;
  let resolveMock: Mock<() => Promise<Set<string>>>;
  let permissionResolver: PermissionResolver;

  let patients: Map<string, string>;
  let treatments: Map<string, ClinicalTreatmentRow>;
  let vaccinations: Map<string, ClinicalVaccinationRow>;
  let dewormings: Map<string, ClinicalDewormingRow>;
  let studies: Map<string, ClinicalStudyRow>;
  let weights: Map<string, ClinicalWeightRow>;
  let service: ClinicalRecordsService;

  function withContext<T>(work: () => T, tenantId = TENANT_A): T {
    return requestContext.run("req-1", () => {
      requestContext.setUserProfileId(ACTOR);
      requestContext.setTenantMembership({
        tenantId,
        membershipId: "mem-1",
        roleId: "role-1",
        roleCode: "VETERINARIAN",
      });
      return work();
    });
  }

  function makeRecordDelegate<
    TRow extends RowBase,
    TCreateData extends { tenantId: string; patientId: string },
    TUpdateData,
  >(
    map: Map<string, TRow>,
    prefix: string
  ): ClinicalRecordDelegate<TRow, TCreateData, TUpdateData> {
    return {
      findMany: ({ where, orderBy }) => {
        const rows = [...map.values()].filter(
          (row) => row.tenantId === where.tenantId && row.patientId === where.patientId
        );
        rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        if (orderBy?.createdAt === "asc") rows.reverse();
        return Promise.resolve(rows);
      },
      findFirst: ({ where }) =>
        Promise.resolve(
          [...map.values()].find(
            (row) =>
              row.id === where.id &&
              row.tenantId === where.tenantId &&
              row.patientId === where.patientId
          ) ?? null
        ),
      create: ({ data }) => {
        const now = new Date();
        const created = {
          ...data,
          id: `${prefix}-${map.size + 1}`,
          createdAt: now,
          updatedAt: now,
        } as unknown as TRow;
        map.set(created.id, created);
        return Promise.resolve(created);
      },
      updateMany: ({ where, data }) => {
        const row = [...map.values()].find(
          (candidate) =>
            candidate.id === where.id &&
            candidate.tenantId === where.tenantId &&
            candidate.patientId === where.patientId
        );
        if (!row) return Promise.resolve({ count: 0 });
        Object.assign(row, data, { updatedAt: new Date() });
        return Promise.resolve({ count: 1 });
      },
    };
  }

  function makeService(): ClinicalRecordsService {
    const tx: ClinicalRecordsTransaction = {
      clinicalTreatment: makeRecordDelegate<
        ClinicalTreatmentRow,
        TreatmentCreateData,
        TreatmentUpdateData
      >(treatments, "trt"),
      clinicalVaccination: makeRecordDelegate<
        ClinicalVaccinationRow,
        VaccinationCreateData,
        VaccinationUpdateData
      >(vaccinations, "vac"),
      clinicalDeworming: makeRecordDelegate<
        ClinicalDewormingRow,
        DewormingCreateData,
        DewormingUpdateData
      >(dewormings, "dew"),
      clinicalStudy: makeRecordDelegate<ClinicalStudyRow, StudyCreateData, StudyUpdateData>(
        studies,
        "std"
      ),
      clinicalWeight: makeRecordDelegate<ClinicalWeightRow, WeightCreateData, WeightUpdateData>(
        weights,
        "wgt"
      ),
      auditLog: { create: vi.fn().mockResolvedValue({ id: "audit-1" }) },
    };

    const prisma: ClinicalRecordsPrisma = {
      $transaction: async <T>(
        work: (scope: ClinicalRecordsTransaction) => Promise<T>
      ): Promise<T> => {
        const snapshots = [
          new Map(treatments),
          new Map(vaccinations),
          new Map(dewormings),
          new Map(studies),
          new Map(weights),
        ] as const;
        try {
          return await work(tx);
        } catch (error) {
          restore(treatments, snapshots[0]);
          restore(vaccinations, snapshots[1]);
          restore(dewormings, snapshots[2]);
          restore(studies, snapshots[3]);
          restore(weights, snapshots[4]);
          throw error;
        }
      },
      patient: {
        findFirst: ({ where }) =>
          Promise.resolve(patients.get(where.id) === where.tenantId ? { id: where.id } : null),
      },
      clinicalTreatment: tx.clinicalTreatment,
      clinicalVaccination: tx.clinicalVaccination,
      clinicalDeworming: tx.clinicalDeworming,
      clinicalStudy: tx.clinicalStudy,
      clinicalWeight: tx.clinicalWeight,
    };

    return new ClinicalRecordsService(
      prisma,
      requestContext,
      entitlements,
      permissionResolver,
      audit
    );
  }

  function restore<TRow extends RowBase>(
    target: Map<string, TRow>,
    source: Map<string, TRow>
  ): void {
    target.clear();
    for (const [key, row] of source) target.set(key, { ...row });
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
    resolveMock = vi.fn().mockResolvedValue(new Set(ALL_CLINICAL_PERMISSIONS));
    permissionResolver = { resolveForActiveRequest: resolveMock } as unknown as PermissionResolver;

    patients = new Map([[PATIENT_A, TENANT_A]]);
    treatments = new Map();
    vaccinations = new Map();
    dewormings = new Map();
    studies = new Map();
    weights = new Map();
    service = makeService();
  });

  // -------------------------------------------------------------------------
  // Subdomain records
  // -------------------------------------------------------------------------

  it("records a vaccination tenant-scoped and audits exactly once", async () => {
    const created = await withContext(() =>
      service.createVaccination(PATIENT_A, {
        vaccine: "Rabies",
        administeredAt: "2026-02-01T00:00:00.000Z",
      })
    );

    expect(created).toMatchObject({ vaccine: "Rabies", patientId: PATIENT_A, tenantId: TENANT_A });
    expect(appendMock).toHaveBeenCalledTimes(1);
    expect(appendMock.mock.calls[0][0].action).toBe("clinical_vaccination.created");

    const list = await withContext(() => service.listVaccinations(PATIENT_A));
    expect(list).toHaveLength(1);
  });

  it("records a deworming and lists it tenant-scoped", async () => {
    const created = await withContext(() =>
      service.createDeworming(PATIENT_A, {
        product: "Praziquantel",
        administeredAt: "2026-02-01T00:00:00.000Z",
      })
    );

    expect(created).toMatchObject({
      product: "Praziquantel",
      patientId: PATIENT_A,
      tenantId: TENANT_A,
    });
    expect(appendMock).toHaveBeenCalledTimes(1);
    expect(appendMock.mock.calls[0][0].action).toBe("clinical_deworming.created");

    const list = await withContext(() => service.listDewormings(PATIENT_A));
    expect(list).toHaveLength(1);
  });

  it("updates a treatment in place and audits once", async () => {
    const created = await withContext(() =>
      service.createTreatment(PATIENT_A, {
        description: "Antibiotic",
        administeredAt: "2026-02-01T00:00:00.000Z",
      })
    );
    appendMock.mockClear();

    const updated = await withContext(() =>
      service.updateTreatment(PATIENT_A, created.id, { description: "Antibiotic (adjusted)" })
    );

    expect(updated.description).toBe("Antibiotic (adjusted)");
    expect(appendMock).toHaveBeenCalledTimes(1);
    expect(appendMock.mock.calls[0][0]).toMatchObject({
      action: "clinical_treatment.updated",
      metadata: { changedFields: ["description"] },
    });
  });

  it("records and updates a study with its performed date and result", async () => {
    const created = await withContext(() =>
      service.createStudy(PATIENT_A, {
        studyType: "Blood panel",
        performedAt: "2026-02-02T00:00:00.000Z",
        result: "Within range",
      })
    );
    expect(created).toMatchObject({
      studyType: "Blood panel",
      result: "Within range",
      patientId: PATIENT_A,
    });
    appendMock.mockClear();

    const updated = await withContext(() =>
      service.updateStudy(PATIENT_A, created.id, { result: "Mild anemia" })
    );
    expect(updated.result).toBe("Mild anemia");
    expect(appendMock).toHaveBeenCalledTimes(1);
    expect(appendMock.mock.calls[0][0]).toMatchObject({
      action: "clinical_study.updated",
      metadata: { changedFields: ["result"] },
    });

    const list = await withContext(() => service.listStudies(PATIENT_A));
    expect(list).toHaveLength(1);
  });

  it("records and updates a weight preserving exact decimal text", async () => {
    const created = await withContext(() =>
      service.createWeight(PATIENT_A, {
        quantity: "12.500",
        measuredAt: "2026-02-01T00:00:00.000Z",
      })
    );
    expect(created.quantity).toBe("12.500");
    appendMock.mockClear();

    const updated = await withContext(() =>
      service.updateWeight(PATIENT_A, created.id, { quantity: "13.250" })
    );
    expect(updated.quantity).toBe("13.250");
    expect(appendMock).toHaveBeenCalledTimes(1);
  });

  it("rejects a non-positive or non-numeric weight with VALIDATION_FAILED and persists nothing", async () => {
    await expect(
      withContext(() =>
        service.createWeight(PATIENT_A, { quantity: "0", measuredAt: "2026-02-01T00:00:00.000Z" })
      )
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    await expect(
      withContext(() =>
        service.createWeight(PATIENT_A, {
          quantity: "not-a-number",
          measuredAt: "2026-02-01T00:00:00.000Z",
        })
      )
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });

    expect(weights.size).toBe(0);
    expect(appendMock).not.toHaveBeenCalled();
  });

  it("rejects a cross-tenant Patient on create and list, persisting nothing", async () => {
    await expect(
      withContext(
        () =>
          service.createDeworming(PATIENT_A, {
            product: "Praziquantel",
            administeredAt: "2026-02-01T00:00:00.000Z",
          }),
        "tenant-b"
      )
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    await expect(
      withContext(() => service.listStudies(PATIENT_A), "tenant-b")
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    expect(dewormings.size).toBe(0);
    expect(studies.size).toBe(0);
    expect(appendMock).not.toHaveBeenCalled();
  });
});
