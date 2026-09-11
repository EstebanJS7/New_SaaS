---
type: module
module: patients
status: done
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

WU3.2 ships the read surface, WU3.3 the Patient commands, and WU3.4 the guardian
routes (PAT-002):

```text
GET    /patients            patients.read       — active Patients of the caller tenant
GET    /patients/catalog    patients.read       — GLOBAL Species/Breed taxonomy (not tenant-filtered)
GET    /patients/:id        patients.read       — single Patient; cross-tenant UUID → 404
POST   /patients            patients.create     — create; active (default) requires a primary guardian
PUT    /patients/:id        patients.update     — update; activating establishes a primary guardian (or 409)
POST   /patients/:id/deactivate  patients.deactivate — idempotent deactivation; no hard delete
GET    /patients/:patientId/guardians                        patients.read           — active guardians of a Patient
GET    /patients/:patientId/guardians/:id                    patients.read           — single guardian
POST   /patients/:patientId/guardians                        patients.guardian.manage — link a Core Customer
PUT    /patients/:patientId/guardians/:id                    patients.guardian.manage — reorder / change primary
POST   /patients/:patientId/guardians/:id/primary            patients.guardian.manage — demote-then-promote primary
POST   /patients/:patientId/guardians/:id/deactivate         patients.guardian.manage — idempotent deactivation
```

`GET /patients/catalog` is declared before `GET /patients/:id` so the static
segment is never captured as a Patient id. Every route declares its `patients.*`
permission (frontend checks are UX-only); the `PatientsService` /
`PatientsCatalogService` layer re-applies the `veterinary` entitlement gate (no
generic feature guard). The catalog DTO is allowlisted INTERNAL reference data
and exposes no tenant identifier.

Commands are Zod-validated and return allowlisted DTOs only. `POST /patients`
writes an active Patient and its primary guardian in one transaction, so an
active create without `primaryGuardianCustomerId` is a 400 and a foreign
Customer is a 404 that persists nothing. `PUT /patients/:id` false→true
activation establishes exactly one active primary guardian in the same
transaction or returns 409. `POST /patients/:id/deactivate` is idempotent. A
foreign Patient UUID on any command is masked as a byte-equivalent 404.

Guardian reads require `patients.read` and mutations `patients.guardian.manage`.
Linking a foreign Customer is a 404 that persists nothing; promoting a secondary
guardian demotes the current primary first inside one transaction (the
`set-primary` repeat is an idempotent no-op); demoting or deactivating the sole
primary of an active Patient is a 409; deactivation is idempotent and no hard
delete exists. A foreign Patient or guardian UUID is masked as a
byte-equivalent 404. Guardian DTOs are allowlisted and reference the Core
Customer by id only.

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
- `apps/api/src/patients/*` — `patients.service.ts` + Zod/DTO/permissions (WU2);
  `patients.catalog.service.ts` (global taxonomy reads) and
  `patients.controller.ts` (read routes) with `patients.module.ts` registered in
  `app.module.ts` (WU3.2); Patient create/update/deactivate command routes and
  the independent command HTTP suite (WU3.3); `patient-guardians.controller.ts`
  (six guardian routes) plus the independent guardian HTTP suite (WU3.4).
- `apps/api/test/live-pg-isolation.e2e-spec.ts` — EPIC-05 live-PostgreSQL
  application-path block (H1): atomic active create with a primary guardian and
  co-committed audit, activation with/without a primary (200/409),
  byte-identical global catalog for two tenants, byte-equivalent cross-tenant
  `404` for Patient commands / guardian reads+promotion / a foreign
  `primaryGuardianCustomerId`, and a deterministic-barrier concurrency probe
  proving exactly one active primary under two provably overlapping promotions
  (16/16 locally on PG16).
- `apps/web/src/app/(app)/app/patients/*` — staff workspace (WU4): the list
  (`patients-list.tsx`) with client-side name search and deactivate, the shared
  create/edit form (`patient-form.tsx`), and the detail view
  (`[id]/patient-detail.tsx`) with guardian management. The authenticated
  `/api/patients/**` proxy
  (`apps/web/src/app/api/patients/[[...path]]/route.ts`) forwards the session
  cookie and `x-request-id` to the private API. A `Patients` entry was added to
  `components/shell/nav-sidebar.tsx`. The UI is brand-agnostic, uses semantic
  tokens only, and is mounted under the staff `(app)` route group — it never
  renders in the Portal surface.

## Known limitations / blockers

- [[TD-006]] — broader cross-tenant isolation and RBAC live-PostgreSQL gates
  remain open. For Patients specifically, H1 proved the **at-most-one** side
  live under a deterministic barrier that forces two primary promotions to block
  at the same demote boundary before either commits (one `201`, one
  `P2002`-driven `500`, exactly one active primary), plus the
  single-transaction/swap **at-least-one** cases; a wider concurrency matrix is
  still not proven, so concurrency safety must not be reported as
  production-proven.
- [[TD-011]] — under a concurrent primary-promotion race the losing write
  surfaces the partial-index violation as an unmapped `500 INTERNAL`; mapping
  that race to `409 CONFLICT` is the debt. Sequential promotion is a
  demote-then-promote `2xx` swap, and `409` applies to
  sole-primary-removal/deactivation and activation-without-primary cases. The
  invariant is preserved; only the concurrent error surface is wrong.
- The `veterinary` entitlement must be granted explicitly; there is no automatic
  grant (mirrors all capabilities).

## Related

- [[EPIC-05]] Veterinary Patients
- [[Customers]]
- [[Data Classification and Retention]]
- [[Reversals and Corrections]]
- [[TD-006]]
- [[TD-011]]
