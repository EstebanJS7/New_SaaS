---
id: REP-006
type: story
title: The veterinary reports
epic: EPIC-18
status: done
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

- [x] `consultations` counts only `CLOSED` encounters with `amendsEncounterId`
      NULL, and reports amendments separately.
- [x] A `DRAFT` encounter never appears, and an encounter closed outside the
      period does not appear even if it was created inside it.
- [x] `new-patients` counts patients by `created_at` in the period, including
      patients deactivated since.
- [x] `vaccines-due` returns `overdue` (`next_due_at` before today in the tenant
      zone) and `upcoming` (within a bounded horizon) as separate sets.
- [x] A vaccination with a NULL `next_due_at` appears in neither set.
- [x] The same four assertions hold for `deworming-due`.
- [x] The "today" used for overdue/upcoming is resolved in `TENANT_TIME_ZONE`,
      and a test fixes `now` to prove the boundary: due today is **upcoming**,
      due yesterday is **overdue**.
- [x] No response contains `internalNotes`, `diagnosis`, `anamnesis` or any
      clinical free text — asserted structurally.
- [x] All four routes require `reports.read` and are tenant-scoped.
- [x] Tests required by the Story pass.

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

Part 2 — commit `WU-F2`:

- **`GET /reports/vaccines-due` and `GET /reports/deworming-due`** take no
  period: they answer "what is due", not "what happened in a window".
  `horizonDays` is optional, defaults to **30**, must be an integer, and must be
  within **1..365**; the query schema is `.strict()`, so a period key on these
  routes is refused rather than ignored.
- **The horizon runs through the shared helpers and nothing else.**
  `shiftCalendarDays` is now exported from `report.period.ts` precisely so the
  horizon cannot grow a second `+ days * 86400000`. `horizonEndInstant` is the
  start of the tenant day AFTER the horizon, so a due date exactly on the last
  horizon day is INCLUDED.
- **There is deliberately no lower bound.** An overdue vaccination is overdue
  however old, so an unbounded past is correct and the row cap is what keeps it
  honest.
- **Classification compares CALENDAR DATES in the tenant zone, not instants**: a
  due date before `asOfDate` is `overdue`, and `>= asOfDate` is `upcoming` —
  **due today is upcoming, not overdue**. Rows are ordered by `nextDueAt`
  ascending, so overdue comes first and then the soonest upcoming: the order a
  practice works through.
- Patient names resolve in ONE batched tenant-predicated read; a patient the
  read does not return is a loud `INTERNAL` naming the id.
- **The in-memory fixture gained the `clinicalDeworming` delegate that never
  existed**, mirroring `clinicalVaccination`, and `clinicalVaccination.findMany`
  was widened to an optional `patientId` plus a `nextDueAt` filter.

## Verification

```text
pnpm format-check   PASS
pnpm lint           PASS  (23/23 turbo tasks)
pnpm typecheck      PASS  (23/23)
pnpm build          PASS  (13/13)
pnpm test           PASS  (23/23)
  api        111 files (108 landed + 3 new)      1588 passed | 266 skipped  (+68)
  database    30 files                            549 passed
  web        110 files                           1164 passed
```

68 new tests across both halves: 25 for the due reports (the boundary triad, the
calendar-date comparison, the half-open horizon, the refusals, the caps, the
permission ordering, the structural key sets and forbidden-field scan) and 12
integration (the echoes, the row-level predicate proof per report, the refusals
and tenant isolation), plus part 1's 31.

**All four queries were proven against real PostgreSQL.** For
`now = 2026-10-19T12:00Z` in `America/Asuncion`, with `horizonDays` omitted:

```text
asOfDate: 2026-10-19  horizonDays: 30  horizonEndDate: 2026-11-18
horizonEndInstant: 2026-11-19T03:00:00.000Z   (half-open, local midnight after)

vaccinations read: 3   (the +31-day row and the NULL row are excluded)
  Rabies      due 2026-10-18 -> OVERDUE
  Distemper   due 2026-10-19 -> UPCOMING   <- due TODAY is upcoming
  Leptospira  due 2026-11-18 -> UPCOMING   <- exactly on the horizon, included
  overdueCount 1  upcomingCount 2
  keys read: administeredAt,id,nextDueAt,patientId,vaccine

deworming Praziquantel due 2026-10-10 -> OVERDUE
```

The three due dates are deliberately one day apart around the boundary, because
that is the only way to show that `due today` is upcoming while `due yesterday`
is already overdue — the semantic [[DEC-065]] chose and the one a naive `<`
comparison gets wrong.

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

- **Both due reports are empty until a staff due date exists.** That surface is
  [[REP-010]] ([[DEC-067]]); until it lands, a due date can only be set through
  the API. The reports are correct and ready, not broken.
- Three other clinical record kinds (treatments, studies, weights) remain
  API-only; [[TD-055]] tracks them and was narrowed by [[DEC-067]].
- The due read has no lower bound by design, so a tenant with years of unhandled
  overdue records will hit the 10 000-row cap rather than receive a partial
  list. That is the honest failure: a truncated due list would look like a
  complete one.
- The integration suite cannot pin `asOfDate` (the app uses the real clock), so
  it asserts the value is one of the two tenant dates sampled around the request
  — exact, but not a fixed literal.
- `horizonDays` uses TWO refusal messages, not four: a non-integer gets the
  shape message, and `0`, a negative and `366` share the range message.

## Technical Debt

- [[TD-055]] — the three clinical record kinds still without a staff surface.
- [[TD-053]] — report query performance beyond directed indexes.

## Decisions / ADRs

- [[DEC-062]], [[DEC-063]], [[DEC-065]].

## Files / Modules

- `apps/api/src/reporting/` — four service methods, four repository queries,
  four routes, their DTOs
- `docs/05-modules/Reporting.md`

## Completion Notes

Part 1 gates passed on 2026-10-19; the Story stays `in-progress` until part 2
lands.
