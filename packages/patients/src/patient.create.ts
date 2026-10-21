import type { AuditAppendInput, AuditAppendTx } from "@newsaas/database";
import { DomainError } from "@newsaas/shared";
import { PATIENT_DTO_SCHEMA_VERSION, PATIENT_GUARDIAN_DTO_SCHEMA_VERSION } from "./patient.zod.js";
import type { CreatePatientInput, PatientSex } from "./patient.zod.js";
import type { PatientResponse } from "./patient.dto.js";

/**
 * The patient create contract, callable from anywhere [[DEC-073]].
 *
 * The API answers `POST /patients` with it and the import worker will create its
 * patients with the SAME call, so the create schema's rules, the active-patient
 * guardian requirement (Decision #2223), the global-catalog check, the two audit
 * rows and the response mapper exist exactly once.
 *
 * **What this boundary deliberately does NOT do:** it never resolves a tenant
 * from an ambient context, never reads a request, never imports Nest, and never
 * accepts a tenant from a caller-supplied argument — the tenant, the actor, the
 * audit appender and the catalog are PARAMETERS. What keeps the API safe is that
 * its service resolves them from `RequestContextService` and never from request
 * input.
 */

/** Tenant-scoped Patient row as read from the client, before DTO mapping. */
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

/** Exactly the Patient columns `create` writes; the client defaults none of them. */
export interface PatientCreateData {
  readonly tenantId: string;
  readonly name: string;
  readonly speciesId: string;
  readonly breedId: string | null;
  readonly sex: PatientSex;
  readonly birthDate: Date | null;
  readonly isActive: boolean;
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

/**
 * The ONE Patient statement the create path issues. Narrow on purpose: a caller
 * from a non-request context (the import worker) has to be able to satisfy it
 * with its own client, and a test has to be able to stub it without a database —
 * so it names the single operation instead of borrowing a whole generated
 * delegate.
 */
export interface PatientCreateDelegate {
  create: (args: { data: PatientCreateData }) => Promise<PatientRow>;
}

/**
 * The guardian statements the primary link issues. Narrow for the same reason as
 * `PatientCreateDelegate`: establish-or-promote is three statements, not the
 * whole guardian surface (listing, ordering, deactivation stay in the API).
 */
export interface PatientCreateGuardianDelegate {
  findFirst: (args: { where: PatientGuardianWhere }) => Promise<PatientGuardianRow | null>;
  create: (args: { data: PatientGuardianCreateData }) => Promise<PatientGuardianRow>;
  updateMany: (args: {
    where: PatientGuardianWhere;
    data: PatientGuardianUpdateData;
  }) => Promise<{ count: number }>;
}

/**
 * Read-only view of the Core Customer needed to validate a guardian link. The
 * Veterinary boundary references the Core Customer by id and stores nothing
 * about it, so this is one `findFirst` with the tenant in the `where`.
 */
export interface PatientCustomerDelegate {
  findFirst: (args: {
    where: { id: string; tenantId: string };
    select: { id: true };
  }) => Promise<{ id: string } | null>;
}

/**
 * The transaction this function opens. `auditLog` is present because the audit
 * appender joins the caller's transaction through it — the create path itself
 * never writes an audit row by hand; it hands this handle to the appender.
 */
export interface PatientCreateTransaction {
  patient: PatientCreateDelegate;
  patientGuardian: PatientCreateGuardianDelegate;
  customer: PatientCustomerDelegate;
  auditLog: AuditAppendTx["auditLog"];
}

/** What `createPatient` needs from the client: the ability to open the one transaction. */
export interface PatientCreateDb {
  $transaction: <T>(work: (tx: PatientCreateTransaction) => Promise<T>) => Promise<T>;
}

/** GLOBAL Species lookup. The catalog carries NO tenant predicate (Decision #2211). */
export interface PatientCatalogSpeciesDelegate {
  findFirst: (args: {
    where: { id: string };
    select: { id: true };
  }) => Promise<{ id: string } | null>;
}

/** GLOBAL Breed lookup; a Breed must belong to the referenced Species. */
export interface PatientCatalogBreedDelegate {
  findFirst: (args: {
    where: { id: string; speciesId: string };
    select: { id: true };
  }) => Promise<{ id: string } | null>;
}

/**
 * The species/breed taxonomy, as a PARAMETER — for the same reason the tenant is
 * one: the API reads the global seed through its own client, and the worker has
 * no module that owns the catalog, so a function that resolved it itself would
 * only ever work in one of the two callers.
 */
export interface PatientCatalog {
  species: PatientCatalogSpeciesDelegate;
  breed: PatientCatalogBreedDelegate;
}

/**
 * The audit appender as an INTERFACE, not a class.
 *
 * The append primitive is `@newsaas/database`'s `appendAuditLog`; the API wraps
 * it in `AuditWriter` to add server-owned request correlation, and a caller
 * outside a request (the import worker) supplies its own thin writer over the
 * same primitive. Typing the parameter as this interface — the primitive's own
 * input and transaction types — is what lets both pass without either one
 * leaking into the package, and what lets a test assert the audit rows without a
 * database.
 */
export interface PatientAuditAppender {
  append(input: AuditAppendInput, tx?: AuditAppendTx): Promise<unknown>;
}

export interface CreatePatientArgs {
  db: PatientCreateDb;
  audit: PatientAuditAppender;
  /**
   * Resolved by the CALLER: in the API from `RequestContextService`, in the
   * worker from the `import_job` row it owns. Never from request input.
   */
  tenantId: string;
  actorUserProfileId: string;
  input: CreatePatientInput;
  catalog: PatientCatalog;
}

/** Descriptor for the guardian audit row a primary mutation must co-commit. */
export interface GuardianAudit {
  action: "patient_guardian.created" | "patient_guardian.primary_changed";
  targetId: string;
  changedFields: string[];
}

/** Maps a stored row to the allowlisted response. CONFIDENTIAL values stay in the DTO. */
export function toPatientResponse(row: PatientRow): PatientResponse {
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

/** Audit field names for the Patient columns only (never the guardian input). */
export function changedPatientFields(input: object): string[] {
  const source = input as Record<string, unknown>;
  return ["name", "speciesId", "breedId", "sex", "birthDate", "isActive"].filter(
    (key) => source[key] !== undefined
  );
}

/**
 * Validates Species/Breed against the GLOBAL seeded catalog. Lookups carry NO
 * tenant predicate: taxonomy is shared across tenants (Decision #2211). Unknown
 * values are VALIDATION_FAILED, and a Breed must belong to the referenced
 * Species.
 *
 * Exported because the Patient UPDATE path on the API validates the same way; a
 * second copy of these two refusals is exactly what [[DEC-073]] exists to
 * prevent.
 */
export async function assertGlobalCatalog(
  catalog: PatientCatalog,
  speciesId: string,
  breedId?: string | null
): Promise<void> {
  const species = await catalog.species.findFirst({
    where: { id: speciesId },
    select: { id: true },
  });
  if (!species) {
    throw new DomainError("VALIDATION_FAILED", "Unknown species.");
  }
  if (breedId !== undefined && breedId !== null) {
    const breed = await catalog.breed.findFirst({
      where: { id: breedId, speciesId },
      select: { id: true },
    });
    if (!breed) {
      throw new DomainError("VALIDATION_FAILED", "Unknown breed for the selected species.");
    }
  }
}

/**
 * Refuses a guardian link whose Core Customer is not this tenant's: a foreign
 * UUID surfaces as 404, byte-equivalent to missing. Lookups carry the tenant in
 * the `where`, never a caller-supplied one.
 *
 * Exported because the API's standalone guardian routes link a guardian too, and
 * a second copy of this refusal is exactly what [[DEC-073]] exists to prevent.
 */
export async function assertTenantCustomer(
  tx: PatientCreateTransaction,
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
 * Establishes `customerId` as the Patient's active primary guardian inside the
 * caller's transaction. DEMOTE runs before PROMOTE because the
 * `(patient_id) WHERE is_primary AND is_active` partial unique index is
 * immediate. Returns the guardian audit descriptor, or null when the target
 * already is the active primary (no mutation).
 *
 * Exported because the Patient UPDATE path links a primary the same way when it
 * activates an inactive patient (Decision #2223).
 */
export async function linkPrimaryGuardian(
  tx: PatientCreateTransaction,
  tenantId: string,
  patientId: string,
  customerId: string
): Promise<GuardianAudit | null> {
  await assertTenantCustomer(tx, customerId, tenantId);

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

/**
 * Appends the guardian audit row the caller's primary mutation must co-commit.
 * The appender is a parameter for the same reason it is on `createPatient`:
 * request correlation is the API's concern, not this boundary's.
 */
export async function appendGuardianAudit(
  audit: PatientAuditAppender,
  tx: PatientCreateTransaction,
  descriptor: GuardianAudit | null,
  patientId: string,
  tenantId: string,
  actorUserProfileId: string
): Promise<void> {
  if (!descriptor) return;
  await audit.append(
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

/**
 * Creates one Patient, its active primary guardian and BOTH audit rows in ONE
 * transaction, so an active Patient can never be committed without its guardian
 * or its trail.
 *
 * The transaction stays INSIDE this function: a worker that opened its own would
 * be a second, differently-shaped atomicity guarantee for the same three writes.
 */
export async function createPatient({
  db,
  audit,
  tenantId,
  actorUserProfileId,
  input,
  catalog,
}: CreatePatientArgs): Promise<PatientRow> {
  if (input.isActive !== false && input.primaryGuardianCustomerId === undefined) {
    throw new DomainError(
      "VALIDATION_FAILED",
      "primaryGuardianCustomerId is required when creating an active patient."
    );
  }
  await assertGlobalCatalog(catalog, input.speciesId, input.breedId);

  return db.$transaction(async (tx) => {
    const created = await tx.patient.create({
      data: buildPatientCreateData(tenantId, input),
    });

    let guardianAudit: GuardianAudit | null = null;
    if (input.primaryGuardianCustomerId !== undefined) {
      guardianAudit = await linkPrimaryGuardian(
        tx,
        tenantId,
        created.id,
        input.primaryGuardianCustomerId
      );
    }

    await audit.append(
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

    await appendGuardianAudit(audit, tx, guardianAudit, created.id, tenantId, actorUserProfileId);

    return created;
  });
}
