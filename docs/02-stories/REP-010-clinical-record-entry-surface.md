---
id: REP-010
type: story
title: The clinical record entry surface — vaccinations and deworming
epic: EPIC-18
status: planned
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

- [ ] `clinical-api.ts` exposes list, create and update for vaccinations and for
      deworming, mirroring the encounter functions' error handling.
- [ ] The workspace lists a patient's vaccinations and deworming treatments,
      each with its administered date and its due date when set.
- [ ] A vaccination and a deworming treatment can be created with an optional
      due date, and the created row appears without a manual reload.
- [ ] An existing due date can be CORRECTED, and can be REMOVED with an explicit
      `null` — the same contract the API accepts, exercised through the UI.
- [ ] A `400` from the server is surfaced with its message rather than a generic
      failure, and a `409` is distinguishable from a validation error.
- [ ] The section renders loading, empty, error, success and permission-denied
      states, using semantic branding tokens only — no literal brand colour,
      radius or font.
- [ ] A caller without `vet.clinical.create` sees the lists but not the create
      action; the backend remains authoritative and still refuses.
- [ ] No tenant, patient or permission authority is taken from the URL or the
      body.
- [ ] Required loading/error/empty/success UX exists.
- [ ] Required audit exists — the API already co-commits one audit row per
      mutation; this Story writes none of its own and asserts none is
      duplicated.
- [ ] Tests required by the Story pass.

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

_Not implemented._

## Verification

```text
Not run.
```

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

- **The `apps/e2e` lane is not run**, because Docker is unavailable in the
  implementing environment. The spec is written and unrun, which is recorded
  rather than implied.
- Three of the five specialized record kinds stay API-only; [[TD-055]] is
  narrowed, not closed.
- The section is per-patient on the existing workspace, so there is no
  cross-patient "all vaccinations" view. The due reports are that view,
  aggregated.

## Technical Debt

- [[TD-055]] — narrowed by this Story to treatments, studies and weights, and
  still open.

## Decisions / ADRs

- [[DEC-067]] — this epic owns the narrow entry path for the field it
  introduced.
- [[DEC-065]] — the due date itself, and why NULL means "not monitored".
- [[DEC-008]] — staff and portal identities stay separate.

## Files / Modules

- `apps/web/src/app/(app)/app/patients/[id]/clinical-api.ts`
- `apps/web/src/app/(app)/app/patients/[id]/clinical-workspace.tsx`
- new components under `apps/web/src/app/(app)/app/patients/[id]/`
- `apps/e2e/tests/` — the pending spec
- `docs/05-modules/Clinical.md` — the staff surface described as implemented

## Completion Notes

_Status must remain non-done until all required gates pass._
