---
id: REP-010
type: story
title: The clinical record entry surface — vaccinations and deworming
epic: EPIC-18
status: done
priority: medium
depends_on:
  - REP-006
prd_sections:
  - "12"
  - "31"
permissions:
  - vet.clinical.read
  - vet.clinical.create
  - vet.clinical.update
branch: feat/epic-18-dashboards-reports
created: 2026-10-19
updated: 2026-10-19
---

# REP-010 — The clinical record entry surface

## Objective

Give staff somewhere to record a vaccination and a deworming treatment, with
their due dates — so the two due reports [[REP-006]] ships have something to
read, and a wrong due date can be corrected or removed.

## Context

[[REP-001]] added `next_due_at` to both clinical record tables and accepted it
in the API. It could not add a form field because **no form existed**: the staff
clinical workspace handles encounters only, and the five specialized record
kinds are API-only on the staff surface ([[TD-055]]).

That left PRD §31's "upcoming/overdue vaccines" and "upcoming deworming"
computable and permanently empty. [[DEC-067]] decided this epic owns the entry
path for the field it introduced, narrowly.

The cost estimate is what makes this a Story rather than an epic, and every item
in it was verified rather than assumed:

```text
already exists, unused    apps/web/src/app/api/clinical/[[...path]]/route.ts
                          allowlists vaccinations and deworming with
                          GET/POST and PUT on :id  — ZERO proxy work
already exists, granted   vet.clinical.read / create / update in
                          PERMISSION_SEEDS and ROLE_PERMISSION_MATRIX
                          — ZERO permission work
already exists, tested    the API routes, their zod validation, their audit rows
                          and their tenant isolation  — ZERO backend work
missing                   clinical-api.ts carries only the five ENCOUNTER
                          functions; there is no UI section
```

So this is the first Story in the epic with no backend change at all.

## In Scope

- `clinical-api.ts` gains the client functions for both kinds, mirroring the
  existing encounter functions exactly: list, create, and update (including the
  explicit `null` that CLEARS a due date).
- A UI section in the patient clinical workspace listing a patient's
  vaccinations and deworming treatments, with a create form and per-row
  correction.
- Server-supplied validation errors surfaced verbatim, and the existing
  permission-denied handling reused rather than re-invented.
- Loading, empty, error, success and permission-denied states for both lists.
- Web unit tests for the client functions and the section.

## Out of Scope

- **Treatments, studies and weights.** API-only, read by no report this epic
  delivers. They remain [[TD-055]], narrowed from five kinds to three.
- **Any backend, proxy, permission or schema change.** All of it exists.
- Any new page or route: the section lives inside the existing patient
  workspace.
- Encounter behaviour — draft, close, amend — which REP-001's predecessor
  stories already delivered and this Story does not touch.
- Portal exposure. The portal's read-only view already exists and [[DEC-008]]
  keeps the identities separate.

## Acceptance Criteria

- [x] `clinical-api.ts` exposes list, create and update for vaccinations and for
      deworming, mirroring the encounter functions' error handling.
- [x] The workspace lists a patient's vaccinations and deworming treatments,
      each with its administered date and its due date when set.
- [x] A vaccination and a deworming treatment can be created with an optional
      due date, and the created row appears without a manual reload.
- [x] An existing due date can be CORRECTED, and can be REMOVED with an explicit
      `null` — the same contract the API accepts, exercised through the UI.
- [x] A `400` from the server is surfaced with its message rather than a generic
      failure, and a `409` is distinguishable from a validation error.
- [x] The section renders loading, empty, error, success and permission-denied
      states, using semantic branding tokens only — no literal brand colour,
      radius or font.
- [x] A caller without `vet.clinical.create` sees the lists but not the create
      action; the backend remains authoritative and still refuses.
- [x] No tenant, patient or permission authority is taken from the URL or the
      body.
- [x] Required loading/error/empty/success UX exists.
- [x] Required audit exists — the API already co-commits one audit row per
      mutation; this Story writes none of its own and asserts none is
      duplicated.
- [x] Tests required by the Story pass.

## Domain Invariants

- The UI computes nothing. Dates and identities come from the API; the client
  never derives a due date, and never assumes a booster interval.
- An empty due date is a real state (`null`), never a zero or a placeholder date
  — [[DEC-065]] made NULL mean "not monitored" and the form must not fabricate
  one.
- Clearing a due date sends an explicit `null`, not an empty string.
- Permission checks in the UI are UX only. The API re-asserts `vet.clinical.*`
  and a cross-tenant patient is a `404`.
- No clinical free text is logged.

## API

### Added

```text
None — the API already exposes every route this Story consumes.
```

### Changed

```text
None.
```

## Database

### Migration

```text
None.
```

### Models/Tables

- None written. Consumes `clinical_vaccination` and `clinical_deworming` through
  existing routes.

## UI

- The patient clinical workspace gains a records section for vaccinations and
  deworming: a list with administered and due dates, a create form with an
  optional due date, and per-row correction including removal of the due date.
- Semantic branding tokens only; the surface-integrity test covers the new
  files.
- Each empty list explains itself rather than rendering a blank panel.

## Implementation Summary

Implemented on `feat/epic-18-dashboards-reports`. **No backend, proxy,
permission or schema change** — the API routes, the BFF allowlist and
`vet.clinical.*` all already shipped in EPIC-06 and were simply never consumed
by a staff screen.

- **`clinical-api.ts`** gains `ClinicalVaccination`/`ClinicalDeworming` and the
  list/create/update trio for each, mirroring the encounter functions' helpers
  and error mapping. The update input's `nextDueAt` accepts an explicit `null`,
  which is the documented way to remove a wrong due date.
