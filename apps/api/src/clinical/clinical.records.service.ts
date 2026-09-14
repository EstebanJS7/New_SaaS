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
  createdAt: Date;
  updatedAt: Date;
}

export interface ClinicalDewormingRow {
  id: string;
  tenantId: string;
  patientId: string;
  product: string;
  administeredAt: Date;
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
  readonly description?: string;
  readonly administeredAt?: string;
  readonly context?: string | null;
}

export interface CreateVaccinationInput {
  readonly vaccine: string;
  readonly administeredAt: string;
}

export interface UpdateVaccinationInput {
  readonly vaccine?: string;
  readonly administeredAt?: string;
}

export interface CreateDewormingInput {
  readonly product: string;
  readonly administeredAt: string;
}

export interface UpdateDewormingInput {
  readonly product?: string;
  readonly administeredAt?: string;
}

export interface CreateStudyInput {
  readonly studyType: string;
  readonly performedAt: string;
  readonly result: string;
}

export interface UpdateStudyInput {
  readonly studyType?: string;
  readonly performedAt?: string;
  readonly result?: string;
}

export interface CreateWeightInput {
  /** Positive exact decimal rendered as a string (never a JS float). */
  readonly quantity: string;
  readonly measuredAt: string;
}

export interface UpdateWeightInput {
  readonly quantity?: string;
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
}

export type VaccinationUpdateData = Partial<Omit<VaccinationCreateData, "tenantId" | "patientId">>;

export interface DewormingCreateData {
  tenantId: string;
  patientId: string;
  product: string;
  administeredAt: Date;
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
}

export interface ClinicalRecordsPrisma extends ClinicalRecordsSource {
  $transaction: <T>(work: (tx: ClinicalRecordsTransaction) => Promise<T>) => Promise<T>;
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

/** Weight quantity is a positive, finite decimal; anything else is rejected. */
function assertPositiveQuantity(quantity: string): void {
  const parsed = Number(quantity);
  if (quantity.trim().length === 0 || !Number.isFinite(parsed) || parsed <= 0) {
    throw new DomainError("VALIDATION_FAILED", "Weight quantity must be a positive number.");
  }
}

/**
 * Clinical specialized-records application boundary (EPIC-06, WU2B).
 *
 * Owns the five patient-anchored record kinds — treatments, vaccinations,
 * deworming, studies and weights — as explicit create/list/update operations.
 * Records are never hard-deleted; corrections are new records. Tenant,
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
    input: CreateTreatmentInput
  ): Promise<ClinicalTreatmentResponse> {
    const tenantId = await this.requireTenantContext();
    await this.requirePermission(CLINICAL_PERMISSIONS.create);
    const actorUserProfileId = this.requestContext.requireUserProfileId();
    await this.assertPatient(tenantId, patientId);

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
      }
    );
    return toTreatmentResponse(row);
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
      { action: "clinical_treatment.updated", targetType: "clinical_treatment" }
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
      },
      {
        action: "clinical_vaccination.created",
        targetType: "clinical_vaccination",
        changedFields: ["vaccine", "administeredAt"],
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
      },
      {
        action: "clinical_deworming.created",
        targetType: "clinical_deworming",
        changedFields: ["product", "administeredAt"],
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

  async createStudy(patientId: string, input: CreateStudyInput): Promise<ClinicalStudyResponse> {
    const tenantId = await this.requireTenantContext();
    await this.requirePermission(CLINICAL_PERMISSIONS.create);
    const actorUserProfileId = this.requestContext.requireUserProfileId();
    await this.assertPatient(tenantId, patientId);

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
      }
    );
    return toStudyResponse(row);
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
      { action: "clinical_study.updated", targetType: "clinical_study" }
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

  async createWeight(patientId: string, input: CreateWeightInput): Promise<ClinicalWeightResponse> {
    const tenantId = await this.requireTenantContext();
    await this.requirePermission(CLINICAL_PERMISSIONS.create);
    const actorUserProfileId = this.requestContext.requireUserProfileId();
    assertPositiveQuantity(input.quantity);
    await this.assertPatient(tenantId, patientId);

    const row = await this.createRecord(
      tenantId,
      actorUserProfileId,
      (source) => source.clinicalWeight,
      {
        tenantId,
        patientId,
        quantity: input.quantity,
        measuredAt: new Date(input.measuredAt),
      },
      {
        action: "clinical_weight.created",
        targetType: "clinical_weight",
        changedFields: ["quantity", "measuredAt"],
      }
    );
    return toWeightResponse(row);
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
    const changedFields: string[] = [];
    if (input.quantity !== undefined) {
      assertPositiveQuantity(input.quantity);
      data.quantity = input.quantity;
      changedFields.push("quantity");
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
      { action: "clinical_weight.updated", targetType: "clinical_weight" }
    );
    return toWeightResponse(row);
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  private async createRecord<TRow extends { id: string }, TCreateData>(
    tenantId: string,
    actorUserProfileId: string,
    select: (source: ClinicalRecordsSource) => ClinicalRecordCreator<TRow, TCreateData>,
    data: TCreateData,
    audit: { action: string; targetType: string; changedFields: string[] }
  ): Promise<TRow> {
    return this.prisma.$transaction(async (tx) => {
      const created = await select(tx).create({ data });
      await this.appendAudit(tx, { ...audit, targetId: created.id }, tenantId, actorUserProfileId);
      return created;
    });
  }

  private async updateRecord<TRow, TUpdateData extends object>(
    tenantId: string,
    patientId: string,
    id: string,
    actorUserProfileId: string,
    select: (source: ClinicalRecordsSource) => ClinicalRecordUpdater<TRow, TUpdateData>,
    data: TUpdateData,
    changedFields: string[],
    audit: { action: string; targetType: string }
  ): Promise<TRow> {
    return this.prisma.$transaction(async (tx) => {
      if (changedFields.length === 0) {
        const existing = await select(tx).findFirst({ where: { id, tenantId, patientId } });
        if (!existing) {
          throw new DomainError("NOT_FOUND", "Clinical record was not found.");
        }
        return existing;
      }
      const { count } = await select(tx).updateMany({ where: { id, tenantId, patientId }, data });
      if (count === 0) {
        throw new DomainError("NOT_FOUND", "Clinical record was not found.");
      }
      const updated = await select(tx).findFirst({ where: { id, tenantId, patientId } });
      if (!updated) {
        throw new DomainError("NOT_FOUND", "Clinical record was not found.");
      }
      await this.appendAudit(
        tx,
        { ...audit, targetId: id, changedFields },
        tenantId,
        actorUserProfileId
      );
      return updated;
    });
  }
}
