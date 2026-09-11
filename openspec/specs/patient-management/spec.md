# patient-management Specification

## Purpose

Tenant-scoped Patient identity and guardian bridge, global seeded Species/Breed
references, active/inactive lifecycle, staff API, audit, and a minimal staff
workspace. Patient and PatientGuardian are tenant-scoped; Species and Breed are
global seeded reference catalogs. This slice supports both an active-create
contract that requires a primary guardian and an inactive-first path; it does
not add an orphan-guardian or multi-step-create workflow. Excludes Clinical,
Scheduling, Weights, Portal, Files, Imports, Patient 360 tabs, and
tenant-specific catalog management.

## Requirements

### Requirement: Tenant-scoped Patient identity and lifecycle

Patient SHALL be tenant-scoped with required `name`, Species, optional Breed,
sex, optional `birthDate`, and `isActive`. Hard delete MUST NOT exist;
deactivation is the only removal, is idempotent, and excludes inactive Patients
from default lists.

#### Scenario: Create active patient

- GIVEN staff with `patients.create` and `veterinary`
- WHEN a valid active Patient is submitted with `primaryGuardianCustomerId`
- THEN it persists with a UUID and, in the same transaction, its active primary
  guardian

#### Scenario: Create inactive patient without guardian

- GIVEN staff with `patients.create` and `veterinary`
- WHEN a valid Patient is submitted with `isActive:false` and no
  `primaryGuardianCustomerId`
- THEN it persists inactive with zero active primary guardians

#### Scenario: Deactivate is the only removal

- GIVEN an active Patient
- WHEN authorized staff deactivate it
- THEN it is inactive and a repeat is idempotent

### Requirement: Global seeded Species and Breed catalogs

Species and Breed SHALL be global, system-seeded reference catalogs, not
tenant-scoped, mirroring `FeatureCode`/`Role`. Each Breed belongs to one global
Species. `Patient.speciesId` MUST reference an existing global Species and
`Patient.breedId` MAY reference one global Breed; both are global foreign keys
and MUST NOT be tenant-filtered. Free-text values SHALL be rejected, and
per-tenant catalog overrides MUST NOT exist.

#### Scenario: Shared global catalog

- GIVEN a globally seeded Species and Breed
- WHEN staff of any tenant create a Patient referencing them
- THEN the references persist and the catalog is not tenant-filtered

#### Scenario: Unknown catalog value rejected

- GIVEN a Species value absent from the global catalog
- WHEN a Patient references it
- THEN the response is 400 `VALIDATION_FAILED`

### Requirement: Customer guardian bridge

`PatientGuardian` SHALL link one Patient to one Core Customer, Veterinary → Core
only. A Patient MAY have multiple guardians; mutations are tenant-scoped and
links MUST NOT be hard-deleted.

#### Scenario: Cross-tenant link rejected

- GIVEN a Customer in tenant B
- WHEN linked to a tenant A Patient
- THEN the response is 404 `NOT_FOUND`

### Requirement: Primary guardian invariant

An active Patient SHALL have exactly one active primary guardian
(`is_primary AND is_active`). "At most one" is enforced immediately by the
non-deferrable partial unique index
`(patient_id) WHERE is_primary AND is_active`; "at least one" is enforced at
commit, against the transaction's final state, by the approved deferred
constraint triggers covering `patient_guardian` writes AND active Patient
lifecycle writes (`INSERT` and `UPDATE` that leave the Patient `is_active`). A
`patient_guardian` `UPDATE` that changes `patient_id` MUST be validated against
BOTH the OLD and the NEW Patient, so reparenting a sole active primary cannot
leave the OLD active Patient without one; an unchanged `patient_id` is validated
once.

Creating an active Patient MUST supply `primaryGuardianCustomerId` and attach
that Customer as the active primary guardian in the same transaction; a lone
active Patient MUST NOT be persisted. A Patient MAY instead be created inactive
without a guardian and activated later only in a transaction that establishes
exactly one active primary. An inactive Patient MAY have zero active primary
guardians — the at-least-one side applies only while the Patient is active — and
deactivating an active Patient is permitted.

A primary swap MUST run in one transaction that demotes the current primary and
then promotes the replacement, so the temporary zero-primary state is resolved
before commit. Primary changes SHALL be audited.

