---
id: CASH-005
type: story
title: Epic closure and evidence
epic: EPIC-13
status: done
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
branch: docs/epic-13-cash-closure
created: 2026-09-30
updated: 2026-10-01
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

- [x] [[CASH-001]], [[CASH-002]], [[CASH-003]] and [[CASH-004]] are `done` with
      CI-backed verification evidence: PR #84 merged as `5058d59` with CI run
      `36800148919` green.
- [x] `docs/05-modules/Cash.md` reflects implemented EPIC-13 behavior and no
      planned-only behavior: the seven routes, the close arithmetic and its
      stored amounts, the movement reason and direction rules, the staff
      workspace and the updated limitations.
- [x] `docs/10-qa/CI-EVIDENCE.md` records the relevant local/CI verification
      receipts, including the 119 durable live-PostgreSQL cases.
- [x] The changelog and roadmap status are updated in this closure branch, which
      was cut from `main` AFTER the feature merge.
- [x] EPIC-13's exit criteria are checked only where evidence backs them.
- [x] Open limitations and debt, especially [[TD-018]], stay visible.
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

The closure branch `docs/epic-13-cash-closure`, cut from `main` at `5058d59`
(the PR #84 merge), carries:

- `docs/05-modules/Cash.md` rewritten for the implemented epic: the owned tables
  with the close columns and the movement `direction`, the seven routes, the
  invariants (the sign map, the reason rule, the direction exclusivity, the
  serialized terminal close), the close arithmetic, the staff surface, the audit
  actions and the updated known limitations;
- the EPIC-13 section of `docs/10-qa/CI-EVIDENCE.md` with the merge receipt and
  the local evidence;
- the `EPIC-13 — Cash` changelog entry in `docs/09-releases/CHANGELOG.md`;
- the `docs/01-roadmap/ROADMAP.md` row moved to `done` with its nuance
  paragraph;
- the [[CASH-001]] to [[CASH-005]] stories and the epic record set to `done`,
  each with its merge receipt.

## Verification

```text
pnpm format-check  -> passed
git diff --check   -> passed
```

Documentation-only closure: no source file changes, so no suite re-run was
required beyond the format and whitespace gates.

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

Closed 2026-10-01 in the closure branch, after PR #84 merged into `main` as
`5058d59` with CI run `36800148919` green on both required checks. Every
acceptance criterion is checked and the documentation describes only implemented
behavior.

`done` means implementation closure only: it is never production readiness.
