---
id: REP-006
type: story
title: The veterinary reports
epic: EPIC-18
status: in-progress
priority: medium
depends_on:
  - REP-002
prd_sections:
  - "12"
  - "31"
permissions:
  - reports.read
branch: feat/epic-18-dashboards-reports
created: 2026-10-19
updated: 2026-10-19
---

# REP-006 — The veterinary reports

## Objective

Answer the four questions the clinical record exists to answer over time: how
many consultations the practice closed, how many patients it gained, which
vaccines are coming due or overdue, and which deworming treatments are coming
due.

## Context

This is the Story whose scope the PRD assumed and the schema did not support.
Until [[REP-001]], `clinical_vaccination` and `clinical_deworming` stored only
`administered_at` — a date in the past — so "upcoming" and "overdue" were not
computable at any precision. [[DEC-065]] added a nullable staff-entered
`next_due_at` to both, and re-ran the reasoning explicitly: **the veterinarian
knows the booster interval, the system does not.** Consequently neither due
report is a projection of a protocol; it is a filter over a date a human
entered.

Consultations are `ClinicalEncounter`. Its `closedAt` already exists, and a
closed encounter is immutable — an amendment is a **new** closed row pointing at
the original (`amendsEncounterId`). A consultation count must therefore decide,
in writing, whether an amendment is a second consultation. It is not: an
amendment corrects one, so the count excludes rows with a non-NULL
`amendsEncounterId` and a separate figure reports the amendments. Reporting them
as two consultations would inflate the practice's activity.

New patients is `patient.created_at`. `Patient` deactivation is soft, so a
patient created and later deactivated still counts as new in its period — the
fact happened.

Privacy matters here in a way the finance reports do not: `Patient.name` and
`birthDate` are CONFIDENTIAL and `ClinicalEncounter.internalNotes` is
RESTRICTED. The due reports name patients because the staff must act on them,
but they expose no clinical content and no internal notes.

## In Scope

- `GET /reports/consultations` — closed encounters in the period, excluding
  amendments, with an amendments count reported separately.
- `GET /reports/new-patients` — patients created in the period.
- `GET /reports/vaccines-due` — vaccinations with a non-NULL `next_due_at`,
  split into `overdue` and `upcoming` against today in the tenant zone, with a
  bounded upcoming horizon.
- `GET /reports/deworming-due` — the same shape over `clinical_deworming`.
- All four under `reports.read`, tenant-scoped, period from [[REP-002]] where a
  period applies.

## Out of Scope

- Any protocol, interval or schedule table. [[DEC-065]] rejected it.
- Clinical content in any report: no `internalNotes`, no `diagnosis`, no
  `anamnesis`. The due reports carry patient identity and dates only.
- Species/breed breakdowns beyond what a patient row carries; a species
  dimension would need a join the reports do not require.
- Notifying anybody. A due vaccine report does not enqueue a reminder; the
  reminder mechanism (`AppointmentReminder`) belongs to scheduling, not to
  vaccination, and connecting them is a product decision nobody made.
- CSV. [[REP-007]].

## Acceptance Criteria

- [ ] `consultations` counts only `CLOSED` encounters with `amendsEncounterId`
      NULL, and reports amendments separately.
- [ ] A `DRAFT` encounter never appears, and an encounter closed outside the
      period does not appear even if it was created inside it.
- [ ] `new-patients` counts patients by `created_at` in the period, including
      patients deactivated since.
- [ ] `vaccines-due` returns `overdue` (`next_due_at` before today in the tenant
      zone) and `upcoming` (within a bounded horizon) as separate sets.
- [ ] A vaccination with a NULL `next_due_at` appears in neither set.
- [ ] The same four assertions hold for `deworming-due`.
- [ ] The "today" used for overdue/upcoming is resolved in `TENANT_TIME_ZONE`,
      and a test fixes `now` to prove the boundary: due today is **upcoming**,
      due yesterday is **overdue**.
- [ ] No response contains `internalNotes`, `diagnosis`, `anamnesis` or any
      clinical free text — asserted structurally.
- [ ] All four routes require `reports.read` and are tenant-scoped.
- [ ] Tests required by the Story pass.

## Domain Invariants

- A closed encounter is immutable; the report never implies otherwise.
- An amendment is a correction, not an additional consultation.
- Clinical free text never leaves the API through a report.
- Patient identity is CONFIDENTIAL: the report carries the minimum needed to act
  on it, and it is never exposed on the portal surface.

## API

### Added

```text
GET /reports/consultations?period=…|from=&to=
  -> 200 { report, period, consultationCount, amendmentCount,
           rows: [ { bucketDate, consultationCount } ] }

GET /reports/new-patients?period=…|from=&to=
  -> 200 { report, period, newPatientCount, rows: [ { bucketDate, count } ] }

GET /reports/vaccines-due?horizonDays=
  -> 200 { report, asOfDate, timeZone, horizonDays,
           overdueCount, upcomingCount,
           rows: [ { patientId, patientName, vaccine, administeredAt,
                     nextDueAt, status: "upcoming" | "overdue" } ] }

GET /reports/deworming-due?horizonDays=
  -> 200 { report, asOfDate, timeZone, horizonDays,
           overdueCount, upcomingCount,
           rows: [ { patientId, patientName, product, administeredAt,
                     nextDueAt, status: "upcoming" | "overdue" } ] }

  -> 400 the four REPORTS_PERIOD_* codes, plus REPORTS_HORIZON_INVALID
  -> 403 missing reports.read
```

### Changed

```text
None
```

## Database

### Migration

```text
None — REP-001 added the two next_due_at columns and their indexes.
```

### Models/Tables

- Reads `clinical_encounter` (`status`, `closed_at`, `amends_encounter_id`),
  `clinical_vaccination`, `clinical_deworming` (`next_due_at`,
  `administered_at`), `patient` (`name`, `created_at`).

