# clinical-management Specification

## Purpose

Tenant-scoped clinical records for veterinary staff: `ClinicalEncounter`
(structured content plus free-form `internalNotes`/`clientSummary`) and typed
subdomain records for treatments, vaccinations, deworming, studies, and weights.
DRAFT encounters autosave under optimistic concurrency; CLOSED encounters are
immutable and corrected only through linked, audited amendments. Excludes
Scheduling/appointment linkage, Portal, files, reports, billing, fiscal,
notifications, hard deletion, generic EAV, branch scoping, and Patient 360
redesign. Forward dependencies MUST remain deferred and no unused internal events
SHALL be emitted.

## Requirements

### Requirement: Encounter lifecycle and content

`ClinicalEncounter` SHALL belong to one tenant and one Patient and SHALL start
in `DRAFT`. DRAFT encounters SHALL be editable and autosaved and SHALL capture
structured clinical content with separate free-form `internalNotes` and
`clientSummary`. Closing SHALL be an explicit, audited, version-guarded
transition to `CLOSED`. CLOSED encounters SHALL be immutable and MUST NOT be
hard-deleted. Closing MUST NOT depend on Scheduling, Portal, files, reports, or
billing.

#### Scenario: Create draft encounter

- GIVEN staff with `vet.clinical.create` and the `veterinary` entitlement
- WHEN they create an encounter for an in-tenant Patient
- THEN it persists as `DRAFT` with the Patient link and an initial version

#### Scenario: Closed encounter is immutable

- GIVEN a `CLOSED` encounter
- WHEN any update or close is attempted
- THEN the response is 409 `CONFLICT` and the stored content is unchanged

### Requirement: Clinical subdomain records

The system SHALL persist five tenant-scoped clinical record kinds anchored to a
Patient: treatments, vaccinations, deworming, studies, and weights. Each SHALL
capture its minimum clinical facts, be created under `vet.clinical.create`,
updated under `vet.clinical.update`, and MUST NOT be hard-deleted.

| Kind | Minimum facts |
|------|---------------|
| Treatment | description, administration date/context |
| Vaccination | vaccine reference, administered date |
| Deworming | product, administered date |
| Study | study type, performed date, result |
| Weight | measured quantity (Decimal), measured date |

#### Scenario: Record a vaccination

- GIVEN an in-tenant Patient and staff with `vet.clinical.create`
- WHEN a vaccination is recorded with its required facts
- THEN it persists tenant-scoped and linked to the Patient

#### Scenario: Invalid weight rejected

- GIVEN a weight submission with a non-positive or non-numeric quantity
- WHEN validated
- THEN the response is 400 `VALIDATION_FAILED` and nothing persists

### Requirement: Versioned draft autosave

DRAFT autosave SHALL use an explicit version guard. A write whose submitted
version is not the current stored version MUST persist nothing and SHALL return a
clinical-scoped 409 `CONFLICT`; a successful write SHALL advance the version.

#### Scenario: Successful autosave

- GIVEN a DRAFT encounter at version N with no concurrent change
- WHEN autosave submits version N
- THEN the content is stored and the version becomes N+1

#### Scenario: Stale autosave conflict

- GIVEN a DRAFT encounter advanced to version N+1 by another writer
- WHEN autosave submits version N
- THEN the response is 409 `CONFLICT`, the newer content is preserved, and
  nothing is overwritten

### Requirement: Linked audited amendments

A CLOSED encounter SHALL be correctable only through an explicit amendment that
creates a new record linked to the original, preserves the prior state, records a
reason, and requires `vet.clinical.amend`. An amendment SHALL be audited and
SHOULD be idempotent for a repeated request.

#### Scenario: Amend a closed encounter

- GIVEN a `CLOSED` encounter and staff with `vet.clinical.amend`
- WHEN they submit an amendment with a reason
- THEN a linked amendment preserving prior state is created and audited
- AND the original remains unchanged

#### Scenario: Amendment without permission

- GIVEN staff without `vet.clinical.amend`
- WHEN an amendment is submitted
- THEN the response is 403 `FORBIDDEN` and nothing persists

#### Scenario: Amendment without reason

- GIVEN staff with `vet.clinical.amend`
- WHEN an amendment omits a reason
- THEN the response is 400 `VALIDATION_FAILED`

### Requirement: Granular authorization and entitlement

Every clinical route SHALL enforce a granular permission — `vet.clinical.read`,
`vet.clinical.create`, `vet.clinical.update`, `vet.clinical.close`,
`vet.clinical.amend` — and the service SHALL require the `veterinary`
entitlement. Frontend checks are UX-only.

#### Scenario: Missing permission

- GIVEN staff without the required `vet.clinical.*` permission
- WHEN the route is called
- THEN the response is 403 `FORBIDDEN`

#### Scenario: Missing entitlement

- GIVEN staff whose tenant lacks `veterinary`
- WHEN any clinical route is called
- THEN the response is 403 `FEATURE_NOT_ENTITLED`

### Requirement: Tenant isolation

All clinical reads and writes SHALL use the server-resolved tenant context. A
clinical record or Patient UUID from another tenant SHALL return a byte-equivalent
404 `NOT_FOUND` and persist nothing.

#### Scenario: Cross-tenant access

- GIVEN a clinical record in tenant B
- WHEN tenant A staff request it, or reference tenant B's Patient in a create
- THEN the response is 404 `NOT_FOUND` and nothing persists

### Requirement: Confidential allowlisted API

Clinical DTOs SHALL be allowlisted and classified CONFIDENTIAL; Prisma models
MUST NOT be returned. Logs and audit metadata SHALL carry stable IDs only.
`internalNotes` MUST NOT appear in any client-safe projection or the Portal, and
clinical free text MUST NOT be logged.

#### Scenario: Response leaks no internals

- GIVEN a clinical record exists
- WHEN the staff API returns it
- THEN only allowlisted fields are present
- AND `internalNotes` is excluded from client-safe projections

### Requirement: Transactional audit

Every clinical mutation, close, and amendment SHALL append exactly one
AuditWriter row co-committed in the same transaction, carrying action, actor id,
target id, requestId, and field diff using stable IDs only.

#### Scenario: Close audited atomically

- GIVEN an authorized close
- WHEN the audit log is inspected
- THEN exactly one co-committed row records the actor, target, and transition

### Requirement: Staff workspace

A clinical workspace SHALL be reachable from the existing Patient detail surface
through an authenticated proxy, with loading, empty, error, success, and
permission-denied states. It SHALL be brand-agnostic, use semantic tokens only,
and MUST NOT expose clinical data to the Portal.

#### Scenario: Authorized staff workflow

- GIVEN authorized, entitled staff on a Patient detail page
- WHEN they use the clinical workspace
- THEN draft edit/autosave, close, and amendment flows render their states

### Requirement: Synthetic demo data

Demo seed SHALL create synthetic encounters and subdomain records without real
PII.

#### Scenario: Demo populated

- GIVEN a demo tenant with Patients
- WHEN the demo seed runs
- THEN at least one encounter and one subdomain record exist
