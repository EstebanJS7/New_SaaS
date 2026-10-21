---
id: IMP-004
type: story
title: The patient preview and commit
epic: EPIC-19
status: planned
priority: high
depends_on:
  - IMP-003
prd_sections:
  - "32"
permissions:
  - imports.run
branch: feat/epic-19-imports
created: 2026-10-19
updated: 2026-10-19
---

# IMP-004 — The patient preview and commit

## Objective

The same pipeline over patients, with the one thing that makes it harder: every
patient needs an owner, and the owner must already exist.

## Context

A patient cannot exist without exactly one active primary guardian, enforced by
a deferred constraint trigger. [[DEC-070]] decided the file references an
existing customer and an unresolved reference is a row error — which maps
exactly onto the existing contract: `createPatientBody` accepts
`primaryGuardianCustomerId` and `PatientsService.create` creates patient,
guardian link and both audit rows in one transaction.

Verified patient contract: `name` (1..200), `speciesId` (UUID), `sex`
(`MALE`/`FEMALE`/`UNKNOWN`) required; `breedId`, `birthDate`, `isActive`
optional; `primaryGuardianCustomerId` required unless the patient is created
inactive. `species`/`breed` are global catalogs, resolved by id, validated by
`assertGlobalCatalog`.

## In Scope

- The patient column map, resolving `species` and `breed` from a human-typed
  value to the global catalog id, refusing an unknown one by name.
- The guardian reference: resolved against the tenant's customers by document
  number or by contact value. Unresolved is a row error naming the reference.
- Validation through `createPatientBody`, imported.
- The commit through `PatientsService.create`, per-row transaction, so the
  deferred guardian trigger is satisfied by the same path a manual entry uses.
- Everything else the customer pipeline already has: the counters, the summary,
  the replay, the zero-valid refusal.

## Out of Scope

- Creating a customer from a patient row ([[DEC-070]]).
- Patients created inactive: the file describes a live pet; an inactive patient
  would sidestep the guardian requirement for a record that then cannot be used.
- Any other entity.

## Acceptance Criteria

- [ ] A patient row whose guardian reference does not resolve is a row ERROR and
      creates nothing — asserted by counting patients, guardians and customers.
- [ ] A resolved reference is used as the PRIMARY guardian, `isPrimary = true`,
      and the patient, the link and both audit rows land in one transaction.
- [ ] `species` and `breed` resolve from the file's value to the global catalog;
      an unknown value is a row error naming it.
- [ ] The deferred `patient_exactly_one_primary_guardian` trigger is never
      violated: a committed patient always has exactly one active primary
      guardian.
- [ ] Validation uses `createPatientBody`, imported, and a test asserts the
      import did not declare a second copy of any rule.
- [ ] The partial-commit semantics of [[IMP-003]] hold identically, with the
      same summary shape.
- [ ] Tenant isolation: a guardian reference pointing at another tenant's
      customer is an unresolved reference, never a cross-tenant link.
- [ ] Tests required by the Story pass.

## Domain Invariants

- A patient is never created without its guardian.
- The species/breed catalogs are global and read-only here.
- A cross-tenant reference resolves to nothing, which is a `404`-shaped row
  error.

## API

### Added

```text
None new — the same preview/commit/summary routes are parameterised by entity.
```

### Changed

```text
GET  /imports          gains the entity filter
```

## Database

### Migration

```text
None.
```

### Models/Tables

- `patient`, `patient_guardian`, `species`, `breed`, `customer` (read for
  resolution), `audit_log` — all through the owning service.

## UI

- None. Consumed by [[IMP-005]].

## Implementation Summary

_Not implemented._

## Verification

```text
Not run.
```

## Tests Added

- An unresolved reference creates nothing at all.
- A resolved reference produces exactly one active primary guardian.
- Catalog resolution: by code and by name, and an unknown value refused.
- A cross-tenant reference is unresolved.
- The partial-commit semantics re-asserted for this entity.

## Known Limitations

- To be recorded as implemented.

## Technical Debt

- [[TD-058]].

## Decisions / ADRs

- [[DEC-070]], [[DEC-071]].

## Files / Modules

- `apps/api/src/imports/`
- `apps/api/src/patients/` — called, not modified
- `docs/05-modules/Imports.md`

## Completion Notes

_Status must remain non-done until all required gates pass._
