---
id: IMP-004
type: story
title: The patient preview and commit
epic: EPIC-19
status: done
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

- [x] A patient row whose guardian reference does not resolve is a row ERROR and
      creates nothing — asserted by counting patients, guardians and customers.
- [x] A resolved reference is used as the PRIMARY guardian, `isPrimary = true`,
      and the patient, the link and both audit rows land in one transaction.
- [x] `species` and `breed` resolve from the file's value to the global catalog;
      an unknown value is a row error naming it.
- [x] The deferred `patient_exactly_one_primary_guardian` trigger is never
      violated: a committed patient always has exactly one active primary
      guardian.
- [x] Validation uses `createPatientBody`, imported, and a test asserts the
      import did not declare a second copy of any rule.
- [x] The partial-commit semantics of [[IMP-003]] hold identically, with the
      same summary shape.
- [x] Tenant isolation: a guardian reference pointing at another tenant's
      customer is an unresolved reference, never a cross-tenant link.
- [x] Tests required by the Story pass.

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

Implemented on `feat/epic-19-imports`.

- **The pipeline was generalised, not duplicated.** `runImportPreview` and
  `runImportCommit` now take an entity PLANNER; the claim-first ordering, the
  partial-success loop and the bounded reasons exist once. A test runs BOTH
  entities through both functions and then reads the runners' sources to assert
  they name no entity — so the sharing is proved rather than asserted.
- The header resolver was extracted to `columns.ts` and the patient contract
  REUSES it rather than restating the three file-level refusals.
- **The patient column contract**: `name`, `species`, `sex` required; `breed`
  and `birth_date` optional; and **exactly one** of `guardian_document` /
  `guardian_phone` / `guardian_email`. None is a row error, two is a row error
  (the import must not guess which customer owns the pet), and each unresolved
  reference has its own code naming the column and never the value.
- Species and breed resolve against the GLOBAL catalog by `code` first and then
  by `name`, case-insensitively; a breed outside the resolved species is its own
  row error. `sex` IS case-folded (`male` → `MALE`), which differs from `kind`
  deliberately: the three sexes are a closed domain vocabulary, while a customer
  kind is a discriminator whose case-fold would make the import accept a value
  `POST /customers` rejects.
- `birth_date` is a calendar date pinned to **noon UTC**, the clinical surface's
  convention, so the tenant-local date equals the date typed whatever the
  browser's zone. Calendar-impossible dates are refused without echoing the
  value.
- Validation goes through **`createPatientBody` imported from
  `@newsaas/patients`**; a test reads all five patient modules and asserts no
  `z.*`, no local bounds, no literal enum and no `zod` dependency.
- `createPatient` is called with `primaryGuardianCustomerId`, so the deferred
  `patient_exactly_one_primary_guardian` trigger is satisfied by the same
  transaction a manual entry uses. A patient row that cannot link its guardian
  rolls back whole.
- **`GET /imports` gained the `entity` filter** the Story's API section
  promised, which the shipped list query had been refusing as an unknown key.
- The API's `PATIENT` refusal was removed from both phase triggers, and the
  message constant deleted rather than left dead.

## Verification

```text
pnpm format-check   PASS
pnpm lint           PASS  (29/29 turbo tasks)
pnpm typecheck      PASS  (29/29)
pnpm build          PASS  (16/16)
pnpm test           PASS  (29/29)
  imports        13 files  132 tests  (+47)
  worker         20 files  282 tests  (+6)
  api           120 files  1760 passed | 266 skipped  (+2)
  customers       1 file     9 tests   UNCHANGED
  patients        1 file     8 tests   UNCHANGED
  web           118 files  1282 passed
live PostgreSQL                     266/266
```

`customers` and `patients` unchanged is the point: generalising the runners was
a refactor, and their existing suites are the evidence that the customer path
still behaves the same.

## Tests Added

- An unresolved reference creates nothing at all.
- A resolved reference produces exactly one active primary guardian.
- Catalog resolution: by code and by name, and an unknown value refused.
- A cross-tenant reference is unresolved.
- The partial-commit semantics re-asserted for this entity.

## Known Limitations

- **Patient rows always report `suspectedDuplicate: false`.** There is no
  patient heuristic because there is no natural key for a pet — two animals of
  the same name belonging to the same owner are legitimately two records. The
  outcome table, the summary and the queue contract are untouched by that.
- **Guardian resolution matches the stored value exactly** (trimmed), first row
  by `createdAt` on a tie, because a document number is not unique. It
  deliberately ignores `isActive`, to stay no stricter than `createPatient`'s
  own `assertTenantCustomer`.
- **A `PATIENT` commit reads the artefact before the zero-accepted-rows check**,
  because the patient payload planner is a synchronous function of the text and
  its guardian prefetch needs that text. The outcome is unchanged; a refused
  patient file costs one object-store read the customer path would skip.
- `is_active` is deliberately NOT a column: the import creates ACTIVE patients,
  which is what makes the guardian reference mandatory. A file carrying
  `is_active` is refused as an unknown header, so it cannot deactivate anybody.
- [[TD-056]] still applies: the in-memory boundary cannot prove `take`
  enforcement, so the caps remain proven at service level.

## Technical Debt

- [[TD-057]] — XLSX.
- [[TD-058]] — the artefact's retention has no approved policy behind it.
- [[TD-059]] — no contact format validation anywhere in the product.
- [[TD-056]] — the in-memory boundary cannot prove `take` enforcement.

## Decisions / ADRs

- [[DEC-070]], [[DEC-071]].

## Files / Modules

- `apps/api/src/imports/`
- `apps/api/src/patients/` — called, not modified
- `docs/05-modules/Imports.md`

## Completion Notes

All required gates passed on 2026-10-19, including the live-PostgreSQL lane.