Failure cases: an active Patient `INSERT`, or an `UPDATE` that activates an
inactive Patient, committing with zero active primary guardians is rejected at
COMMIT; demoting the sole active primary while the Patient stays active and
committing without a replacement is rejected; reparenting a sole active primary
guardian to another Patient while the OLD Patient stays active and committing
without establishing a replacement is rejected at COMMIT; a second active
primary violates the partial unique index immediately.

#### Scenario: Transactional creation of active patient with primary guardian

- GIVEN an active Patient and its `primaryGuardianCustomerId` submitted together
- WHEN the write commits in one transaction
- THEN the Patient is active with exactly one active primary guardian

#### Scenario: Active patient with no primary guardian rejected

- GIVEN staff attempt to persist an active Patient without an active primary
  guardian in the transaction
- WHEN the transaction commits
- THEN commit fails (`check_violation`) and no Patient or guardian row persists

#### Scenario: Activation establishes a primary guardian

- GIVEN an inactive Patient with no active primary guardian
- WHEN an activation transaction links a Customer as active primary and sets the
  Patient active
- THEN the Patient is active with exactly one active primary guardian

#### Scenario: Activation requires a primary guardian

- GIVEN an inactive Patient with no active primary guardian
- WHEN a transaction sets it active without establishing exactly one
- THEN commit fails and the Patient remains inactive

#### Scenario: Activation without primary guardian returns conflict

- GIVEN an inactive Patient with no active primary guardian
- WHEN `PUT /patients/:id` activates it without establishing an active primary
- THEN the response is 409 `CONFLICT` and the Patient remains inactive

#### Scenario: Inactive lifecycle allowance

- GIVEN a Patient with no active primary guardian
- WHEN it is created or kept inactive without a guardian, or an active Patient
  is deactivated
- THEN the write is accepted, because the at-least-one side applies only to
  active Patients

#### Scenario: Second active primary rejected at the database boundary

- GIVEN a Patient with an active primary
- WHEN a guardian write attempts to persist a second active primary without
  demoting the current one
- THEN the partial unique index rejects the write immediately and the prior
  primary is unchanged. Sequential promotion through the API is not this case:
  it demotes the current primary and then promotes the replacement (see [Primary
  swap preserves exactly one]).

#### Scenario: Primary swap preserves exactly one

- GIVEN a Patient with an active primary
- WHEN staff swap the primary in one transaction that demotes the current
  primary then promotes the replacement
- THEN the transaction commits with exactly one active primary and the previous
  primary is non-primary

#### Scenario: Zero-primary commit rejected

- GIVEN a Patient with one active primary
- WHEN a transaction demotes the current primary and commits without promoting a
  replacement
- THEN commit fails and no guardian is left primary

#### Scenario: Reparenting a sole primary guardian rejected

- GIVEN an active Patient whose only active primary guardian is its sole primary
- WHEN a transaction reparents that guardian's `patient_id` to another Patient
  and commits
- THEN commit fails (`check_violation`) and the guardian remains linked to the
  original Patient with exactly one active primary

#### Known concurrency limitation

The at-most-one side is atomic; the at-least-one side relies on transactional
ordering plus a deferred constraint and cannot be guaranteed by the partial
index. Live-PostgreSQL concurrency safety is unproven (open TD-006 gap) and MUST
NOT be reported as production-proven.

### Requirement: Permission and entitlement enforcement

Every private route SHALL enforce a `patients.*` permission
(`read/create/update/deactivate`, `guardian.manage`); frontend checks are
UX-only. The service SHALL require `veterinary` via
`entitlements.has(tenantId, "veterinary")`, with no generic feature guard.

#### Scenario: Missing permission denied

- GIVEN staff without `patients.create`
- WHEN a create is submitted
- THEN the response is 403 `FORBIDDEN`

#### Scenario: Missing entitlement denied

- GIVEN staff whose tenant lacks `veterinary`
- WHEN any Patient route is called
- THEN the response is 403 `FEATURE_NOT_ENTITLED`

### Requirement: Allowlisted confidential API and DTOs

