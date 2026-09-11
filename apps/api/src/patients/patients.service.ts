import { Inject, Injectable } from "@nestjs/common";
import { PrismaService } from "@newsaas/database";
import { DomainError } from "@newsaas/shared";
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

/** Tenant-scoped Patient row as read from Prisma. */
export interface PatientRow {
  id: string;
  tenantId: string;
  name: string;
  speciesId: string;
  breedId: string | null;
  sex: PatientSex;
  birthDate: Date | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface PatientCreateData {
  readonly tenantId: string;
  readonly name: string;
  readonly speciesId: string;
  readonly breedId: string | null;
  readonly sex: PatientSex;
  readonly birthDate: Date | null;
  readonly isActive: boolean;
}

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

export interface PatientGuardianRow {
  id: string;
  tenantId: string;
  patientId: string;
  customerId: string;
  isPrimary: boolean;
  isActive: boolean;
  position: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface PatientGuardianCreateData {
  readonly tenantId: string;
  readonly patientId: string;
  readonly customerId: string;
  readonly isPrimary: boolean;
  readonly isActive: boolean;
  readonly position: number;
}

export interface PatientGuardianUpdateData {
  isPrimary?: boolean;
  isActive?: boolean;
  position?: number;
}

export interface PatientGuardianWhere {
  id?: string;
  tenantId: string;
  patientId: string;
  customerId?: string;
  isPrimary?: boolean;
  isActive?: boolean;
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

export interface SpeciesDelegate {
  findFirst: (args: {
    where: { id: string };
    select: { id: true };
  }) => Promise<{ id: string } | null>;
}

export interface BreedDelegate {
  findFirst: (args: {
    where: { id: string; speciesId: string };
    select: { id: true };
  }) => Promise<{ id: string } | null>;
}

/** Read-only view of the Core Customer needed to validate a guardian link. */
export interface PatientCustomerDelegate {
  findFirst: (args: {
    where: { id: string; tenantId: string };
    select: { id: true };
  }) => Promise<{ id: string } | null>;
}

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

/** Descriptor for the guardian audit row a primary mutation must co-commit. */
interface GuardianAudit {
  action: "patient_guardian.created" | "patient_guardian.primary_changed";
  targetId: string;
  changedFields: string[];
}

function toPatientResponse(row: PatientRow): PatientResponse {
  return {
    id: row.id,
    tenantId: row.tenantId,
    name: row.name,
    speciesId: row.speciesId,
    breedId: row.breedId,
    sex: row.sex,
    birthDate: row.birthDate ? row.birthDate.toISOString() : null,
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
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

function buildPatientCreateData(tenantId: string, input: CreatePatientInput): PatientCreateData {
  return {
    tenantId,
    name: input.name,
    speciesId: input.speciesId,
    breedId: input.breedId ?? null,
    sex: input.sex,
    birthDate: input.birthDate === undefined ? null : new Date(input.birthDate),
    isActive: input.isActive ?? true,
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

/** Audit field names for the Patient columns only (never the guardian input). */
function changedPatientFields(input: object): string[] {
  const source = input as Record<string, unknown>;
  return ["name", "speciesId", "breedId", "sex", "birthDate", "isActive"].filter(
    (key) => source[key] !== undefined
  );
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

  async create(input: CreatePatientInput): Promise<PatientResponse> {
    const tenantId = await this.requireTenantContext();
    const actorUserProfileId = this.requestContext.requireUserProfileId();

    if (input.isActive !== false && input.primaryGuardianCustomerId === undefined) {
      throw new DomainError(
        "VALIDATION_FAILED",
        "primaryGuardianCustomerId is required when creating an active patient."
      );
    }
    await this.assertGlobalCatalog(input.speciesId, input.breedId);

    const row = await this.prisma.$transaction(async (tx) => {
      const created = await tx.patient.create({
        data: buildPatientCreateData(tenantId, input),
      });

      let guardianAudit: GuardianAudit | null = null;
      if (input.primaryGuardianCustomerId !== undefined) {
        guardianAudit = await this.linkPrimaryGuardian(
          tx,
          tenantId,
          created.id,
          input.primaryGuardianCustomerId
        );
      }

      await this.audit.append(
        {
          action: "patient.created",
          tenantId,
          actorUserProfileId,
          targetType: "patient",
          targetId: created.id,
          metadata: {
            schemaVersion: PATIENT_DTO_SCHEMA_VERSION,
            changedFields: changedPatientFields(input),
          },
        },
        tx
      );

      await this.appendGuardianAudit(tx, guardianAudit, created.id, tenantId, actorUserProfileId);

      return created;
    });

    return toPatientResponse(row);
  }

  async update(id: string, input: UpdatePatientInput): Promise<PatientResponse> {
    const tenantId = await this.requireTenantContext();
    const actorUserProfileId = this.requestContext.requireUserProfileId();

    const existing = await this.findPatientOrThrow(id, tenantId);

    if (input.speciesId !== undefined || input.breedId !== undefined) {
      await this.assertGlobalCatalog(
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
        guardianAudit = await this.linkPrimaryGuardian(
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

      await this.appendGuardianAudit(tx, guardianAudit, id, tenantId, actorUserProfileId);

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
      await this.assertTenantCustomer(tx, input.customerId, tenantId);

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

      await this.appendGuardianAudit(tx, guardianAudit, patientId, tenantId, actorUserProfileId);
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

  /**
   * Validates Species/Breed against the GLOBAL seeded catalog. Lookups carry NO
   * tenant predicate: taxonomy is shared across tenants (Decision #2211).
   * Unknown values are VALIDATION_FAILED, and a Breed must belong to the
   * referenced Species.
   */
  private async assertGlobalCatalog(speciesId: string, breedId?: string | null): Promise<void> {
    const species = await this.prisma.species.findFirst({
      where: { id: speciesId },
      select: { id: true },
    });
    if (!species) {
      throw new DomainError("VALIDATION_FAILED", "Unknown species.");
    }
    if (breedId !== undefined && breedId !== null) {
      const breed = await this.prisma.breed.findFirst({
        where: { id: breedId, speciesId },
        select: { id: true },
      });
      if (!breed) {
        throw new DomainError("VALIDATION_FAILED", "Unknown breed for the selected species.");
      }
    }
  }

  private async assertTenantCustomer(
    tx: PatientsTransaction,
    customerId: string,
    tenantId: string
  ): Promise<void> {
    const customer = await tx.customer.findFirst({
      where: { id: customerId, tenantId },
      select: { id: true },
    });
    if (!customer) {
      throw new DomainError("NOT_FOUND", "Customer was not found.");
    }
  }

  /**
   * Establishes `customerId` as the Patient's active primary guardian inside
   * the caller's transaction. DEMOTE runs before PROMOTE because the partial
   * unique index is immediate. Returns the guardian audit descriptor, or null
   * when the target already is the active primary (no mutation).
   */
  private async linkPrimaryGuardian(
    tx: PatientsTransaction,
    tenantId: string,
    patientId: string,
    customerId: string
  ): Promise<GuardianAudit | null> {
    await this.assertTenantCustomer(tx, customerId, tenantId);

    const current = await tx.patientGuardian.findFirst({
      where: { tenantId, patientId, isPrimary: true, isActive: true },
    });
    if (current?.customerId === customerId) {
      return null;
    }
    if (current) {
      await tx.patientGuardian.updateMany({
        where: { id: current.id, tenantId, patientId },
        data: { isPrimary: false },
      });
    }

    const link = await tx.patientGuardian.findFirst({ where: { tenantId, patientId, customerId } });
    if (link) {
      await tx.patientGuardian.updateMany({
        where: { id: link.id, tenantId, patientId },
        data: { isPrimary: true, isActive: true },
      });
      return {
        action: "patient_guardian.primary_changed",
        targetId: link.id,
        changedFields: ["isPrimary", "isActive"],
      };
    }

    const created = await tx.patientGuardian.create({
      data: { tenantId, patientId, customerId, isPrimary: true, isActive: true, position: 0 },
    });
    return {
      action: "patient_guardian.created",
      targetId: created.id,
      changedFields: ["customerId", "isPrimary"],
    };
  }

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

  private async appendGuardianAudit(
    tx: PatientsTransaction,
    descriptor: GuardianAudit | null,
    patientId: string,
    tenantId: string,
    actorUserProfileId: string
  ): Promise<void> {
    if (!descriptor) return;
    await this.audit.append(
      {
        action: descriptor.action,
        tenantId,
        actorUserProfileId,
        targetType: "patient_guardian",
        targetId: descriptor.targetId,
        metadata: {
          schemaVersion: PATIENT_GUARDIAN_DTO_SCHEMA_VERSION,
          changedFields: descriptor.changedFields,
          patientId,
        },
      },
      tx
    );
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
