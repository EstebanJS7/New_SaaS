---
id: POS-005
type: story
title: Epic closure and evidence
epic: EPIC-12
status: done
priority: low
depends_on:
  - POS-001
  - POS-002
  - POS-003
  - POS-004
prd_sections: []
permissions: []
branch: docs/epic-12-closure
created: 2026-09-27
updated: 2026-09-29
---

# POS-005 — Epic closure and evidence

## Objective

Close [[EPIC-12]] on evidence: merge the module documentation for the new
domains, record the epic's exit-criteria evidence including the durable
live-PostgreSQL runs, confirm the generated tech-debt records, and update the
changelog and the roadmap status.

The closure work lands in a **closure branch after the feature branch merges**.
A closure documentation change must never ride the feature branch whose receipt
it cites, because the branch's own merge commit is produced after the closure
text is written — the lesson EPIC-11 recorded when its closure documentation was
split from the slices it describes.

## Context

- EPIC-11 is the closure precedent: its epic record carries a snapshot section
  that is explicitly not the current state, a criterion-to-evidence map in the
  exit criteria, and a closure note that lists what stays open rather than
  presenting closure as production readiness.
- The repository documentation workflow requires the new module documentation to
  be merged with the behavior it describes, the changelog to carry the product
  change, and the roadmap status to move only after the required gates pass.
- [[DEC-023]], [[DEC-024]] and [[DEC-025]] each state that the epic closure
  generates the corresponding Tech Debt record, so [[TD-018]], [[TD-019]] and
  [[TD-020]] are this Story's deliverable.
- [[TD-016]] names EPIC-12 as the next stock writer; [[POS-003]] records the
  compliance call site, and this Story verifies that the record was updated
  without being closed.
- Nothing in EPIC-12 exists yet, so this Story starts from an unimplemented
  epic.

## In Scope

- The module documentation for the new domains: the sales module document at
  `docs/05-modules/Sales.md` and the cash documentation covering the minimal
  foundation, with their `docs/05-modules/README.md` index entries.
- The exit-criteria evidence for [[EPIC-12]], including the durable
  live-PostgreSQL runs recorded in `docs/10-qa/CI-EVIDENCE.md`.
- The three generated tech-debt records, [[TD-018]], [[TD-019]] and [[TD-020]],
  and the confirmation that [[TD-016]] carries the EPIC-12 compliance call site
  and stays `open`.
- The changelog entry in `docs/09-releases/CHANGELOG.md`.
- The roadmap status update in `docs/01-roadmap/ROADMAP.md` and the final
  reconciliation of the [[EPIC-12]] record.
- The closure branch itself, merged separately from the feature branches whose
  receipts it cites.

## Out of Scope

- **Any source, schema, migration, seed, route, test or UI change.** This Story
  is documentation and evidence only; a code defect found during closure becomes
  a defect on the owning Story, not a fix here.
- **Marking [[EPIC-12]] `done` before every Story is `done` and every exit
  criterion is checked.** The status moves only against evidence, and never
  before the required CI checks are green.
- **A production-readiness claim.** `done` means epic implementation closure
  only, exactly as EPIC-11 records it.
- **Resolving [[TD-016]], [[TD-018]], [[TD-019]] or [[TD-020]].** Closing an
  epic does not resolve its deferred debt.
- **Sale reversal, payment refund, barcode identification and idempotency-row
  retention** — each stays deferred with its owning record.
- **A new Decision record or an ADR** — outside this Story's file surface.
- **Rewriting an existing epic, story, decision or debt record to remove a
  recorded limitation.**

## Acceptance Criteria

- [x] All four implementation Stories — [[POS-001]], [[POS-002]], [[POS-003]],
      [[POS-004]] — are `done` with every required acceptance criterion checked
      and each criterion naming its evidence.
- [x] Module documentation for the new domains is merged: the sales module
      document at the path `docs/05-modules/Sales.md` and the cash documentation
      covering the minimal foundation, each indexed in
      `docs/05-modules/README.md`.
- [x] The durable live-PostgreSQL evidence for the completion transaction, the
      CASH payment path and the concurrent double-complete is recorded in
      `docs/10-qa/CI-EVIDENCE.md`, and the recorded runs are the merged CI runs
      rather than local-only runs.
- [x] [[TD-018]], [[TD-019]] and [[TD-020]] exist as `open` records with their
      severity, related epics and stories, triggers and
      verification-after-resolution items.
- [x] [[TD-016]] carries the EPIC-12 compliance call site and stays `open`;
      closing the epic does not close the debt.