Unprefixed tenant-scoped routes SHALL be `GET/POST /patients`,
`GET/PUT /patients/:id`, `POST /patients/:id/deactivate`, and guardians under
`/patients/:patientId/guardians/:id`. Inputs SHALL be Zod-validated; DTOs
allowlisted and CONFIDENTIAL; Prisma models MUST NOT be returned; logs/audit
metadata SHALL carry stable IDs only. The create input SHALL require
`primaryGuardianCustomerId` when the Patient is active (the default) and MAY
omit it only when `isActive:false`; `primaryGuardianCustomerId` MUST NOT appear
in Patient response DTOs, because guardians are read through their own routes.

#### Scenario: Response leaks no internals

- GIVEN a Patient exists
- WHEN returned by the API
- THEN only allowlisted fields are present
- AND a create missing `name` returns 400 `VALIDATION_FAILED`

#### Scenario: Active create without primary guardian rejected

- GIVEN staff with `patients.create`
- WHEN `POST /patients` is submitted active (default) without
  `primaryGuardianCustomerId`
- THEN the response is 400 `VALIDATION_FAILED` and no rows persist

#### Scenario: Inactive create may omit primary guardian

- GIVEN staff with `patients.create`
- WHEN `POST /patients` is submitted with `isActive:false` and no
  `primaryGuardianCustomerId`
- THEN the response is 201 and the allowlisted DTO shows an inactive Patient

### Requirement: Transactional audit

Every Patient/guardian mutation SHALL append exactly one AuditWriter row
co-committed in the same transaction with action, actor id, target id,
requestId, and field diff using stable IDs only. Actions SHALL be
`patient.created|updated|deactivated` and
`patient_guardian.created|updated|deactivated|primary_changed`. A create that
attaches a primary guardian SHALL append `patient.created` and
`patient_guardian.created` in that same transaction; an activation that
establishes a primary SHALL append `patient.updated` plus the corresponding
guardian action.

#### Scenario: Mutation audited

- GIVEN a successful Patient update
- WHEN the audit log is inspected
- THEN exactly one row exists with actor, target, and changed fields

#### Scenario: Atomic create-with-guardian audited

- GIVEN an active Patient created with a primary guardian in one transaction
- WHEN the audit log is inspected
- THEN `patient.created` and `patient_guardian.created` rows share the requestId

### Requirement: Tenant isolation

All tenant-scoped queries SHALL filter by server-resolved tenant context;
cross-tenant Patient, guardian, or Customer UUID access SHALL return
byte-equivalent 404 `NOT_FOUND`. Global Species/Breed catalog reads SHALL NOT be
tenant-filtered and SHALL expose no tenant-private data. A create or activation
whose `primaryGuardianCustomerId` resolves to another tenant's Customer SHALL
return 404 `NOT_FOUND` and persist nothing.

#### Scenario: Cross-tenant read

- GIVEN a Patient in tenant B
- WHEN staff of tenant A request it
- THEN the response is 404 `NOT_FOUND`

#### Scenario: Cross-tenant primary guardian rejected

- GIVEN a Customer in tenant B
- WHEN tenant A creates an active Patient with that Customer as
  `primaryGuardianCustomerId`
- THEN the response is 404 `NOT_FOUND` and no Patient persists

### Requirement: Minimal staff workspace

`/app/patients` SHALL provide list, create, detail, edit, deactivate, and
guardian-management flows via an authenticated `/api/patients/**` proxy and a
staff navigation entry, with loading, empty, error, success, and
permission-denied states. It SHALL be brand-agnostic, use semantic tokens only,
and MUST NOT surface Patient data to the Portal.

#### Scenario: Authorized staff complete the workflow

- GIVEN an authorized, entitled staff member
- WHEN they run the Patient and guardian flows
- THEN each renders loading, empty, error, and success states

### Requirement: Seeded catalogs and synthetic demo data

Global reference seed SHALL create the system-wide Species/Breed catalog
independent of any tenant. Demo seed SHALL create synthetic Patients and
guardian links without real PII.

#### Scenario: Global catalog seeded

- GIVEN a fresh database
- WHEN the global reference seed runs
- THEN Species and Breeds exist without tenant scoping

#### Scenario: Demo populated

- GIVEN the global reference seed has run
- WHEN the demo seed runs for a demo tenant
- THEN at least one Patient and guardian link exist
