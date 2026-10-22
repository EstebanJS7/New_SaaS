---
id: REP-009
type: story
title: The epic closure and evidence
epic: EPIC-18
status: planned
priority: high
depends_on:
  - REP-001
  - REP-002
  - REP-003
  - REP-004
  - REP-005
  - REP-006
  - REP-007
  - REP-008
prd_sections:
  - "31"
permissions: []
branch: feat/epic-18-dashboards-reports
created: 2026-10-19
updated: 2026-10-19
---

# REP-009 — The epic closure and evidence

## Objective

Close [[EPIC-18]] the way [[EPIC-17]] was closed: a criterion-to-evidence map,
the CI receipt, the module document, the changelog, the roadmap row and a triage
of everything the epic did not do.

## Context

This repository's closure ritual is explicit and repeated in `ROADMAP.md` for
every finished epic: an evidence-based closure against a named CI run, plus
preserved open debt. A `done` row is **never** a production-readiness statement,
and this epic in particular closes with two empty-by-design reports that a
reader must not mistake for a defect.

Two facts will need to be stated plainly rather than smoothed over:

- The low-stock and due-vaccine/deworming reports are empty until a tenant opts
  in. That is [[DEC-065]]'s design, not an incomplete implementation.
- No report has been run against a real tenant's data volume. [[TD-053]] records
  what that would need.

## In Scope

- The criterion-to-evidence map for every acceptance criterion in the epic file
  and in [[REP-001]]–[[REP-008]].
- The full gate run:
  `pnpm format-check && pnpm lint && pnpm typecheck && pnpm build && pnpm test`,
  plus the `apps/e2e` lane against the built apps.
- `docs/05-modules/Reporting.md` brought to its final state: every report, its
  route, its columns, its CSV header order, its permissions and its limitations.
- The `docs/10-qa/CI-EVIDENCE.md` closure block with the CI run id and the gate
  counts.
- `docs/09-releases/CHANGELOG.md`.
- The roadmap row for [[EPIC-18]] moved to `done` with the evidence note.
- The tech-debt triage: every deferred item a named TD with a status.
- The epic file's status, its acceptance checkboxes and its implementation
  summary.

## Out of Scope

- Any new capability. This Story closes; it does not extend.
- Fixing debt. Debt is recorded, not paid.
- Pushing or opening the pull request. Those are the maintainer's decisions.

## Acceptance Criteria

- [ ] Every acceptance criterion in the epic and in REP-001…REP-008 maps to a
      named test, a named file or a recorded limitation — nothing is left
      unmapped.
- [ ] `pnpm format-check && pnpm lint && pnpm typecheck && pnpm build &&     pnpm test`
      is green, with the per-suite counts recorded.
- [ ] The `apps/e2e` lane is green against the built apps, with its test count
      recorded.
- [ ] `docs/05-modules/Reporting.md` documents every report, its route, its
      columns, its CSV header, its permission and its limitations.
- [ ] `docs/10-qa/CI-EVIDENCE.md` carries the closure block and the CI run id.
- [ ] `docs/09-releases/CHANGELOG.md` records the epic.
- [ ] The roadmap row reads `done` with the evidence-based note and the explicit
      "not a production-readiness statement" clause the other rows carry.
- [ ] The three kickoff Tech Debt items ([[TD-051]], [[TD-052]], [[TD-053]]) and
      any discovered later each carry a status.
- [ ] Tenant isolation is enforced when applicable — covered by REP-002…REP-006
      and re-asserted in the closure map.
- [ ] Backend authorization is enforced when applicable — covered by REP-002 and
      REP-007 and re-asserted in the closure map.
- [ ] Required loading/error/empty/success UX exists — covered by REP-008.
- [ ] Required audit exists — the export path's audit decision is stated in
      `docs/05-modules/Reporting.md`.
- [ ] Tests required by the Story pass.

## Domain Invariants

- Closure is evidence-based, never assertion-based.
- A failing gate means the Story stays `in-progress` or `review`, not `done`.
- An incomplete acceptance criterion is never relabelled as tech debt.

## API

### Added

```text
None.
```

### Changed

```text
None.
```

## Database

### Migration

```text
None — the epic's only migration is REP-001's.
```

### Models/Tables

- None.

## UI

- None. The closure record is documentation.

## Implementation Summary

_Not implemented._

## Verification

```text
Not run.
```

## Tests Added

- None. This Story runs and records the existing suites.

## Known Limitations

- To be recorded at closure from the epic's actual state.

## Technical Debt

- The triage itself is this Story's deliverable; the items are [[TD-051]],
  [[TD-052]] and [[TD-053]] plus anything found while building.

## Decisions / ADRs

- [[DEC-062]]–[[DEC-066]] are re-verified as implemented, not merely cited.

## Files / Modules

- `docs/01-roadmap/EPIC-18-Dashboards-Reports.md`
- `docs/01-roadmap/ROADMAP.md`
- `docs/05-modules/Reporting.md`
- `docs/09-releases/CHANGELOG.md`
- `docs/10-qa/CI-EVIDENCE.md`
- `docs/08-tech-debt/` — the triage

## Completion Notes

_Status must remain non-done until all required gates pass._
