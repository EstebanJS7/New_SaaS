import { Inject, Injectable } from "@nestjs/common";
import { PrismaService } from "@newsaas/database";
import { DomainError } from "@newsaas/shared";
import {
  appendGuardianAudit,
  assertGlobalCatalog,
  assertTenantCustomer,
  changedPatientFields,
  createPatient,
  linkPrimaryGuardian,
  toPatientResponse,
} from "@newsaas/patients";
import type {
  GuardianAudit,
  PatientCatalog,
  PatientCreateData,
  PatientCustomerDelegate,
  PatientGuardianCreateData,
  PatientGuardianRow,
  PatientGuardianUpdateData,
  PatientGuardianWhere,
  PatientRow,
} from "@newsaas/patients";
import { AuditAppendTx, AuditWriter } from "../audit/audit-writer.service.js";
import { RequestContextService } from "../context/request-context.service.js";
import { EntitlementsService } from "../entitlements/entitlements.service.js";
import { PATIENT_DTO_SCHEMA_VERSION, PATIENT_GUARDIAN_DTO_SCHEMA_VERSION } from "./patient.zod.js";
import type {
  CreateGuardianInput,
  CreatePatientInput,
  PatientSex,
  UpdateGuardianInput,
  UpdatePatientInput,
} from "./patient.zod.js";
import type { PatientGuardianResponse, PatientResponse } from "./patient.dto.js";

// Re-exported so the API's existing importers — including the service test, which
// builds its fakes against these contracts — keep resolving them from this
// module; the definitions now live in `@newsaas/patients` ([[DEC-073]]).
// Collapsing these aliases is a separate cleanup.
export type {
  PatientCreateData,
  PatientCustomerDelegate,
  PatientGuardianCreateData,
  PatientGuardianRow,
  PatientGuardianUpdateData,
  PatientGuardianWhere,
  PatientRow,
} from "@newsaas/patients";

export interface PatientUpdateData {
  name?: string;
  speciesId?: string;
  breedId?: string | null;
  sex?: PatientSex;
  birthDate?: Date | null;
  isActive?: boolean;
}

export interface PatientDelegate {
  findMany: (args: {
    where: { tenantId: string; isActive?: boolean };
    orderBy?: { name?: "asc" | "desc" };
  }) => Promise<PatientRow[]>;
  findFirst: (args: { where: { id: string; tenantId: string } }) => Promise<PatientRow | null>;
  create: (args: { data: PatientCreateData }) => Promise<PatientRow>;
  updateMany: (args: {
    where: { id: string; tenantId: string; isActive?: boolean };
    data: PatientUpdateData;
  }) => Promise<{ count: number }>;
}

export interface PatientGuardianDelegate {
  findMany: (args: {
    where: { tenantId: string; patientId: string; isActive?: boolean };
    orderBy?: { position?: "asc" | "desc" };
  }) => Promise<PatientGuardianRow[]>;
  findFirst: (args: { where: PatientGuardianWhere }) => Promise<PatientGuardianRow | null>;
  create: (args: { data: PatientGuardianCreateData }) => Promise<PatientGuardianRow>;
  updateMany: (args: {
    where: PatientGuardianWhere;
    data: PatientGuardianUpdateData;
  }) => Promise<{ count: number }>;
}

/**
 * The GLOBAL Species/Breed delegates are the package's catalog contracts under the
 * names this read path uses. Aliasing instead of redeclaring keeps ONE definition,
 * so `assertGlobalCatalog` and this service can never drift apart.
 */
export type SpeciesDelegate = PatientCatalog["species"];
export type BreedDelegate = PatientCatalog["breed"];

export interface PatientsTransaction {
  patient: PatientDelegate;
  patientGuardian: PatientGuardianDelegate;
  species: SpeciesDelegate;
  breed: BreedDelegate;
  customer: PatientCustomerDelegate;
  auditLog: AuditAppendTx["auditLog"];
}

export interface PatientsPrisma {
  $transaction: <T>(work: (tx: PatientsTransaction) => Promise<T>) => Promise<T>;
  patient: PatientDelegate;
  patientGuardian: PatientGuardianDelegate;
  species: SpeciesDelegate;
  breed: BreedDelegate;
  customer: PatientCustomerDelegate;
}