## UI

- None. Consumed by [[REP-008]].

## Implementation Summary

**Part 1 implemented (consultations and new patients); part 2 (the two due
reports) pending.** Part 2 is a separate work unit because it needs a
`clinicalDeworming` fixture delegate that does not exist yet.

Part 1 — commit `WU-F1`:

- **`GET /reports/consultations`** reads `CLOSED` encounters by `closedAt` with
  a MINIMAL `select` — `id`, `closedAt`, `amendsEncounterId` and nothing else.
  No `internalNotes`, `diagnosis`, `anamnesis`, `treatmentPlan`,
  `reasonForVisit` or `clientSummary` is ever read, let alone returned, and a
  test asserts the response type and the runtime key set carry none of them.
  `internalNotes` is RESTRICTED and a staff-only aggregate has no reason to
  touch it.
- **An amendment is not a second consultation.** A `CLOSED` row with a non-NULL
  `amendsEncounterId` is a correction of an earlier encounter (the original is
  never mutated); it is counted in `amendmentCount` and skipped, so it
  contributes to neither `consultationCount` nor the daily buckets. Both figures
  come from ONE read over the same half-open range, so they cannot disagree at a
  boundary.
- **`GET /reports/new-patients`** reads `Patient.createdAt` with a minimal
  select, and **soft deactivation does not unfact a registration**: a patient
  created in the period and deactivated since still counts. The `where`
  deliberately has no `isActive`.
- Both bucket by the LOCAL calendar day through the shared `tenantCalendarDate`
  helper, ascending, so there is no second day-boundary implementation.
- Caps: 20 000 closed encounters (amendments share the read) and 10 000 new
  patients, each refusing rather than truncating.

Part 2 is not started.

## Verification

```text
pnpm format-check   PASS
pnpm lint           PASS  (23/23 turbo tasks)
pnpm typecheck      PASS  (23/23)
pnpm build          PASS  (13/13)
pnpm test           PASS  (23/23)
  api        110 files (108 landed + 2 new)      1551 passed | 266 skipped  (+31)
  database    30 files                            549 passed
  web        110 files                           1164 passed
```

Part 1 adds 31 tests: 18 service and 13 integration, covering the
amendment-versus-consultation separation, the local-day bucket, the `DRAFT` and
cross-period exclusions, the deactivated patient, both caps,
permission-before-any- read, the forbidden-field scan, and tenant isolation for
both reports.

**Both queries were also proven against real PostgreSQL.** For the period
`[2026-06-01T03:00Z, 2026-06-11T03:00Z)` in `America/Asuncion`, with two
consultations, one amendment, one `DRAFT`, one encounter closed outside the
period and three patients (one deactivated):

```text
consultations read: 3   (the DRAFT and the 2026-06-25 CLOSED are excluded)
  consultationCount 2   amendmentCount 1
  buckets: 2026-06-05=1  2026-06-10=1
  the 2026-06-11T02:00Z encounter bucketed to 2026-06-10  (NOT 06-11)
  keys read: amendsEncounterId,closedAt,id

new-patients count: 2   (Michi is DEACTIVATED and still counted)
  buckets: 2026-06-03=1  2026-06-09=1
```

`keys read` is the interesting line: it is the actual Prisma projection, so the
absence of clinical free text is demonstrated rather than asserted. And the
`02:00Z` → `06-10` bucket is the tenant-zone rule holding on real rows, three
hours away from the UTC day.

Seeding those rows also surfaced real database invariants the fixture does not
model: a patient must carry exactly one active primary guardian (checked by a
deferred constraint, so the patient and its guardian must be inserted in one
transaction), and `customer_kind` accepts only `INDIVIDUAL`/`COMPANY`.

## Tests Added

- Unit: an amendment is excluded from the count and counted as an amendment.
- Unit: a DRAFT encounter excluded; an encounter created inside and closed
  outside the period excluded.
- Unit: a patient created then deactivated still counted.
- Unit: the due boundary — due today is upcoming, yesterday is overdue, and a
  row with a NULL due date is in neither.
- Unit: the horizon bound refuses an invalid `horizonDays`.
- Unit: structural — no clinical free-text field appears in any response type.
- Integration: the four routes — 403, 400 on malformed input, 200 with seeded
  data.
- Tenant isolation: a second tenant's encounters, patients and clinical records
  never cross.

## Known Limitations

- **The `clinicalDeworming` delegate does not exist in the in-memory fixture**,
  so part 2 must add it (mirroring `clinicalVaccination`) before the deworming
  due report can be exercised through `bootTestApp()`. Recorded here so it is
  not discovered mid-unit.
- The fixture did not carry `amendsEncounterId` on `ClinicalEncounterRow` at
  all, although the real column exists and the fake returns the full row.
  Without that widening `undefined !== null` would have won and EVERY
  consultation would have counted as an amendment — a false green in the most
  important assertion of this unit. It is now on the row type and on the
  mirrored `create`.
- Both due reports stay empty until a staff due date exists; [[REP-010]] builds
  that surface ([[DEC-067]]), and [[TD-055]] records that three other record
  kinds remain API-only.

## Technical Debt

- [[TD-053]].
- A vaccine-due notification is not created. Whether vaccination should feed the
  notification mechanism is recorded as an open product question rather than
  implemented here.

## Decisions / ADRs

- [[DEC-062]], [[DEC-063]], [[DEC-065]].

## Files / Modules

- `apps/api/src/reporting/` — four service methods, four repository queries,
  four routes, their DTOs
- `docs/05-modules/Reporting.md`

## Completion Notes

Part 1 gates passed on 2026-10-19; the Story stays `in-progress` until part 2
lands.
