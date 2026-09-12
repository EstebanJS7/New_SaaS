import { Inject, Injectable } from "@nestjs/common";
import { PrismaService } from "@newsaas/database";
import { DomainError } from "@newsaas/shared";
import { AuditAppendTx, AuditWriter } from "../audit/audit-writer.service.js";
import { RequestContextService } from "../context/request-context.service.js";
import { EntitlementsService } from "../entitlements/entitlements.service.js";
import { PermissionResolver } from "../rbac/permission-resolver.service.js";
import { toIso } from "./clinical.dto.js";
import type { ClinicalEncounterResponse, ClinicalEncounterStatusDto } from "./clinical.dto.js";
import { CLINICAL_PERMISSIONS } from "./clinical.permissions.js";
import { ClinicalServiceBase } from "./clinical.service.base.js";
import type { ClinicalPatientDelegate } from "./clinical.service.base.js";

// ---------------------------------------------------------------------------
// Encounter rows, inputs and data
// ---------------------------------------------------------------------------

/** Tenant-scoped clinical encounter row as read from Prisma. */
export interface ClinicalEncounterRow {
  id: string;
  tenantId: string;
  patientId: string;
  status: ClinicalEncounterStatusDto;
  version: number;
  reasonForVisit: string | null;
  anamnesis: string | null;
  diagnosis: string | null;
  treatmentPlan: string | null;
  internalNotes: string | null;
  clientSummary: string | null;
  amendsEncounterId: string | null;
  amendmentReason: string | null;
  idempotencyKey: string | null;
  closedAt: Date | null;
  closedByUserProfileId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Structured encounter content shared by create/autosave/amendment. */
export interface ClinicalEncounterContentInput {
  reasonForVisit?: string | null;
  anamnesis?: string | null;
  diagnosis?: string | null;
  treatmentPlan?: string | null;
  internalNotes?: string | null;
  clientSummary?: string | null;
}

export type CreateEncounterInput = ClinicalEncounterContentInput;

export interface UpdateDraftInput extends ClinicalEncounterContentInput {
  /** Version the caller last read; a mismatch persists nothing and returns 409. */
  readonly version: number;
}

export interface CloseEncounterInput {
  /** Version the caller last read; a mismatch persists nothing and returns 409. */
  readonly version: number;
}

export interface AmendEncounterInput {
  /** Required correction reason; audited and preserved on the amendment row. */
  readonly reason: string;
  /** Optional client-supplied key; a replay resolves to the existing amendment. */
  readonly idempotencyKey?: string;
  /** Optional content override; omitted fields are copied from the original. */
  readonly content?: ClinicalEncounterContentInput;
}

export interface ClinicalEncounterWhere {
  id?: string;
  tenantId: string;
  patientId?: string;
  status?: ClinicalEncounterStatusDto;
  version?: number;
  idempotencyKey?: string;
}

export interface ClinicalEncounterCreateData {
  tenantId: string;
  patientId: string;
  status: ClinicalEncounterStatusDto;
  version: number;
  reasonForVisit: string | null;
  anamnesis: string | null;
  diagnosis: string | null;
  treatmentPlan: string | null;
  internalNotes: string | null;
  clientSummary: string | null;
  amendsEncounterId: string | null;
  amendmentReason: string | null;
  idempotencyKey: string | null;
  closedAt: Date | null;
  closedByUserProfileId: string | null;
}

export interface ClinicalEncounterUpdateData {
  reasonForVisit?: string | null;
  anamnesis?: string | null;
  diagnosis?: string | null;
  treatmentPlan?: string | null;
  internalNotes?: string | null;
  clientSummary?: string | null;
  status?: ClinicalEncounterStatusDto;
  version?: number | { increment: number };
  closedAt?: Date | null;
  closedByUserProfileId?: string | null;
}

export interface ClinicalEncounterDelegate {
  findMany: (args: {
    where: { tenantId: string; patientId: string };
    orderBy?: { createdAt?: "asc" | "desc" };
  }) => Promise<ClinicalEncounterRow[]>;
  findFirst: (args: { where: ClinicalEncounterWhere }) => Promise<ClinicalEncounterRow | null>;
  create: (args: { data: ClinicalEncounterCreateData }) => Promise<ClinicalEncounterRow>;
  updateMany: (args: {
    where: ClinicalEncounterWhere;
    data: ClinicalEncounterUpdateData;
  }) => Promise<{ count: number }>;
}

/** Delegates shared by the root client and its transaction scope. */
export interface ClinicalTransaction {
  clinicalEncounter: ClinicalEncounterDelegate;
  auditLog: AuditAppendTx["auditLog"];
  /** Raw-SQL seam for the `SELECT ... FOR UPDATE` amendment lock. */
  $queryRaw: (query: TemplateStringsArray, ...values: unknown[]) => Promise<unknown[]>;
}

export interface ClinicalPrisma {
  $transaction: <T>(work: (tx: ClinicalTransaction) => Promise<T>) => Promise<T>;
  patient: ClinicalPatientDelegate;
  clinicalEncounter: ClinicalEncounterDelegate;
}

/**
 * `SELECT ... FOR UPDATE` row lock on the tenant-scoped encounter being
 * corrected (design Data Flow: "lock original (tenant-scoped CLOSED)").
 *
 * Serializes concurrent amendments of the SAME original: the second request
 * blocks until the first commits, then its in-transaction replay check resolves
 * the duplicate `idempotencyKey` to the committed amendment. Mirrors the shared
 * `FOR UPDATE` protocol in `rbac/manage-holdership.ts`.
 */
async function lockEncounterRow(
  tx: ClinicalTransaction,
  tenantId: string,
  id: string
): Promise<void> {
  await tx.$queryRaw`
    SELECT "id"
    FROM "clinical_encounter"
    WHERE "tenant_id" = ${tenantId}::uuid
      AND "id" = ${id}::uuid
    FOR UPDATE`;
}

/**
 * Exact unique constraint behind amendment idempotency:
 * `@@unique([tenantId, idempotencyKey])` on `clinical_encounter`, which maps to
 * the PostgreSQL index `clinical_encounter_tenant_id_idempotency_key_key`.
 */
const AMENDMENT_IDEMPOTENCY_CONSTRAINT = "clinical_encounter_tenant_id_idempotency_key_key";

/** The constraint's columns/fields, normalized once for shape-agnostic matching. */
const AMENDMENT_IDEMPOTENCY_FIELDS: readonly string[] = ["tenantid", "idempotencykey"];

function normalizeUniqueTargetToken(token: string): string {
  return token.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * True only for the `(tenantId, idempotencyKey)` unique conflict — never for an
 * unrelated `P2002` such as the `(tenantId, id)` tenant-ownership key.
 *
 * Prisma reports `meta.target` in provider/engine-dependent shapes: the violated
 * index/constraint name (as a string or single-element array) or the violated
 * column names (`tenant_id`/`idempotency_key`, or their mapped field names).
 * Both shapes are recognized; anything else is not this service's key and must
 * propagate untouched.
 */
function matchesAmendmentIdempotencyTarget(target: unknown): boolean {
  const expectedConstraint = normalizeUniqueTargetToken(AMENDMENT_IDEMPOTENCY_CONSTRAINT);

  if (typeof target === "string") {
    return normalizeUniqueTargetToken(target) === expectedConstraint;
  }
  if (!Array.isArray(target)) {
    return false;
  }

  const tokens = target.filter((entry): entry is string => typeof entry === "string");
  if (tokens.length === 0) {
    return false;
  }

  // Index/constraint-name shape, e.g.
  // `["clinical_encounter_tenant_id_idempotency_key_key"]`.
  if (tokens.length === 1 && normalizeUniqueTargetToken(tokens[0]) === expectedConstraint) {
    return true;
  }

  // Column/field shape (order is not guaranteed), e.g.
  // `["tenant_id", "idempotency_key"]` or `["tenantId", "idempotencyKey"]`.
  const normalized = tokens.map(normalizeUniqueTargetToken);
  return (
    normalized.length === AMENDMENT_IDEMPOTENCY_FIELDS.length &&
    AMENDMENT_IDEMPOTENCY_FIELDS.every((field) => normalized.includes(field))
  );
}

/**
 * Prisma unique-constraint violation (`P2002`) scoped to the exact amendment
 * idempotency target, detected structurally so this service keeps its narrow,
 * generated-client-free transaction contract.
 *
 * Used as the last-resort arbiter for a duplicate amendment whose key is reused
 * across DIFFERENT originals (the per-original row lock cannot serialize those):
 * the `(tenant_id, idempotency_key)` unique rejects the loser, which then
 * recovers to the winner's row instead of surfacing a raw DB error. Any other
 * `P2002` target is rethrown.
 */
function isAmendmentIdempotencyConflict(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }
  const candidate = error as { code?: unknown; meta?: { target?: unknown } };
  return candidate.code === "P2002" && matchesAmendmentIdempotencyTarget(candidate.meta?.target);
}

// ---------------------------------------------------------------------------
// Row -> allowlisted DTO mapping
// ---------------------------------------------------------------------------

function toEncounterResponse(row: ClinicalEncounterRow): ClinicalEncounterResponse {
  return {
    id: row.id,
    tenantId: row.tenantId,
    patientId: row.patientId,
    status: row.status,
    version: row.version,
    reasonForVisit: row.reasonForVisit,
    anamnesis: row.anamnesis,
    diagnosis: row.diagnosis,
    treatmentPlan: row.treatmentPlan,
    internalNotes: row.internalNotes,
    clientSummary: row.clientSummary,
    amendsEncounterId: row.amendsEncounterId,
    amendmentReason: row.amendmentReason,
    closedAt: row.closedAt ? toIso(row.closedAt) : null,
    closedByUserProfileId: row.closedByUserProfileId,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
}

const ENCOUNTER_CONTENT_FIELDS = [
  "reasonForVisit",
  "anamnesis",
  "diagnosis",
  "treatmentPlan",
  "internalNotes",
  "clientSummary",
] as const;

/** Field names actually supplied, for the audit diff (never values). */
function changedEncounterFields(input: ClinicalEncounterContentInput): string[] {
  return ENCOUNTER_CONTENT_FIELDS.filter((key) => input[key] !== undefined);
}

function buildEncounterUpdateData(input: UpdateDraftInput): ClinicalEncounterUpdateData {
  const data: ClinicalEncounterUpdateData = {};
  if (input.reasonForVisit !== undefined) data.reasonForVisit = input.reasonForVisit;
  if (input.anamnesis !== undefined) data.anamnesis = input.anamnesis;
  if (input.diagnosis !== undefined) data.diagnosis = input.diagnosis;
  if (input.treatmentPlan !== undefined) data.treatmentPlan = input.treatmentPlan;
  if (input.internalNotes !== undefined) data.internalNotes = input.internalNotes;
  if (input.clientSummary !== undefined) data.clientSummary = input.clientSummary;
  return data;
}

function pickContent<T extends string | null>(override: T | undefined, original: T): T {
  // `null` is a meaningful override (explicitly clears the field); only an
  // omitted value (`undefined`) falls back to the original.
  if (override === undefined) {
    return original;
  }
  return override;
}

/**
 * Copies the original content, applying any explicit override. The amendment
 * row is a NEW CLOSED record; the original is never mutated.
 */
function buildAmendmentContent(
  original: ClinicalEncounterRow,
  override?: ClinicalEncounterContentInput
): Pick<
  ClinicalEncounterCreateData,
  "reasonForVisit" | "anamnesis" | "diagnosis" | "treatmentPlan" | "internalNotes" | "clientSummary"
> {
  return {
    reasonForVisit: pickContent(override?.reasonForVisit, original.reasonForVisit),
    anamnesis: pickContent(override?.anamnesis, original.anamnesis),
    diagnosis: pickContent(override?.diagnosis, original.diagnosis),
    treatmentPlan: pickContent(override?.treatmentPlan, original.treatmentPlan),
    internalNotes: pickContent(override?.internalNotes, original.internalNotes),
    clientSummary: pickContent(override?.clientSummary, original.clientSummary),
  };
}

/**
 * Clinical encounter application boundary (EPIC-06, WU2A encounter core).
 *
 * - DRAFT autosave uses one conditional `updateMany(status=DRAFT, version=N)`
 *   so a stale or concurrent write changes nothing and returns 409 `CONFLICT`.
 * - CLOSED encounters are immutable; correction is an explicit amendment that
 *   creates a linked CLOSED row and leaves the original untouched.
 * - Tenant, entitlement, permission and co-committed audit behavior live in
 *   {@link ClinicalServiceBase}; this class owns encounter lifecycle only. The
 *   specialized record kinds are WU2B (`ClinicalRecordsService`).
 */
@Injectable()
export class ClinicalService extends ClinicalServiceBase<ClinicalPrisma> {
  constructor(
    @Inject(PrismaService) prisma: ClinicalPrisma,
    requestContext: RequestContextService,
    entitlements: EntitlementsService,
    permissionResolver: PermissionResolver,
    audit: AuditWriter
  ) {
    super(prisma, requestContext, entitlements, permissionResolver, audit);
  }

  // -------------------------------------------------------------------------
  // Encounter lifecycle
  // -------------------------------------------------------------------------

  async listEncounters(patientId: string): Promise<ClinicalEncounterResponse[]> {
    const tenantId = await this.requireTenantContext();
    await this.requirePermission(CLINICAL_PERMISSIONS.read);
    await this.assertPatient(tenantId, patientId);
    const rows = await this.prisma.clinicalEncounter.findMany({
      where: { tenantId, patientId },
      orderBy: { createdAt: "desc" },
    });
    return rows.map(toEncounterResponse);
  }

  async getEncounter(patientId: string, id: string): Promise<ClinicalEncounterResponse> {
    const tenantId = await this.requireTenantContext();
    await this.requirePermission(CLINICAL_PERMISSIONS.read);
    return toEncounterResponse(await this.findEncounterOrThrow(tenantId, patientId, id));
  }

  async createEncounter(
    patientId: string,
    input: CreateEncounterInput
  ): Promise<ClinicalEncounterResponse> {
    const tenantId = await this.requireTenantContext();
    await this.requirePermission(CLINICAL_PERMISSIONS.create);
    const actorUserProfileId = this.requestContext.requireUserProfileId();
    await this.assertPatient(tenantId, patientId);

    const row = await this.prisma.$transaction(async (tx) => {
      const created = await tx.clinicalEncounter.create({
        data: {
          tenantId,
          patientId,
          status: "DRAFT",
          version: 1,
          reasonForVisit: input.reasonForVisit ?? null,
          anamnesis: input.anamnesis ?? null,
          diagnosis: input.diagnosis ?? null,
          treatmentPlan: input.treatmentPlan ?? null,
          internalNotes: input.internalNotes ?? null,
          clientSummary: input.clientSummary ?? null,
          amendsEncounterId: null,
          amendmentReason: null,
          idempotencyKey: null,
          closedAt: null,
          closedByUserProfileId: null,
        },
      });
      await this.appendAudit(
        tx,
        {
          action: "clinical_encounter.created",
          targetType: "clinical_encounter",
          targetId: created.id,
          changedFields: changedEncounterFields(input),
        },
        tenantId,
        actorUserProfileId
      );
      return created;
    });

    return toEncounterResponse(row);
  }

  async updateDraft(
    patientId: string,
    id: string,
    input: UpdateDraftInput
  ): Promise<ClinicalEncounterResponse> {
    const tenantId = await this.requireTenantContext();
    await this.requirePermission(CLINICAL_PERMISSIONS.update);
    const actorUserProfileId = this.requestContext.requireUserProfileId();

    const existing = await this.findEncounterOrThrow(tenantId, patientId, id);
    if (existing.status === "CLOSED") {
      throw new DomainError("CONFLICT", "Closed clinical encounters are immutable.");
    }

    const data = buildEncounterUpdateData(input);
    const changedFields = changedEncounterFields(input);

    const row = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.clinicalEncounter.updateMany({
        where: { id, tenantId, patientId, status: "DRAFT", version: input.version },
        data: { ...data, version: { increment: 1 } },
      });
      if (count === 0) {
        throw new DomainError("CONFLICT", "The encounter was updated by another writer.");
      }
      const updated = await tx.clinicalEncounter.findFirst({
        where: { id, tenantId, patientId },
      });
      if (!updated) {
        throw new DomainError("NOT_FOUND", "Clinical encounter was not found.");
      }
      await this.appendAudit(
        tx,
        {
          action: "clinical_encounter.updated",
          targetType: "clinical_encounter",
          targetId: id,
          changedFields,
        },
        tenantId,
        actorUserProfileId
      );
      return updated;
    });

    return toEncounterResponse(row);
  }