- [x] The changelog entry in `docs/09-releases/CHANGELOG.md` records the product
      change, and the roadmap in `docs/01-roadmap/ROADMAP.md` reflects EPIC-12's
      real status.
- [x] The changelog and roadmap updates land on a closure branch merged after
      the feature branches, so the closure text and the receipts it cites are
      separate merges.
- [x] The [[EPIC-12]] record's exit criteria are checked against evidence with a
      criterion-to-evidence map, and the record states plainly what remains open
      rather than presenting closure as production readiness.
- [x] This Story adds no source, schema, migration, seed, route, test or UI
      change; it changes documentation only.
- [x] Required lint, format and build checks pass on the closure change.

## Domain Invariants

- **Closure follows evidence, not effort.** A criterion is checked only when its
  named evidence exists and is merged.
- **The snapshot stays a snapshot.** The epic's pre-implementation section is
  never rewritten to read as if it had always described the implemented state.
- **Deferred work stays visible.** No limitation recorded by a Decision, a Story
  or a debt record is deleted or softened during closure.
- **Documentation ships with the behavior it describes.** The module documents
  describe only implemented behavior and are merged in the same closure slice.
- **The closure does not certify production.** `done` means epic implementation
  closure only.

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

- None. The closure records the migrations shipped by [[POS-001]], [[POS-002]]
  and [[POS-003]]; it adds none.

## UI

- None. The closure records the surface shipped by [[POS-004]]; it changes no
  UI.
- If any UI is changed by a later slice, reusable components must use semantic
  branding tokens rather than project-specific literals.

## Implementation Summary

_Not implemented._

## Verification

```text
Not run.
```

## Tests Added

- None planned. The closure verifies that the tests shipped by the four
  implementation Stories pass in the merged CI runs; it adds no test.

## Known Limitations

- None yet; nothing is implemented.
- Planned: the closure can only report the CI runs and live-PostgreSQL evidence
  that actually exist; a missing or local-only run keeps the corresponding exit
  criterion unchecked and the epic non-done.

## Technical Debt

- This Story **generates** [[TD-018]], [[TD-019]] and [[TD-020]], and verifies
  that [[TD-016]] carries the EPIC-12 call site while staying `open`.
- It resolves no debt record: closing an epic is not resolving a deferred
  limitation.

## Decisions / ADRs

- Accepted Decision records govern this Story (accepted 2026-09-27):
  - [[DEC-023]] — the deferred reversal boundary, whose [[TD-018]] record this
    Story generates.
  - [[DEC-024]] — the idempotency mechanism and its retention limitation, whose
    [[TD-020]] record this Story generates.
  - [[DEC-025]] — the deferred barcode, whose [[TD-019]] record this Story
    generates.
  - [[DEC-020]] and [[DEC-026]] — the cash boundary and the permission and
    entitlement contract the closure verifies are documented.
- An ADR is not expected: the closure introduces no architecture change.

## Resolved by Decision

- **Which debt records the epic closure generates** — [[DEC-023]], [[DEC-024]]
  and [[DEC-025]] each assign their record to the epic closure.
- **Whether closure may rewrite the epic snapshot** — no; the repository
  documentation rules and the EPIC-11 precedent keep the snapshot as a snapshot.
- **The closure branch shape** — an implementation choice inside approved scope,
  decided during the slice using the EPIC-11 closure precedent.

## Files / Modules

- `docs/05-modules/Sales.md` — the planned sales module documentation.
- The planned cash module documentation and the `docs/05-modules/README.md`
  index entries.
- `docs/10-qa/CI-EVIDENCE.md` — the recorded live-PostgreSQL and CI evidence.
- `docs/09-releases/CHANGELOG.md` — the product change entry.
- `docs/01-roadmap/ROADMAP.md` — the epic status.
- `docs/01-roadmap/EPIC-12-POS-Payments.md` — the epic record and its
  criterion-to-evidence map.
- `docs/08-tech-debt/TD-018-sale-reversal-and-payment-refund-deferred.md`,
  `docs/08-tech-debt/TD-019-pos-item-code-identification-deferred.md` and
  `docs/08-tech-debt/TD-020-idempotency-key-retention.md` — the generated
  records.

## Completion Notes

_Status must remain non-done until all required gates pass._ This Story stays
`planned` while nothing exists; it may not be marked `done` until the module
documentation is merged, the exit-criteria evidence is recorded, the three debt
records exist, and the changelog and roadmap updates have landed on a closure
branch merged after the feature branches.
