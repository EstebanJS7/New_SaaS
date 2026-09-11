---
type: module
module: patients
status: in-progress
updated: 2026-09-11
---

# Module — Patients (Veterinary)

## Responsibility

Veterinary vertical domain for tenant-scoped pet identity and the guardian
bridge to Core Customers. Owns the `Patient` aggregate, the `PatientGuardian`
link, and the global `Species`/`Breed` taxonomy the aggregate references.

Consumes Core `Customer` and the RBAC/entitlement platform; Core domains never
import this module (one-way Veterinary → Core dependency).

## Does Not Own

- Core Customer data (owned by [[Customers]]).
- Clinical records, vaccinations, treatments, weights, or studies.
- Scheduling, sales, billing, fiscal behavior, or Portal access.
- Tenant-specific catalog overrides — the taxonomy is global (Decision #2211).

## Main Concepts

```text
Patient          tenant-scoped identity (name, species, optional breed, sex, birthDate)
PatientGuardian  tenant-scoped link: Patient → Core Customer (multiple; never hard-deleted)
Species          GLOBAL seeded reference catalog
Breed            GLOBAL seeded reference catalog, belongs to one Species
PatientSex       MALE | FEMALE | UNKNOWN
```

## Permissions

```text
patients.read
patients.create
patients.update
patients.deactivate
patients.guardian.manage
```

Reference-seed role matrix:

| Role              | Permissions                           |
| ----------------- | ------------------------------------- |
| OWNER             | all five                              |
| ADMIN             | all five                              |
| RECEPTIONIST      | read, create, update, guardian.manage |
| VETERINARIAN      | read, create, update                  |
| CASHIER           | none                                  |
| INVENTORY_MANAGER | none                                  |

Feature gate: the `veterinary` entitlement gates every Patient operation
(enforced in the service, not a generic guard). The entitlement is already a
seeded `feature_code`; demo grants include it.

## API

Not implemented yet — the authorized API surface ships in WU3 (PAT-002):

```text
GET    /patients
GET    /patients/catalog
POST   /patients
GET    /patients/:id
PUT    /patients/:id
POST   /patients/:id/deactivate
GET    /patients/:patientId/guardians
POST   /patients/:patientId/guardians
PUT    /patients/:patientId/guardians/:id
POST   /patients/:patientId/guardians/:id/primary
POST   /patients/:patientId/guardians/:id/deactivate
```

## Data Classification

- `Patient.name` and `Patient.birthDate` are **CONFIDENTIAL**.
- The `Patient`↔`Customer` guardian link is **CONFIDENTIAL**.
- `Species`/`Breed` taxonomy is **INTERNAL** reference data.
- Logs and audit metadata carry stable IDs and field names only; values are
  never logged. DTOs are allowlisted.

## Invariants

- Every `Patient` and `PatientGuardian` row is tenant-scoped. Queries filter by
  **both** `id` and server-derived `tenantId`; cross-tenant UUID access returns
  a byte-equivalent `404`.
- `Species`/`Breed` are GLOBAL: no `tenant_id`, never tenant-filtered. A Patient
  may reference any seeded Species/Breed; foreign keys are `RESTRICT`.
- `Patient.speciesId` is required and references a global Species;
  `Patient.breedId` is optional and references a global Breed.
- There is no hard-delete path for Patients or guardian links; deactivation is
  the only removal.
- An active Patient has exactly one active primary guardian:
  - **at most one** — partial unique index `patient_guardian_primary_active_key`
    on `(patient_id) WHERE is_primary AND is_active`;
  - **at least one** — two `DEFERRABLE INITIALLY DEFERRED` constraint triggers
    that re-check the count at commit:
    - `patient_guardian_exactly_one_primary_trigger` on `patient_guardian`
      writes (`INSERT OR UPDATE OR DELETE`); a `patient_id` reparent validates
      **both** the OLD and the NEW Patient, so moving a sole active primary
      cannot orphan the OLD active Patient;
    - `patient_exactly_one_primary_guardian_trigger` on active Patient lifecycle
      writes (`AFTER INSERT OR UPDATE ON patient`), so a lone active Patient
      INSERT or an activation cannot commit with zero primaries.
- **Active creation is atomic**: an active Patient and its active primary
  guardian MUST be created in one transaction; a Patient MAY instead be created
  inactive and activated later only in a transaction that establishes exactly
  one active primary. An inactive Patient may have zero active primary
  guardians.
- **Primary-swap ordering**: because the partial index is immediate (PostgreSQL
  partial unique indexes cannot be deferred), a primary swap MUST demote the
  current primary before promoting the replacement. The deferred trigger then
  sees exactly one at commit. Promoting first raises a unique violation.
- `PatientGuardian` is referenced only by the Veterinary Patients module (no
  Core module imports it).

## Implementation

- `packages/database/prisma/schema.prisma` — `Patient`, `Species`, `Breed`,
  `PatientSex`, activated `PatientGuardian`.
- `packages/database/prisma/migrations/20260911000003_patients/migration.sql` —
  additive DDL: tables, `RESTRICT` FKs, partial unique index, and the two
  deferred exactly-one-primary constraint triggers (guardian writes and active
  Patient `INSERT`/`UPDATE`).
- `packages/database/src/reference-seed.ts` — global Species/Breed seeds and
  `patients.*` permissions + baseline matrix.
- `packages/database/src/demo-seed.ts` — synthetic demo Patients and one active
  primary guardian per Patient, created in a single `$transaction`.
- `packages/database/src/schema-patients.test.ts` — migration/schema inventory
  including both deferred triggers and the two-sided reparent validation.
- `packages/database/scripts/live-migration-verify.ts` — live PostgreSQL proof
  of both triggers, the Patient lifecycle invariant matrix, and the guardian
  reparent regression.
- `apps/api/src/patients/*` — service, controllers, Zod schemas, DTOs (WU2/WU3).
- `apps/web/src/app/(app)/app/patients/*` — staff workspace (WU4).

## Known limitations / blockers

- [[TD-006]] — live-PostgreSQL concurrency safety of the at-least-one primary
  invariant is not proven. The `DEFERRABLE INITIALLY DEFERRED` trigger plus the
  partial index are validated for single-transaction behavior only. Concurrency
  proof lands with H1 and must not be reported as production-proven before then.
- The `veterinary` entitlement must be granted explicitly; there is no automatic
  grant (mirrors all capabilities).

## Related

- [[EPIC-05]] Veterinary Patients
- [[Customers]]
- [[Data Classification and Retention]]
- [[Reversals and Corrections]]
- [[TD-006]]