  async closeEncounter(
    patientId: string,
    id: string,
    input: CloseEncounterInput
  ): Promise<ClinicalEncounterResponse> {
    const tenantId = await this.requireTenantContext();
    await this.requirePermission(CLINICAL_PERMISSIONS.close);
    const actorUserProfileId = this.requestContext.requireUserProfileId();

    const existing = await this.findEncounterOrThrow(tenantId, patientId, id);
    if (existing.status === "CLOSED") {
      throw new DomainError("CONFLICT", "The clinical encounter is already closed.");
    }

    const closedAt = new Date();
    const row = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.clinicalEncounter.updateMany({
        where: { id, tenantId, patientId, status: "DRAFT", version: input.version },
        data: {
          status: "CLOSED",
          closedAt,
          closedByUserProfileId: actorUserProfileId,
          version: { increment: 1 },
        },
      });
      if (count === 0) {
        throw new DomainError("CONFLICT", "The encounter was updated by another writer.");
      }
      const updated = await tx.clinicalEncounter.findFirst({
        where: { id, tenantId, patientId },
      });
      if (!updated) {
        throw new DomainError("NOT_FOUND", "Clinical encounter was not found.");
      }
      await this.appendAudit(
        tx,
        {
          action: "clinical_encounter.closed",
          targetType: "clinical_encounter",
          targetId: id,
          changedFields: ["status", "closedAt", "closedByUserProfileId"],
        },
        tenantId,
        actorUserProfileId
      );
      return updated;
    });

    return toEncounterResponse(row);
  }

  async amendEncounter(
    patientId: string,
    id: string,
    input: AmendEncounterInput
  ): Promise<ClinicalEncounterResponse> {
    const tenantId = await this.requireTenantContext();
    await this.requirePermission(CLINICAL_PERMISSIONS.amend);
    const actorUserProfileId = this.requestContext.requireUserProfileId();

    if (input.reason.trim().length === 0) {
      throw new DomainError("VALIDATION_FAILED", "An amendment reason is required.");
    }

    const closedAt = new Date();
    try {
      const row = await this.prisma.$transaction(async (tx) => {
        // Design flow: lock the original FIRST, then read it inside the same
        // transaction, so concurrent corrections of this encounter serialize.
        await lockEncounterRow(tx, tenantId, id);
        const original = await tx.clinicalEncounter.findFirst({
          where: { id, tenantId, patientId },
        });
        if (!original) {
          throw new DomainError("NOT_FOUND", "Clinical encounter was not found.");
        }
        if (original.status !== "CLOSED") {
          throw new DomainError("CONFLICT", "Only closed clinical encounters can be amended.");
        }

        // Idempotent replay (inside the tx, after the lock): a repeated request
        // key resolves to the existing row without a second write or audit.
        if (input.idempotencyKey !== undefined) {
          const prior = await tx.clinicalEncounter.findFirst({
            where: { tenantId, idempotencyKey: input.idempotencyKey },
          });
          if (prior) {
            return prior;
          }
        }

        const content = buildAmendmentContent(original, input.content);
        const created = await tx.clinicalEncounter.create({
          data: {
            tenantId,
            patientId,
            status: "CLOSED",
            version: 1,
            ...content,
            amendsEncounterId: original.id,
            amendmentReason: input.reason,
            idempotencyKey: input.idempotencyKey ?? null,
            closedAt,
            closedByUserProfileId: actorUserProfileId,
          },
        });
        await this.appendAudit(
          tx,
          {
            action: "clinical_encounter.amended",
            targetType: "clinical_encounter",
            targetId: created.id,
            changedFields: ["amendsEncounterId", "amendmentReason"],
            metadata: { amendedEncounterId: original.id },
          },
          tenantId,
          actorUserProfileId
        );
        return created;
      });

      return toEncounterResponse(row);
    } catch (error) {
      // Concurrency fallback: a duplicate request that lost the
      // `(tenantId, idempotencyKey)` unique race (e.g. the key was reused for a
      // DIFFERENT original, so the per-original row lock could not serialize
      // it). Recover to the winner's committed row instead of surfacing a raw
      // unique error; rethrow when the conflict targets any other constraint or
      // the key genuinely has no row.
      if (input.idempotencyKey !== undefined && isAmendmentIdempotencyConflict(error)) {
        const existing = await this.prisma.clinicalEncounter.findFirst({
          where: { tenantId, idempotencyKey: input.idempotencyKey },
        });
        if (existing) {
          return toEncounterResponse(existing);
        }
      }
      throw error;
    }
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  private async findEncounterOrThrow(
    tenantId: string,
    patientId: string,
    id: string
  ): Promise<ClinicalEncounterRow> {
    const row = await this.prisma.clinicalEncounter.findFirst({
      where: { id, tenantId, patientId },
    });
    if (!row) {
      throw new DomainError("NOT_FOUND", "Clinical encounter was not found.");
    }
    return row;
  }
}
