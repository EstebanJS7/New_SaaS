---
id: IMP-006
type: story
title: The epic closure and evidence
epic: EPIC-19
status: planned
priority: high
depends_on:
  - IMP-001
  - IMP-002
  - IMP-003
  - IMP-004
  - IMP-005
prd_sections:
  - "32"
permissions: []
branch: feat/epic-19-imports
created: 2026-10-19
updated: 2026-10-19
---

# IMP-006 — The epic closure and evidence

## Objective

Close [[EPIC-19]] the way [[EPIC-18]] was closed: a criterion-to-evidence map,
the gate run and the live run, the module document, the changelog, the roadmap
row and a triage of everything the epic did not do.

## Context

Two things about this epic need stating plainly at closure rather than smoothed
over:

- **The PRD's XLSX half is not implemented** ([[DEC-068]]). A `done` row must
  not be read as "PRD §32 complete".
- **The artefact's retention has no approved policy behind it** ([[TD-058]]).
  The epic ships a defensible TTL, not a policy.

## In Scope

- The criterion-to-evidence map for the epic and every Story.
- The full gate run plus the live-PostgreSQL lane, and the `apps/e2e` lane
  **observed in CI**, not assumed — [[EPIC-18]] learned that lesson the hard way
  when its first browser run failed on a stale selector.
- `docs/05-modules/Imports.md` in its final state: the two file formats and
  their exact header contracts, the state machine, the duplicate heuristic and
  its limits, the partial-commit semantics, the artefact's classification and
  TTL.
- The `docs/10-qa/CI-EVIDENCE.md` block with the real counts and the run id.
- The changelog, the roadmap row and the tech-debt triage.

## Out of Scope

- Any new capability. This Story closes; it does not extend.
- XLSX ([[TD-057]]).

## Acceptance Criteria

- [ ] Every acceptance criterion in the epic and in IMP-001…IMP-005 maps to a
      named test, a named file or a recorded limitation.
- [ ] Format, lint, typecheck, build and the full test set are green, with
      per-suite counts recorded.
- [ ] The live-PostgreSQL lane is green with the migration applied.
- [ ] The `apps/e2e` lane result is the REAL one from CI, recorded with its run
      id — never "expected to pass".
- [ ] `docs/05-modules/Imports.md` documents both header contracts, the state
      machine, the heuristic's limits, the partial-commit semantics and the
      artefact's TTL.
- [ ] The changelog records what shipped and the XLSX deviation.
- [ ] The roadmap row reads `done` with the evidence note and the explicit "not
      a production-readiness statement" clause.
- [ ] [[TD-057]] and [[TD-058]] carry a status, and any discovered later is
      named.
- [ ] Tests required by the Story pass.

## Domain Invariants

- Closure is evidence-based, never assertion-based.
- A failing gate keeps the Story out of `done`.
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
None beyond the epic's own.
```

### Models/Tables

- None.

## UI

- None.

## Implementation Summary

_Not implemented._

## Verification

```text
Not run.
```

## Tests Added

- None. This Story runs and records the existing suites.

## Known Limitations

- To be recorded at closure.

## Technical Debt

- [[TD-057]], [[TD-058]] and anything found while building.

## Decisions / ADRs

- [[DEC-068]]–[[DEC-072]] re-verified as implemented, not merely cited.

## Files / Modules

- `docs/01-roadmap/EPIC-19-Imports.md`, `ROADMAP.md`
- `docs/05-modules/Imports.md`
- `docs/09-releases/CHANGELOG.md`, `docs/10-qa/CI-EVIDENCE.md`
- `docs/08-tech-debt/`

## Completion Notes

_Status must remain non-done until all required gates pass._
