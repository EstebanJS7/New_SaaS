import { createHash, randomUUID } from "node:crypto";
import { z, type ZodType } from "zod";
import { Inject, Injectable } from "@nestjs/common";
import { Prisma, PrismaService } from "@newsaas/database";
import { DomainError } from "@newsaas/shared";
import { AuditAppendTx, AuditWriter } from "../audit/audit-writer.service.js";
import { RequestContextService } from "../context/request-context.service.js";
import { EntitlementsService } from "../entitlements/entitlements.service.js";
import { PermissionResolver } from "../rbac/permission-resolver.service.js";
import { toIso } from "./clinical.dto.js";
import type {
  ClinicalDewormingResponse,
  ClinicalStudyResponse,
  ClinicalTreatmentResponse,
  ClinicalVaccinationResponse,
  ClinicalWeightResponse,
} from "./clinical.records.dto.js";
import { CLINICAL_PERMISSIONS } from "./clinical.permissions.js";
import { ClinicalServiceBase } from "./clinical.service.base.js";
import type { ClinicalPatientDelegate } from "./clinical.service.base.js";

// ---------------------------------------------------------------------------
// Subdomain rows, inputs and data
// ---------------------------------------------------------------------------

export interface ClinicalTreatmentRow {
  id: string;
  tenantId: string;
  patientId: string;
  description: string;
  administeredAt: Date;
  context: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ClinicalVaccinationRow {
  id: string;
  tenantId: string;
  patientId: string;
  vaccine: string;
  administeredAt: Date;
  /** EPIC-18 REP-001 staff-entered booster due date (DEC-065); null = none recorded. */
  nextDueAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ClinicalDewormingRow {
  id: string;
  tenantId: string;
  patientId: string;
  product: string;
  administeredAt: Date;
  /** EPIC-18 REP-001 staff-entered next due date (DEC-065); null = none recorded. */
  nextDueAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ClinicalStudyRow {
  id: string;
  tenantId: string;
  patientId: string;
  studyType: string;
  performedAt: Date;
  result: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ClinicalWeightRow {
  id: string;
  tenantId: string;
  patientId: string;
  /** Prisma Decimal at runtime; a plain string is accepted by test fakes. */
  quantity: Prisma.Decimal | string;
  unit?: "KG" | null;
  measuredAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateTreatmentInput {
  readonly description: string;
  readonly administeredAt: string;
  readonly context?: string | null;
}

export interface UpdateTreatmentInput {
  correctionReason?: string;
  readonly expectedVersion?: number;
  readonly description?: string;
  readonly administeredAt?: string;
  readonly context?: string | null;
}

export interface CreateVaccinationInput {
  readonly vaccine: string;
  readonly administeredAt: string;
  /** Optional staff-entered due date (DEC-065); omitted records no due date. */
  readonly nextDueAt?: string;
}

export interface UpdateVaccinationInput {
  readonly vaccine?: string;
  readonly administeredAt?: string;
  /** `null` CLEARS the due date; an absent key leaves it untouched (DEC-065). */
  readonly nextDueAt?: string | null;
}

export interface CreateDewormingInput {
  readonly product: string;
  readonly administeredAt: string;
  /** Optional staff-entered due date (DEC-065); omitted records no due date. */
  readonly nextDueAt?: string;
}

export interface UpdateDewormingInput {
  readonly product?: string;
  readonly administeredAt?: string;
  /** `null` CLEARS the due date; an absent key leaves it untouched (DEC-065). */
  readonly nextDueAt?: string | null;
}

export interface CreateStudyInput {
  readonly studyType: string;
  readonly performedAt: string;
  readonly result: string;
}

export interface UpdateStudyInput {
  correctionReason?: string;
  readonly expectedVersion?: number;
  readonly studyType?: string;
  readonly performedAt?: string;
  readonly result?: string;
}

export interface CreateWeightInput {
  /** Positive exact decimal rendered as a string (never a JS float). */
  readonly quantity: string;
  readonly unit?: "KG";
  readonly measuredAt: string;
}

export interface UpdateWeightInput {
  correctionReason?: string;
  readonly expectedVersion?: number;
  readonly quantity?: string;
  readonly unit?: "KG";
  readonly measuredAt?: string;
}

export interface TreatmentCreateData {
  tenantId: string;
  patientId: string;
  description: string;
  administeredAt: Date;
  context: string | null;
}

export type TreatmentUpdateData = Partial<Omit<TreatmentCreateData, "tenantId" | "patientId">>;

export interface VaccinationCreateData {
  tenantId: string;
  patientId: string;
  vaccine: string;
  administeredAt: Date;
  /** Always written explicitly: null is the "no due date recorded" state. */
  nextDueAt: Date | null;
}

export type VaccinationUpdateData = Partial<Omit<VaccinationCreateData, "tenantId" | "patientId">>;

export interface DewormingCreateData {
  tenantId: string;
  patientId: string;
  product: string;
  administeredAt: Date;
  /** Always written explicitly: null is the "no due date recorded" state. */
  nextDueAt: Date | null;
}

export type DewormingUpdateData = Partial<Omit<DewormingCreateData, "tenantId" | "patientId">>;

export interface StudyCreateData {
  tenantId: string;
  patientId: string;
  studyType: string;
  performedAt: Date;
  result: string;
}

export type StudyUpdateData = Partial<Omit<StudyCreateData, "tenantId" | "patientId">>;

export interface WeightCreateData {
  tenantId: string;
  patientId: string;
  quantity: string;
  unit?: "KG" | null;
  measuredAt: Date;
}

export type WeightUpdateData = Partial<Omit<WeightCreateData, "tenantId" | "patientId">>;

// ---------------------------------------------------------------------------
// Structural Prisma contracts (generated client and in-memory fakes alike)
// ---------------------------------------------------------------------------

export interface ClinicalRecordCreator<TRow, TCreateData> {
  create: (args: { data: TCreateData }) => Promise<TRow>;
}

export interface ClinicalRecordUpdater<TRow, TUpdateData> {
  findFirst: (args: {
    where: { id: string; tenantId: string; patientId: string };
  }) => Promise<TRow | null>;
  updateMany: (args: {
    where: { id: string; tenantId: string; patientId: string };
    data: TUpdateData;
  }) => Promise<{ count: number }>;
}

export interface ClinicalRecordDelegate<TRow, TCreateData, TUpdateData>
  extends ClinicalRecordCreator<TRow, TCreateData>, ClinicalRecordUpdater<TRow, TUpdateData> {
  findMany: (args: {
    where: { tenantId: string; patientId: string };
    orderBy?: { createdAt?: "asc" | "desc" };
  }) => Promise<TRow[]>;
}

export type ClinicalTreatmentDelegate = ClinicalRecordDelegate<
  ClinicalTreatmentRow,
  TreatmentCreateData,
  TreatmentUpdateData
>;
export type ClinicalVaccinationDelegate = ClinicalRecordDelegate<
  ClinicalVaccinationRow,
  VaccinationCreateData,
  VaccinationUpdateData
>;
export type ClinicalDewormingDelegate = ClinicalRecordDelegate<
  ClinicalDewormingRow,
  DewormingCreateData,
  DewormingUpdateData
>;
export type ClinicalStudyDelegate = ClinicalRecordDelegate<
  ClinicalStudyRow,
  StudyCreateData,
  StudyUpdateData
>;
export type ClinicalWeightDelegate = ClinicalRecordDelegate<
  ClinicalWeightRow,
  WeightCreateData,
  WeightUpdateData
>;

/** Delegates shared by the root client and its transaction scope. */
export interface ClinicalRecordsSource {
  clinicalTreatment: ClinicalTreatmentDelegate;
  clinicalVaccination: ClinicalVaccinationDelegate;
  clinicalDeworming: ClinicalDewormingDelegate;
  clinicalStudy: ClinicalStudyDelegate;
  clinicalWeight: ClinicalWeightDelegate;
}

export interface ClinicalRecordsTransaction extends ClinicalRecordsSource {
  auditLog: AuditAppendTx["auditLog"];
  $queryRaw?: <T>(query: Prisma.Sql) => Promise<T>;
  $executeRaw?: (query: Prisma.Sql) => Promise<number>;
}

export interface ClinicalRecordsPrisma extends ClinicalRecordsSource {
  $transaction: <T>(
    work: (tx: ClinicalRecordsTransaction) => Promise<T>,
    options?: { isolationLevel: "ReadCommitted" }
  ) => Promise<T>;
  patient: ClinicalPatientDelegate;
}

// ---------------------------------------------------------------------------
// Row -> allowlisted DTO mapping
// ---------------------------------------------------------------------------

function toTreatmentResponse(row: ClinicalTreatmentRow): ClinicalTreatmentResponse {
  return {
    id: row.id,
    tenantId: row.tenantId,
    patientId: row.patientId,
    description: row.description,
    administeredAt: toIso(row.administeredAt),
    context: row.context,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
}

function toVaccinationResponse(row: ClinicalVaccinationRow): ClinicalVaccinationResponse {
  return {
    id: row.id,
    tenantId: row.tenantId,
    patientId: row.patientId,
    vaccine: row.vaccine,
    administeredAt: toIso(row.administeredAt),
    nextDueAt: row.nextDueAt === null ? null : toIso(row.nextDueAt),
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
}

function toDewormingResponse(row: ClinicalDewormingRow): ClinicalDewormingResponse {
  return {
    id: row.id,
    tenantId: row.tenantId,
    patientId: row.patientId,
    product: row.product,
    administeredAt: toIso(row.administeredAt),
    nextDueAt: row.nextDueAt === null ? null : toIso(row.nextDueAt),
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
}

function toStudyResponse(row: ClinicalStudyRow): ClinicalStudyResponse {
  return {
    id: row.id,
    tenantId: row.tenantId,
    patientId: row.patientId,
    studyType: row.studyType,
    performedAt: toIso(row.performedAt),
    result: row.result,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
}

function toWeightResponse(row: ClinicalWeightRow): ClinicalWeightResponse {
  return {
    id: row.id,
    tenantId: row.tenantId,
    patientId: row.patientId,
    quantity: typeof row.quantity === "string" ? row.quantity : row.quantity.toString(),
    measuredAt: toIso(row.measuredAt),
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
}

const receiptBase = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  patientId: z.string().uuid(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
const treatmentReceipt = receiptBase
  .extend({ description: z.string(), administeredAt: z.string(), context: z.string().nullable() })
  .strict();
const studyReceipt = receiptBase
  .extend({ studyType: z.string(), performedAt: z.string(), result: z.string() })
  .strict();
const weightReceipt = receiptBase.extend({ quantity: z.string(), measuredAt: z.string() }).strict();

/** UUID only: never put clinical text in an idempotency key. */
export function clinicalCreationKey(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  const parsed = z.string().uuid().safeParse(value);
  if (!parsed.success) throw new DomainError("VALIDATION_FAILED", "Invalid clinical creation key.");
  return parsed.data.toLowerCase();
}

/** Weight quantity is a positive, finite decimal; anything else is rejected. */
function assertPositiveQuantity(quantity: string): void {
  if (
    !/^\d{1,7}(\.\d{1,3})?$/.test(quantity) ||
    new Prisma.Decimal(quantity).lessThanOrEqualTo(0)
  ) {
    throw new DomainError(
      "VALIDATION_FAILED",
      "Weight quantity must be a positive exact decimal of scale at most three."
    );
  }
}
function assertWeightUnit(unit: unknown): void {
  if (unit !== undefined && unit !== "KG")
    throw new DomainError("VALIDATION_FAILED", "Unsupported weight unit.");
}

/**
 * Clinical specialized-records application boundary (EPIC-06, WU2B).
 *
 * Owns the five patient-anchored record kinds — treatments, vaccinations,
 * deworming, studies and weights — as explicit create/list/update operations.
 * Records are never hard-deleted; specialized corrections update the row with audit. Tenant,
 * entitlement, permission and co-committed audit behavior live in
 * {@link ClinicalServiceBase}. Encounter lifecycle is WU2A (`ClinicalService`).
 */
@Injectable()
export class ClinicalRecordsService extends ClinicalServiceBase<ClinicalRecordsPrisma> {
  constructor(
    @Inject(PrismaService) prisma: ClinicalRecordsPrisma,
    requestContext: RequestContextService,
    entitlements: EntitlementsService,
    permissionResolver: PermissionResolver,
    audit: AuditWriter
  ) {
    super(prisma, requestContext, entitlements, permissionResolver, audit);
  }

  // -------------------------------------------------------------------------
  // Treatment records
  // -------------------------------------------------------------------------

  async listTreatments(patientId: string): Promise<ClinicalTreatmentResponse[]> {
    const tenantId = await this.requireTenantContext();
    await this.requirePermission(CLINICAL_PERMISSIONS.read);
    await this.assertPatient(tenantId, patientId);
    const rows = await this.prisma.clinicalTreatment.findMany({
      where: { tenantId, patientId },
      orderBy: { createdAt: "desc" },
    });
    return rows.map(toTreatmentResponse);
  }

  async createTreatment(
    patientId: string,
    input: CreateTreatmentInput,
    idempotencyKey?: string
  ): Promise<ClinicalTreatmentResponse> {
    const tenantId = await this.requireTenantContext();
    await this.requirePermission(CLINICAL_PERMISSIONS.create);
    const actorUserProfileId = this.requestContext.requireUserProfileId();
    await this.assertPatient(tenantId, patientId);

    return this.createOnce(
      tenantId,
      patientId,
      "treatment",
      idempotencyKey,
      {
        description: input.description,
        administeredAt: new Date(input.administeredAt).toISOString(),
        context: input.context ?? null,
      },
      treatmentReceipt,
      async (tx) => {
        const row = await this.createRecord(
          tenantId,
          actorUserProfileId,
          (source) => source.clinicalTreatment,
          {
            tenantId,
            patientId,
            description: input.description,
            administeredAt: new Date(input.administeredAt),
            context: input.context ?? null,
          },
          {
            action: "clinical_treatment.created",
            targetType: "clinical_treatment",
            changedFields: ["description", "administeredAt", "context"],
          },
          tx
        );
        return toTreatmentResponse(row);
      }
    );
  }

  async updateTreatment(
    patientId: string,
    id: string,
    input: UpdateTreatmentInput
  ): Promise<ClinicalTreatmentResponse> {
    const tenantId = await this.requireTenantContext();
    await this.requirePermission(CLINICAL_PERMISSIONS.update);
    const actorUserProfileId = this.requestContext.requireUserProfileId();

    const data: TreatmentUpdateData = {};
    const changedFields: string[] = [];
    if (input.description !== undefined) {
      data.description = input.description;
      changedFields.push("description");
    }
    if (input.administeredAt !== undefined) {
      data.administeredAt = new Date(input.administeredAt);
      changedFields.push("administeredAt");
    }
    if (input.context !== undefined) {
      data.context = input.context;
      changedFields.push("context");
    }

    const row = await this.updateRecord(
      tenantId,
      patientId,
      id,
      actorUserProfileId,
      (source) => source.clinicalTreatment,
      data,
      changedFields,
      { action: "clinical_treatment.updated", targetType: "clinical_treatment" },
      input.expectedVersion === undefined
        ? undefined
        : { table: "clinical_treatment", version: input.expectedVersion },
      input.correctionReason
    );
    return toTreatmentResponse(row);
  }

  // -------------------------------------------------------------------------
  // Vaccination records
  // -------------------------------------------------------------------------

  async listVaccinations(patientId: string): Promise<ClinicalVaccinationResponse[]> {
    const tenantId = await this.requireTenantContext();
    await this.requirePermission(CLINICAL_PERMISSIONS.read);
    await this.assertPatient(tenantId, patientId);
    const rows = await this.prisma.clinicalVaccination.findMany({
      where: { tenantId, patientId },
      orderBy: { createdAt: "desc" },
    });
    return rows.map(toVaccinationResponse);
  }

  async createVaccination(
    patientId: string,
    input: CreateVaccinationInput
  ): Promise<ClinicalVaccinationResponse> {
    const tenantId = await this.requireTenantContext();
    await this.requirePermission(CLINICAL_PERMISSIONS.create);
    const actorUserProfileId = this.requestContext.requireUserProfileId();
    await this.assertPatient(tenantId, patientId);

    const row = await this.createRecord(
      tenantId,
      actorUserProfileId,
      (source) => source.clinicalVaccination,
      {
        tenantId,
        patientId,
        vaccine: input.vaccine,
        administeredAt: new Date(input.administeredAt),
        // Always written: an omitted due date stores null, never a guessed one.
        nextDueAt: input.nextDueAt === undefined ? null : new Date(input.nextDueAt),
      },
      {
        action: "clinical_vaccination.created",
        targetType: "clinical_vaccination",
        changedFields: ["vaccine", "administeredAt", "nextDueAt"],
      }
    );
    return toVaccinationResponse(row);
  }

  async updateVaccination(
    patientId: string,
    id: string,
    input: UpdateVaccinationInput
  ): Promise<ClinicalVaccinationResponse> {
    const tenantId = await this.requireTenantContext();
    await this.requirePermission(CLINICAL_PERMISSIONS.update);
    const actorUserProfileId = this.requestContext.requireUserProfileId();

    const data: VaccinationUpdateData = {};
    const changedFields: string[] = [];
    if (input.vaccine !== undefined) {
      data.vaccine = input.vaccine;
      changedFields.push("vaccine");
    }
    if (input.administeredAt !== undefined) {
      data.administeredAt = new Date(input.administeredAt);
      changedFields.push("administeredAt");
    }
    if (input.nextDueAt !== undefined) {
      // `null` is an explicit CLEAR of a wrong due date, not an absent key
      // (DEC-065): a veterinarian who typed the wrong year must be able to take
      // it off, not only replace it.
      data.nextDueAt = input.nextDueAt === null ? null : new Date(input.nextDueAt);
      changedFields.push("nextDueAt");
    }

    const row = await this.updateRecord(
      tenantId,
      patientId,
      id,
      actorUserProfileId,
      (source) => source.clinicalVaccination,
      data,
      changedFields,
      { action: "clinical_vaccination.updated", targetType: "clinical_vaccination" }
    );
    return toVaccinationResponse(row);
  }

  // -------------------------------------------------------------------------
  // Deworming records
  // -------------------------------------------------------------------------

  async listDewormings(patientId: string): Promise<ClinicalDewormingResponse[]> {
    const tenantId = await this.requireTenantContext();
    await this.requirePermission(CLINICAL_PERMISSIONS.read);
    await this.assertPatient(tenantId, patientId);
    const rows = await this.prisma.clinicalDeworming.findMany({
      where: { tenantId, patientId },
      orderBy: { createdAt: "desc" },
    });
    return rows.map(toDewormingResponse);
  }

  async createDeworming(
    patientId: string,
    input: CreateDewormingInput
  ): Promise<ClinicalDewormingResponse> {
    const tenantId = await this.requireTenantContext();
    await this.requirePermission(CLINICAL_PERMISSIONS.create);
    const actorUserProfileId = this.requestContext.requireUserProfileId();
    await this.assertPatient(tenantId, patientId);

    const row = await this.createRecord(
      tenantId,
      actorUserProfileId,
      (source) => source.clinicalDeworming,
      {
        tenantId,
        patientId,
        product: input.product,
        administeredAt: new Date(input.administeredAt),
        // Always written: an omitted due date stores null, never a guessed one.
        nextDueAt: input.nextDueAt === undefined ? null : new Date(input.nextDueAt),
      },
      {
        action: "clinical_deworming.created",
        targetType: "clinical_deworming",
        changedFields: ["product", "administeredAt", "nextDueAt"],
      }
    );
    return toDewormingResponse(row);
  }

  async updateDeworming(
    patientId: string,
    id: string,
    input: UpdateDewormingInput
  ): Promise<ClinicalDewormingResponse> {
    const tenantId = await this.requireTenantContext();
    await this.requirePermission(CLINICAL_PERMISSIONS.update);
    const actorUserProfileId = this.requestContext.requireUserProfileId();

    const data: DewormingUpdateData = {};
    const changedFields: string[] = [];
    if (input.product !== undefined) {
      data.product = input.product;
      changedFields.push("product");
    }
    if (input.administeredAt !== undefined) {
      data.administeredAt = new Date(input.administeredAt);
      changedFields.push("administeredAt");
    }
    if (input.nextDueAt !== undefined) {
      // `null` is an explicit CLEAR of a wrong due date (DEC-065).
      data.nextDueAt = input.nextDueAt === null ? null : new Date(input.nextDueAt);
      changedFields.push("nextDueAt");
    }

    const row = await this.updateRecord(
      tenantId,
      patientId,
      id,
      actorUserProfileId,
      (source) => source.clinicalDeworming,
      data,
      changedFields,
      { action: "clinical_deworming.updated", targetType: "clinical_deworming" }
    );
    return toDewormingResponse(row);
  }

  // -------------------------------------------------------------------------
  // Study records
  // -------------------------------------------------------------------------

  async listStudies(patientId: string): Promise<ClinicalStudyResponse[]> {
    const tenantId = await this.requireTenantContext();
    await this.requirePermission(CLINICAL_PERMISSIONS.read);
    await this.assertPatient(tenantId, patientId);
    const rows = await this.prisma.clinicalStudy.findMany({
      where: { tenantId, patientId },
      orderBy: { createdAt: "desc" },
    });
    return rows.map(toStudyResponse);
  }

  async createStudy(
    patientId: string,
    input: CreateStudyInput,
    idempotencyKey?: string
  ): Promise<ClinicalStudyResponse> {
    const tenantId = await this.requireTenantContext();
    await this.requirePermission(CLINICAL_PERMISSIONS.create);
    const actorUserProfileId = this.requestContext.requireUserProfileId();
    await this.assertPatient(tenantId, patientId);

    return this.createOnce(
      tenantId,
      patientId,
      "study",
      idempotencyKey,
      {
        studyType: input.studyType,
        performedAt: new Date(input.performedAt).toISOString(),
        result: input.result,
      },
      studyReceipt,
      async (tx) => {
        const row = await this.createRecord(
          tenantId,
          actorUserProfileId,
          (source) => source.clinicalStudy,
          {
            tenantId,
            patientId,
            studyType: input.studyType,
            performedAt: new Date(input.performedAt),
            result: input.result,
          },
          {
            action: "clinical_study.created",
            targetType: "clinical_study",
            changedFields: ["studyType", "performedAt", "result"],
          },
          tx
        );
        return toStudyResponse(row);
      }
    );
  }

  async updateStudy(
    patientId: string,
    id: string,
    input: UpdateStudyInput
  ): Promise<ClinicalStudyResponse> {
    const tenantId = await this.requireTenantContext();
    await this.requirePermission(CLINICAL_PERMISSIONS.update);
    const actorUserProfileId = this.requestContext.requireUserProfileId();

    const data: StudyUpdateData = {};
    const changedFields: string[] = [];
    if (input.studyType !== undefined) {
      data.studyType = input.studyType;
      changedFields.push("studyType");
    }
    if (input.performedAt !== undefined) {
      data.performedAt = new Date(input.performedAt);
      changedFields.push("performedAt");
    }
    if (input.result !== undefined) {
      data.result = input.result;
      changedFields.push("result");
    }

    const row = await this.updateRecord(
      tenantId,
      patientId,
      id,
      actorUserProfileId,
      (source) => source.clinicalStudy,
      data,
      changedFields,
      { action: "clinical_study.updated", targetType: "clinical_study" },
      input.expectedVersion === undefined
        ? undefined
        : { table: "clinical_study", version: input.expectedVersion },
      input.correctionReason
    );
    return toStudyResponse(row);
  }

  // -------------------------------------------------------------------------
  // Weight records
  // -------------------------------------------------------------------------

  async listWeights(patientId: string): Promise<ClinicalWeightResponse[]> {
    const tenantId = await this.requireTenantContext();
    await this.requirePermission(CLINICAL_PERMISSIONS.read);
    await this.assertPatient(tenantId, patientId);
    const rows = await this.prisma.clinicalWeight.findMany({
      where: { tenantId, patientId },
      orderBy: { createdAt: "desc" },
    });
    return rows.map(toWeightResponse);
  }

  async createWeight(
    patientId: string,
    input: CreateWeightInput,
    idempotencyKey?: string
  ): Promise<ClinicalWeightResponse> {
    const tenantId = await this.requireTenantContext();
    await this.requirePermission(CLINICAL_PERMISSIONS.create);
    const actorUserProfileId = this.requestContext.requireUserProfileId();
    assertPositiveQuantity(input.quantity);
    assertWeightUnit(input.unit);
    await this.assertPatient(tenantId, patientId);

    return this.createOnce(
      tenantId,
      patientId,
      "weight",
      idempotencyKey,
      {
        quantity: new Prisma.Decimal(input.quantity).toString(),
        measuredAt: new Date(input.measuredAt).toISOString(),
        unit: input.unit ?? null,
      },
      weightReceipt,
      async (tx) => {
        const row = await this.createRecord(
          tenantId,
          actorUserProfileId,
          (source) => source.clinicalWeight,
          {
            tenantId,
            patientId,
            quantity: input.quantity,
            unit: input.unit ?? null,
            measuredAt: new Date(input.measuredAt),
          },
          {
            action: "clinical_weight.created",
            targetType: "clinical_weight",
            changedFields: [
              "quantity",
              "measuredAt",
              ...(input.unit !== undefined ? ["unit"] : []),
            ],
          },
          tx
        );
        return toWeightResponse(row);
      }
    );
  }

  async updateWeight(
    patientId: string,
    id: string,
    input: UpdateWeightInput
  ): Promise<ClinicalWeightResponse> {
    const tenantId = await this.requireTenantContext();
    await this.requirePermission(CLINICAL_PERMISSIONS.update);
    const actorUserProfileId = this.requestContext.requireUserProfileId();

    const data: WeightUpdateData = {};
    assertWeightUnit(input.unit);
    const changedFields: string[] = [];
    if (input.quantity !== undefined) {
      assertPositiveQuantity(input.quantity);
      data.quantity = input.quantity;
      // A new quantity without an explicit unit must never inherit an assumed KG.
      data.unit = input.unit ?? null;
      changedFields.push("quantity", "unit");
    }
    if (input.unit !== undefined && input.quantity === undefined) {
      data.unit = input.unit;
      changedFields.push("unit");
    }
    if (input.measuredAt !== undefined) {
      data.measuredAt = new Date(input.measuredAt);
      changedFields.push("measuredAt");
    }

    const row = await this.updateRecord(
      tenantId,
      patientId,
      id,
      actorUserProfileId,
      (source) => source.clinicalWeight,
      data,
      changedFields,
      { action: "clinical_weight.updated", targetType: "clinical_weight" },
      input.expectedVersion === undefined
        ? undefined
        : { table: "clinical_weight", version: input.expectedVersion },
      input.correctionReason
    );
    return toWeightResponse(row);
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  /** Scope is tenant/patient/kind/key. Lock, record, audit and receipt share one commit.
   * No TTL/purge: the ten-minute UI copy lifetime does not limit backend deduplication.
   * Replays use the original allowlisted DTO, even if a later PUT changed the row. */
  private async createOnce<T>(
    tenantId: string,
    patientId: string,
    kind: string,
    key: string | undefined,
    input: unknown,
    schema: ZodType<T>,
    work: (tx?: ClinicalRecordsTransaction) => Promise<T>
  ): Promise<T> {
    key = clinicalCreationKey(key);
    if (key === undefined) return work();
    const requestHash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
    const scope = JSON.stringify([tenantId, patientId, kind, key]);
    return this.prisma.$transaction(
      async (tx) => {
        if (!tx.$queryRaw || !tx.$executeRaw)
          throw new Error("Clinical creation requires transactional SQL.");
        // A hash collision only serializes unrelated requests; uniqueness uses the full scope.
        await tx.$queryRaw(
          Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${scope}, 0))::text`
        );
        const receipts = await tx.$queryRaw<
          { request_hash: string; response: unknown }[]
        >(Prisma.sql`
        SELECT request_hash, response FROM clinical_creation_receipt
        WHERE tenant_id = ${tenantId}::uuid AND patient_id = ${patientId}::uuid
          AND kind = ${kind} AND key = ${key}::uuid`);
        const receipt = receipts[0];
        if (receipt) {
          if (receipt.request_hash !== requestHash)
            throw new DomainError(
              "CONFLICT",
              "Clinical creation key was already used for different content."
            );
          return schema.parse(receipt.response);
        }
        const response = schema.parse(await work(tx));
        await tx.$executeRaw(Prisma.sql`INSERT INTO clinical_creation_receipt
        (tenant_id, patient_id, kind, key, request_hash, response)
        VALUES (${tenantId}::uuid, ${patientId}::uuid, ${kind}, ${key}::uuid, ${requestHash}, ${JSON.stringify(response)}::jsonb)`);
        return response;
      },
      { isolationLevel: "ReadCommitted" }
    );
  }

  private async createRecord<TRow extends { id: string }, TCreateData>(
    tenantId: string,
    actorUserProfileId: string,
    select: (source: ClinicalRecordsSource) => ClinicalRecordCreator<TRow, TCreateData>,
    data: TCreateData,
    audit: { action: string; targetType: string; changedFields: string[] },
    transaction?: ClinicalRecordsTransaction
  ): Promise<TRow> {
    const work = async (tx: ClinicalRecordsTransaction) => {
      const created = await select(tx).create({ data });
      await this.appendAudit(tx, { ...audit, targetId: created.id }, tenantId, actorUserProfileId);
      return created;
    };
    return transaction ? work(transaction) : this.prisma.$transaction(work);
  }

  private async updateRecord<TRow, TUpdateData extends object>(
    tenantId: string,
    patientId: string,
    id: string,
    actorUserProfileId: string,
    select: (source: ClinicalRecordsSource) => ClinicalRecordUpdater<TRow, TUpdateData>,
    data: TUpdateData,
    changedFields: string[],
    audit: { action: string; targetType: string },
    expected?: {
      table: "clinical_treatment" | "clinical_study" | "clinical_weight";
      version: number;
    },
    correctionReason?: string
  ): Promise<TRow> {
    if (
      expected &&
      (!Number.isInteger(expected.version) || expected.version < 1 || expected.version > 2147483647)
    )
      throw new DomainError("VALIDATION_FAILED", "Invalid expected clinical version.");
    if (
      correctionReason !== undefined &&
      (typeof correctionReason !== "string" ||
        correctionReason.length > 2000 ||
        correctionReason.trim().length === 0)
    )
      throw new DomainError("VALIDATION_FAILED", "Invalid correction reason.");
    return this.prisma.$transaction(
      async (tx) => {
        if (expected) {
          if (!tx.$queryRaw) throw new Error("Clinical concurrency requires transactional SQL.");
          // Closed table union is server-owned; no identifier comes from input.
          const rows = await tx.$queryRaw<
            { version: number }[]
          >(Prisma.sql`SELECT version FROM ${Prisma.raw(expected.table)}
          WHERE id = ${id}::uuid AND tenant_id = ${tenantId}::uuid AND patient_id = ${patientId}::uuid FOR UPDATE`);
          if (!rows[0]) throw new DomainError("NOT_FOUND", "Clinical record was not found.");
          if (rows[0].version !== expected.version)
            throw new DomainError("CONFLICT", "Clinical record version changed.");
        }
        if (changedFields.length === 0) {
          const existing = await select(tx).findFirst({ where: { id, tenantId, patientId } });
          if (!existing) {
            throw new DomainError("NOT_FOUND", "Clinical record was not found.");
          }
          return existing;
        }
        // Specific Clinical trigger context, transaction-local: no cross-request leakage.
        const specialized = ["clinical_treatment", "clinical_study", "clinical_weight"].includes(
          audit.targetType
        );
        const revisionId = specialized ? randomUUID() : undefined;
        if (revisionId) {
          if (!tx.$queryRaw) throw new Error("Clinical history requires transactional SQL.");
          await tx.$queryRaw(Prisma.sql`SELECT
            set_config('newsaas.clinical_revision_id', ${revisionId}, true),
            set_config('newsaas.clinical_actor_id', ${actorUserProfileId}, true),
            set_config('newsaas.clinical_correction_reason', ${correctionReason ?? ""}, true)`);
        }
        const { count } = await select(tx).updateMany({ where: { id, tenantId, patientId }, data });
        if (count === 0) {
          throw new DomainError("NOT_FOUND", "Clinical record was not found.");
        }
        const updated = await select(tx).findFirst({ where: { id, tenantId, patientId } });
        if (!updated) {
          throw new DomainError("NOT_FOUND", "Clinical record was not found.");
        }
        if (revisionId) {
          if (!tx.$queryRaw) throw new Error("Clinical history requires transactional SQL.");
          // Missing migration/disabled capture must never acknowledge an unhistorized write.
          const tables: Readonly<Record<string, string>> = {
            clinical_treatment: "clinical_treatment_revision",
            clinical_study: "clinical_study_revision",
            clinical_weight: "clinical_weight_revision",
          };
          const historyTable = tables[audit.targetType];
          if (!historyTable) throw new Error("Invalid clinical history target.");
          const revisions = await tx.$queryRaw<
            { id: string }[]
          >(Prisma.sql`SELECT h.id FROM ${Prisma.raw(historyTable)} h
            JOIN ${Prisma.raw(audit.targetType)} r ON r.id=h.record_id AND r.tenant_id=h.tenant_id AND r.patient_id=h.patient_id
            WHERE h.id=${revisionId}::uuid AND h.tenant_id=${tenantId}::uuid AND h.patient_id=${patientId}::uuid AND h.record_id=${id}::uuid AND h.after_version=r.version`);
          if (!revisions[0]) throw new Error("Clinical history capture is required.");
        }
        await this.appendAudit(
          tx,
          {
            ...audit,
            targetId: id,
            changedFields,
            ...(revisionId && { metadata: { revisionId } }),
          },
          tenantId,
          actorUserProfileId
        );
        return updated;
      },
      { isolationLevel: "ReadCommitted" }
    );
  }
}
