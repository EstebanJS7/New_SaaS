---
id: CASH-005
type: story
title: Epic closure and evidence
epic: EPIC-13
status: planned
priority: medium
depends_on:
  - CASH-001
  - CASH-002
  - CASH-003
  - CASH-004
prd_sections:
  - "20"
  - "27"
  - "40"
  - "41"
permissions: []
branch:
created: 2026-09-30
updated: 2026-09-30
---

# CASH-005 — Epic closure and evidence

## Objective

Close EPIC-13 only after the implementation stories merge with verification
receipts, then update implemented-behavior documentation, QA evidence, changelog
and roadmap status.

## Context

Module docs describe implemented behavior only. The scope pass creates planned
records, but `docs/05-modules/Cash.md`, `docs/10-qa/CI-EVIDENCE.md`, the
changelog and the roadmap status should move only after the implementation
receipts exist.

## In Scope

- Update `docs/05-modules/Cash.md` with implemented close, movement commands,
  movement kinds, UI and limitations.
- Record durable verification evidence in `docs/10-qa/CI-EVIDENCE.md`.
- Update changelog and roadmap status after merged receipts exist.
- Reconcile every CASH story's implementation summary, tests, known limitations
  and completion notes.
- Preserve open/deferred debt such as [[TD-018]] visibly.

## Out of Scope

- Implementing the backend or UI behavior; this story closes after those stories
  land.
- Marking EPIC-13 done before all required receipts exist.
- Production-readiness claims.

## Acceptance Criteria

- [ ] [[CASH-001]], [[CASH-002]], [[CASH-003]] and [[CASH-004]] are `done` with
      CI-backed or explicitly recorded verification evidence.
- [ ] `docs/05-modules/Cash.md` reflects implemented EPIC-13 behavior and no
      planned-only behavior.
- [ ] `docs/10-qa/CI-EVIDENCE.md` records the relevant local/CI verification
      receipts, including durable live-PostgreSQL evidence.
- [ ] The changelog and roadmap status are updated in the closure branch after
      feature implementation merges.
- [ ] EPIC-13's exit criteria are checked only when they are backed by evidence.
- [ ] Open limitations and debt, especially [[TD-018]], stay visible.
- [ ] Tenant isolation is enforced when applicable.
- [ ] Backend authorization is enforced when applicable.
- [ ] Required loading/error/empty/success UX exists.
- [ ] Required audit exists.
- [ ] Tests required by the Story pass.

## Domain Invariants

- `done` means implementation closure only, never production readiness.
- Documentation must not overstate implemented behavior.
- Deferred corrections remain explicit and visible.

## API

### Added

```text
None yet
```

### Changed

```text
None yet
```

## Database

### Migration

```text
None yet
```

### Models/Tables

- None.

## UI

- None, except documentation of the implemented UI behavior.
- If UI is changed, confirm reusable components use semantic branding tokens
  rather than project-specific literals.

## Implementation Summary

_Not implemented._

## Verification

```text
Not run.
```

## Tests Added

- None planned beyond documentation/verification commands.

## Known Limitations

- None yet.

## Technical Debt

- [[TD-018]] remains open unless a separate approved slice implements sale
  reversal and payment refund.

## Decisions / ADRs

- [[DEC-030]] through [[DEC-037]] govern the epic closure scope.

## Files / Modules

- `docs/01-roadmap/EPIC-13-Cash.md`
- `docs/02-stories/CASH-001-cash-data-foundation-extension.md`
- `docs/02-stories/CASH-002-cash-movement-commands.md`
- `docs/02-stories/CASH-003-cash-session-close.md`
- `docs/02-stories/CASH-004-staff-cash-surface.md`
- `docs/05-modules/Cash.md`
- `docs/10-qa/CI-EVIDENCE.md`
- `docs/01-roadmap/ROADMAP.md`

## Completion Notes

_Status must remain non-done until all required gates pass._