- **`clinical-records.tsx`** renders two sections in the existing patient
  workspace (vaccinations, deworming): a list of administered and due instants,
  a create form, per-row correction, and an explicit remove-the-due-date
  control. An absent due date renders as the sentence "No due date recorded"
  rather than a blank or a dash, because [[DEC-065]] made NULL a real state and
  the due reports depend on distinguishing it from a date.
- **Clearing sends exactly `{ nextDueAt: null }`** — nothing else is
  resubmitted, so removing a wrong date cannot accidentally rewrite the vaccine
  name or the administration instant in the same write.
- **Date entry uses `<input type="datetime-local">`**, the control the agenda
  already uses, converted to an ISO instant before it leaves the browser. A
  hand-rolled date-only convention was rejected: "midnight UTC" would make the
  due report bucket the row to the previous local day.
- Loading, empty, error, success and permission-denied states for both lists.
  The create and correct actions are hidden without
  `vet.clinical.create`/`update` — UX only; the API still refuses.
- Semantic tokens only; the surface-integrity test covers the new files.

## Verification

```text
pnpm format-check   PASS
pnpm lint           PASS  (23/23 turbo tasks, includes apps/e2e specs)
pnpm typecheck      PASS  (23/23, includes apps/e2e)
pnpm build          PASS  (13/13)
pnpm test           PASS  (23/23)
  web        112 files (110 landed + 2 new)      1212 passed  (+40)
  api        114 files                           1634 passed | 266 skipped
  database    30 files                            549 passed
```

40 new web tests: the client functions (method, path, body, the `null` due date
surviving serialization, the omitted due field) and the component's behaviour
for both kinds, including the clear path and every render state.

**The `apps/e2e` spec is written and UNRUN.** Docker is unavailable in this
environment, so the lane has no built apps and no database. The spec's own
header comment states that, and states that it covers only the two kinds this
Story added. Its static validity was verified (`apps/e2e` typecheck and lint
both exit 0), which is not the same thing as a passing run and is not reported
as one.

## Tests Added

- Web unit: the client functions — request shape, the explicit `null` for a
  cleared due date, and the error mapping for `400`/`403`/`409`.
- Web unit: the section's five states for both lists.
- Web unit: the create action is hidden without `vet.clinical.create`, and the
  documented empty state renders.
- Playwright: a spec is added to `apps/e2e` covering recording a vaccination
  with a due date and correcting it. **It cannot be run in the environment this
  Story was implemented in** (no Docker); the run is recorded as pending, like
  the epic's other UI work.

## Known Limitations

- **The Playwright spec FAILED on its first real execution, and the fix is part
  of this Story.** It ran for the first time in CI on PR #145 (the build
  environment has no Docker) and timed out on a `fill`: it drove the surface as
  it existed BEFORE the browser-zone fix, with a `datetime-local` control and a
  `YYYY-MM-DD HH:mm` expectation, while the surface had become an
  `<input type="date">` rendering a plain calendar date. Two changes to the same
  surface were made days apart and the spec kept the older one, which no static
  check could catch. It now types whole calendar dates, uses the real labels
  (`Administered on`), and asserts the date the staff member typed rather than a
  wall-clock time — which is precisely the assertion that would have caught the
  zone defect.
- **A browser-zone defect was found by independent verification AFTER this Story
  was reported green, and is fixed.** The first implementation parsed a
  `datetime-local` value with `new Date(...)`, which uses the BROWSER's clock,
  and the due reports classify dates in `America/Asuncion`. With `TZ=UTC`,
  typing `2026-10-19T00:15` stored an instant whose tenant-local date was
  **2026-10-18**, so a vaccination entered for the 19th could be reported
  overdue on the 19th. The round-trip test compared that parser against itself
  and could not catch it.

  Both date fields are now `<input type="date">` and the wire form is **noon
  UTC** of the chosen date. Noon is what makes the tenant-local calendar date
  equal the typed date for any tenant offset in `(-12, +12)` — twelve hours of
  margin either side — and taking a plain calendar date removes the browser's
  clock from the conversion entirely. Verified by execution: with the browser in
  `UTC`, `America/Asuncion` and `Asia/Tokyo`, the tenant-local date of
  `2026-11-18` is `2026-11-18` in every case. Months and days are validated
  against the Gregorian calendar, so `2026-13-01`, `2026-02-30` and `2026-02-29`
  are refused while `2024-02-29` is accepted.

- **The noon-UTC convention has a stated bound**: a tenant at offset `+13` or
  more would see the following day. Asunción is `-03`, and `TENANT_TIME_ZONE` is
  a single platform constant, so the convention is correct for every deployment
  the product has; a per-tenant zone would need the conversion to move
  server-side.
- Three of the five specialized record kinds (treatments, studies, weights)
  remain API-only. [[TD-055]] tracks them and was narrowed, not closed, by
  [[DEC-067]].
- There is no cross-patient view of vaccinations; the due reports are that view,
  aggregated.

## Technical Debt

- [[TD-055]] — narrowed by this Story to treatments, studies and weights; still
  open.

## Decisions / ADRs

- [[DEC-067]] — this epic owns the narrow entry path for the field it
  introduced.
- [[DEC-065]] — the due date itself, and why NULL means "not monitored".
- [[DEC-008]] — staff and portal identities stay separate.

## Files / Modules

- `apps/web/src/app/(app)/app/patients/[id]/clinical-api.ts`
- `apps/web/src/app/(app)/app/patients/[id]/clinical-workspace.tsx`
- new components under `apps/web/src/app/(app)/app/patients/[id]/`
- `apps/e2e/specs/` — the pending spec
- `docs/05-modules/Clinical.md` — the staff surface described as implemented

## Completion Notes

All required gates passed on 2026-10-19, except the `apps/e2e` lane, which
cannot run in this environment. The spec is written, statically valid and unrun.