function toGuardianResponse(row: PatientGuardianRow): PatientGuardianResponse {
  return {
    id: row.id,
    tenantId: row.tenantId,
    patientId: row.patientId,
    customerId: row.customerId,
    isPrimary: row.isPrimary,
    isActive: row.isActive,
    position: row.position,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function buildPatientUpdateData(input: UpdatePatientInput): PatientUpdateData {
  const data: PatientUpdateData = {};
  if (input.name !== undefined) data.name = input.name;
  if (input.speciesId !== undefined) data.speciesId = input.speciesId;
  if (input.breedId !== undefined) data.breedId = input.breedId;
  if (input.sex !== undefined) data.sex = input.sex;
  if (input.birthDate !== undefined) {
    data.birthDate = input.birthDate === null ? null : new Date(input.birthDate);
  }
  if (input.isActive !== undefined) data.isActive = input.isActive;
  return data;
}

/**
 * Tenant-scoped Patient and guardian application boundary (Veterinary).
 *
 * - Tenant identity comes exclusively from `RequestContextService` — never
 *   from request input; foreign UUIDs surface as byte-equivalent 404.
 * - Every operation requires the `veterinary` entitlement through
 *   `EntitlementsService`; there is no generic feature guard.
 * - `patients.*` permissions are declared on the WU3 routes; this layer owns
 *   the entitlement gate plus the transactional invariants.
 * - An active Patient and its active primary guardian are written in ONE
 *   transaction. Creation of an active Patient REQUIRES
 *   `primaryGuardianCustomerId` (Decision #2223); an inactive Patient may be
 *   created guardian-less and activated only in a transaction that establishes
 *   exactly one active primary.
 * - A primary swap DEMOTES the current primary before PROMOTING the
 *   replacement, because the `(patient_id) WHERE is_primary AND is_active`
 *   partial unique index is immediate (non-deferrable).
 * - Every mutation co-commits its audit row in the same transaction; metadata
 *   carries stable IDs and field names only (no CONFIDENTIAL values).
 */
@Injectable()
export class PatientsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PatientsPrisma,
    private readonly requestContext: RequestContextService,
    private readonly audit: AuditWriter,
    private readonly entitlements: EntitlementsService
  ) {}

  // -------------------------------------------------------------------------
  // Patient boundary
  // -------------------------------------------------------------------------

  async list(): Promise<PatientResponse[]> {
    const tenantId = await this.requireTenantContext();
    const rows = await this.prisma.patient.findMany({
      where: { tenantId, isActive: true },
      orderBy: { name: "asc" },
    });
    return rows.map(toPatientResponse);
  }

  async get(id: string): Promise<PatientResponse> {
    const tenantId = await this.requireTenantContext();
    const row = await this.findPatientOrThrow(id, tenantId);
    return toPatientResponse(row);
  }

  /**
   * Creates a Patient through `@newsaas/patients`'s create contract: the API and
   * the import worker validate and write a Patient the SAME way — same create
   * schema, same active-patient guardian requirement (Decision #2223), same
   * global-catalog check — and the patient row, its primary guardian and both
   * audit rows co-commit inside the package's single transaction ([[DEC-073]]).
   *
   * Tenant, actor and catalog are resolved HERE, from the request context and the
   * request-scoped client, and handed to the package as arguments. This method
   * NEVER forwards request input as any of them.
   */
  async create(input: CreatePatientInput): Promise<PatientResponse> {
    const tenantId = await this.requireTenantContext();
    const actorUserProfileId = this.requestContext.requireUserProfileId();

    const row = await createPatient({
      db: this.prisma,
      audit: this.audit,
      tenantId,
      actorUserProfileId,
      input,
      // The taxonomy is a parameter for the same reason the tenant is: the worker
      // has no module that owns it, so it resolves the global catalog with its own
      // client and passes the same narrow contract.
      catalog: this.prisma,
    });

    return toPatientResponse(row);
  }

  async update(id: string, input: UpdatePatientInput): Promise<PatientResponse> {
    const tenantId = await this.requireTenantContext();
    const actorUserProfileId = this.requestContext.requireUserProfileId();

    const existing = await this.findPatientOrThrow(id, tenantId);

    if (input.speciesId !== undefined || input.breedId !== undefined) {
      await assertGlobalCatalog(
        this.prisma,
        input.speciesId ?? existing.speciesId,
        input.breedId !== undefined ? input.breedId : existing.breedId
      );
    }

    const activating = input.isActive === true && existing.isActive === false;
    const patientData = buildPatientUpdateData(input);
    const hasPatientFields = Object.keys(patientData).length > 0;

    const row = await this.prisma.$transaction(async (tx) => {
      let guardianAudit: GuardianAudit | null = null;
      if (input.primaryGuardianCustomerId !== undefined) {
        guardianAudit = await linkPrimaryGuardian(
          tx,
          tenantId,
          id,
          input.primaryGuardianCustomerId
        );
      } else if (activating) {
        const current = await tx.patientGuardian.findFirst({
          where: { tenantId, patientId: id, isPrimary: true, isActive: true },
        });
        if (!current) {
          throw new DomainError(
            "CONFLICT",
            "Activating a patient requires an active primary guardian."
          );
        }
      }

      let updated = existing;
      if (hasPatientFields) {
        const { count } = await tx.patient.updateMany({
          where: { id, tenantId },
          data: patientData,
        });
        if (count === 0) {
          throw new DomainError("NOT_FOUND", "Patient was not found.");
        }
        const reloaded = await tx.patient.findFirst({ where: { id, tenantId } });
        if (!reloaded) {
          throw new DomainError("NOT_FOUND", "Patient was not found.");
        }
        updated = reloaded;
      }

      if (hasPatientFields) {
        await this.audit.append(
          {
            action: "patient.updated",
            tenantId,
            actorUserProfileId,
            targetType: "patient",
            targetId: updated.id,
            metadata: {
              schemaVersion: PATIENT_DTO_SCHEMA_VERSION,
              changedFields: changedPatientFields(input),
            },
          },
          tx
        );
      }

      await appendGuardianAudit(this.audit, tx, guardianAudit, id, tenantId, actorUserProfileId);

      return updated;
    });

    return toPatientResponse(row);
  }

  async deactivate(id: string): Promise<PatientResponse> {
    const tenantId = await this.requireTenantContext();
    const actorUserProfileId = this.requestContext.requireUserProfileId();

    const row = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.patient.updateMany({
        where: { id, tenantId, isActive: true },
        data: { isActive: false },
      });

      if (count === 0) {
        const existing = await tx.patient.findFirst({ where: { id, tenantId } });
        if (!existing) {
          throw new DomainError("NOT_FOUND", "Patient was not found.");
        }
        await this.audit.append(
          {
            action: "patient.deactivated",
            tenantId,
            actorUserProfileId,
            targetType: "patient",
            targetId: existing.id,
            metadata: { schemaVersion: PATIENT_DTO_SCHEMA_VERSION, changedFields: [] },
          },
          tx
        );
        return existing;
      }

      const updated = await tx.patient.findFirst({ where: { id, tenantId } });
      if (!updated) {
        throw new DomainError("NOT_FOUND", "Patient was not found.");
      }
      await this.audit.append(
        {
          action: "patient.deactivated",
          tenantId,
          actorUserProfileId,
          targetType: "patient",
          targetId: updated.id,
          metadata: { schemaVersion: PATIENT_DTO_SCHEMA_VERSION, changedFields: ["isActive"] },
        },
        tx
      );
      return updated;
    });

    return toPatientResponse(row);
  }

  // -------------------------------------------------------------------------
  // Guardian boundary
  // -------------------------------------------------------------------------

  async listGuardians(patientId: string): Promise<PatientGuardianResponse[]> {
    const tenantId = await this.requireTenantContext();
    await this.findPatientOrThrow(patientId, tenantId);
    const rows = await this.prisma.patientGuardian.findMany({
      where: { tenantId, patientId, isActive: true },
      orderBy: { position: "asc" },
    });
    return rows.map(toGuardianResponse);
  }

  async getGuardian(id: string, patientId: string): Promise<PatientGuardianResponse> {
    const tenantId = await this.requireTenantContext();
    const row = await this.findGuardianOrThrow(id, patientId, tenantId);
    return toGuardianResponse(row);
  }

  async createGuardian(
    patientId: string,
    input: CreateGuardianInput
  ): Promise<PatientGuardianResponse> {
    const tenantId = await this.requireTenantContext();
    const actorUserProfileId = this.requestContext.requireUserProfileId();

    const row = await this.prisma.$transaction(async (tx) => {
      await this.findPatientOrThrowTx(tx, patientId, tenantId);
      await assertTenantCustomer(tx, input.customerId, tenantId);

      const existing = await tx.patientGuardian.findFirst({
        where: { tenantId, patientId, customerId: input.customerId },
      });
      if (existing) {
        throw new DomainError("CONFLICT", "Customer is already a guardian of this patient.");
      }

      let created: PatientGuardianRow;
      let guardianAudit: GuardianAudit;
      if (input.isPrimary === true) {
        await this.demoteActivePrimary(tx, tenantId, patientId);
        created = await tx.patientGuardian.create({
          data: {
            tenantId,
            patientId,
            customerId: input.customerId,
            isPrimary: true,
            isActive: true,
            position: input.position ?? 0,
          },
        });
        guardianAudit = {
          action: "patient_guardian.created",
          targetId: created.id,
          changedFields: ["customerId", "isPrimary"],
        };
      } else {
        created = await tx.patientGuardian.create({
          data: {
            tenantId,
            patientId,
            customerId: input.customerId,
            isPrimary: false,
            isActive: true,
            position: input.position ?? 0,
          },
        });
        guardianAudit = {
          action: "patient_guardian.created",
          targetId: created.id,
          changedFields: ["customerId"],
        };
      }

      await appendGuardianAudit(
        this.audit,
        tx,
        guardianAudit,
        patientId,
        tenantId,
        actorUserProfileId
      );
      return created;
    });

    return toGuardianResponse(row);
  }

  async updateGuardian(
    id: string,
    patientId: string,
    input: UpdateGuardianInput
  ): Promise<PatientGuardianResponse> {
    const tenantId = await this.requireTenantContext();
    const actorUserProfileId = this.requestContext.requireUserProfileId();

    const row = await this.prisma.$transaction(async (tx) => {
      const guardian = await this.findGuardianOrThrowTx(tx, id, patientId, tenantId);
      const patient = await this.findPatientOrThrowTx(tx, patientId, tenantId);

      // Build exactly the field set this mutation writes so the audit row can
      // never claim a change the update did not actually apply (a demotion that
      // also supplies `position` must persist BOTH fields).
      let action = "patient_guardian.updated";
      const data: PatientGuardianUpdateData = {};

      if (input.isPrimary === true) {
        await this.demoteActivePrimary(tx, tenantId, patientId, id);
        data.isPrimary = true;
        data.isActive = true;
        action = "patient_guardian.primary_changed";
      } else if (input.isPrimary === false) {
        if (guardian.isPrimary && guardian.isActive && patient.isActive) {
          throw new DomainError(
            "CONFLICT",
            "Cannot remove the primary guardian while the patient is active."
          );
        }
        data.isPrimary = false;
        action = "patient_guardian.primary_changed";
      }

      if (input.position !== undefined) {
        data.position = input.position;
      }

      if (Object.keys(data).length > 0) {
        await tx.patientGuardian.updateMany({ where: { id, tenantId, patientId }, data });
      }

      const updated = await tx.patientGuardian.findFirst({ where: { id, tenantId, patientId } });
      if (!updated) {
        throw new DomainError("NOT_FOUND", "Patient guardian was not found.");
      }

      await this.audit.append(
        {
          action,
          tenantId,
          actorUserProfileId,
          targetType: "patient_guardian",
          targetId: updated.id,
          metadata: {
            schemaVersion: PATIENT_GUARDIAN_DTO_SCHEMA_VERSION,
            changedFields: Object.keys(input).filter((field) => field in data),
            patientId,
          },
        },
        tx
      );

      return updated;
    });

    return toGuardianResponse(row);
  }

  async setPrimaryGuardian(id: string, patientId: string): Promise<PatientGuardianResponse> {
    const tenantId = await this.requireTenantContext();
    const actorUserProfileId = this.requestContext.requireUserProfileId();

    const row = await this.prisma.$transaction(async (tx) => {
      await this.findPatientOrThrowTx(tx, patientId, tenantId);
      const guardian = await this.findGuardianOrThrowTx(tx, id, patientId, tenantId);

      if (guardian.isPrimary && guardian.isActive) {
        return guardian;
      }

      await this.demoteActivePrimary(tx, tenantId, patientId, id);
      await tx.patientGuardian.updateMany({
        where: { id, tenantId, patientId },
        data: { isPrimary: true, isActive: true },
      });

      const updated = await tx.patientGuardian.findFirst({ where: { id, tenantId, patientId } });
      if (!updated) {
        throw new DomainError("NOT_FOUND", "Patient guardian was not found.");
      }

      await this.audit.append(
        {
          action: "patient_guardian.primary_changed",
          tenantId,
          actorUserProfileId,
          targetType: "patient_guardian",
          targetId: updated.id,
          metadata: {
            schemaVersion: PATIENT_GUARDIAN_DTO_SCHEMA_VERSION,
            changedFields: ["isPrimary", "isActive"],
            patientId,
          },
        },
        tx
      );

      return updated;
    });

    return toGuardianResponse(row);
  }

  async deactivateGuardian(id: string, patientId: string): Promise<PatientGuardianResponse> {
    const tenantId = await this.requireTenantContext();
    const actorUserProfileId = this.requestContext.requireUserProfileId();

    const row = await this.prisma.$transaction(async (tx) => {
      const guardian = await this.findGuardianOrThrowTx(tx, id, patientId, tenantId);

      if (!guardian.isActive) {
        await this.audit.append(
          {
            action: "patient_guardian.deactivated",
            tenantId,
            actorUserProfileId,
            targetType: "patient_guardian",
            targetId: guardian.id,
            metadata: {
              schemaVersion: PATIENT_GUARDIAN_DTO_SCHEMA_VERSION,
              changedFields: [],
              patientId,
            },
          },
          tx
        );
        return guardian;
      }

      if (guardian.isPrimary) {
        const patient = await this.findPatientOrThrowTx(tx, patientId, tenantId);
        if (patient.isActive) {
          throw new DomainError(
            "CONFLICT",
            "Cannot deactivate the primary guardian of an active patient."
          );
        }
      }

      await tx.patientGuardian.updateMany({
        where: { id, tenantId, patientId },
        data: { isActive: false },
      });

      const updated = await tx.patientGuardian.findFirst({ where: { id, tenantId, patientId } });
      if (!updated) {
        throw new DomainError("NOT_FOUND", "Patient guardian was not found.");
      }

      await this.audit.append(
        {
          action: "patient_guardian.deactivated",
          tenantId,
          actorUserProfileId,
          targetType: "patient_guardian",
          targetId: updated.id,
          metadata: {
            schemaVersion: PATIENT_GUARDIAN_DTO_SCHEMA_VERSION,
            changedFields: ["isActive"],
            patientId,
          },
        },
        tx
      );

      return updated;
    });

    return toGuardianResponse(row);
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  /**
   * Resolves tenant context and gates every operation behind the `veterinary`
   * entitlement. `FEATURE_NOT_ENTITLED` (403) is the only rejection path; no
   * generic feature guard is introduced.
   */
  private async requireTenantContext(): Promise<string> {
    const tenantId = this.requestContext.requireTenantId();
    if (!(await this.entitlements.has(tenantId, "veterinary"))) {
      throw new DomainError(
        "FEATURE_NOT_ENTITLED",
        "Veterinary features are not enabled for this tenant."
      );
    }
    return tenantId;
  }

  /*
   * `assertGlobalCatalog`, `assertTenantCustomer`, `linkPrimaryGuardian` and
   * `appendGuardianAudit` moved to `@newsaas/patients` ([[DEC-073]]): they are the
   * rules the create contract shares with this class, so they have ONE home — the
   * package — and this class calls them with its own transaction and request
   * context. A second copy here is exactly what the Story forbids.
   */

  /** Demotes the active primary guardian unless it is the `exceptId` link. */
  private async demoteActivePrimary(
    tx: PatientsTransaction,
    tenantId: string,
    patientId: string,
    exceptId?: string
  ): Promise<void> {
    const current = await tx.patientGuardian.findFirst({
      where: { tenantId, patientId, isPrimary: true, isActive: true },
    });
    if (!current || (exceptId !== undefined && current.id === exceptId)) {
      return;
    }
    await tx.patientGuardian.updateMany({
      where: { id: current.id, tenantId, patientId },
      data: { isPrimary: false },
    });
  }

  private async findPatientOrThrow(id: string, tenantId: string): Promise<PatientRow> {
    const row = await this.prisma.patient.findFirst({ where: { id, tenantId } });
    if (!row) {
      throw new DomainError("NOT_FOUND", "Patient was not found.");
    }
    return row;
  }

  private async findPatientOrThrowTx(
    tx: PatientsTransaction,
    id: string,
    tenantId: string
  ): Promise<PatientRow> {
    const row = await tx.patient.findFirst({ where: { id, tenantId } });
    if (!row) {
      throw new DomainError("NOT_FOUND", "Patient was not found.");
    }
    return row;
  }

  private async findGuardianOrThrow(
    id: string,
    patientId: string,
    tenantId: string
  ): Promise<PatientGuardianRow> {
    const row = await this.prisma.patientGuardian.findFirst({ where: { id, tenantId, patientId } });
    if (!row) {
      throw new DomainError("NOT_FOUND", "Patient guardian was not found.");
    }
    return row;
  }

  private async findGuardianOrThrowTx(
    tx: PatientsTransaction,
    id: string,
    patientId: string,
    tenantId: string
  ): Promise<PatientGuardianRow> {
    const row = await tx.patientGuardian.findFirst({ where: { id, tenantId, patientId } });
    if (!row) {
      throw new DomainError("NOT_FOUND", "Patient guardian was not found.");
    }
    return row;
  }
}
