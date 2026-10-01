---
id: BILL-005
type: story
title: Epic closure and evidence
epic: EPIC-14
status: planned
priority: medium
depends_on:
  - BILL-001
  - BILL-002
  - BILL-003
  - BILL-004
prd_sections:
  - "21"
  - "22"
  - "36"
  - "40"
  - "41"
permissions: []
branch:
created: 2026-10-01
updated: 2026-10-01
---

# BILL-005 — Epic closure and evidence

## Objective

Close EPIC-14 only after the implementation stories merge with CI receipts:
merge the Billing module documentation with the behavior it describes, record
the exit-criteria evidence, keep the [[TD-022]] debt record current for the
still-deferred portal invoice surface, reconcile every BILL story, and move the
changelog and the roadmap status against evidence.

## Context

- Module documentation describes implemented behavior only, so
  `docs/05-modules/Billing.md` may not exist before [[BILL-001]] through
  [[BILL-004]] are implemented and merged.
- EPIC-13 is the closure precedent: the closure lands on its own branch cut from
  `main` after the feature branch merges, so the closure text and the receipts
  it cites are separate merges.
- [[DEC-042]] requires the epic record and the module documentation to state
  that fiscal integration is deferred, and [[DEC-044]] required the [[TD-022]]
  record for the deferred portal invoice surface so neither gap reads as a
  defect or as closed by implication. [[TD-022]] was created during the EPIC-14
  kickoff, so this Story keeps it current instead of creating it.
- [[DEC-042]] also requires the closure to state plainly that the PRD §36
  journey step "fiscal submission queued" is not reached when EPIC-14 closes.
- [[TD-018]] stays open for sale reversal and payment refund; the closure must
  not close it, and [[DEC-043]] requires the refund and fiscal-cancellation
  non-effects to stay visible.
- [[DEC-038]] through [[DEC-045]] are **proposed**, not accepted. No status may
  move to `done` before the maintainer accepts or amends them and the
  implementation receipts exist.

## In Scope

- `docs/05-modules/Billing.md` describing the implemented aggregate, commands,
  numbering, authorization, audit and staff surface, plus its
  `docs/05-modules/README.md` index entry.
- The EPIC-14 exit-criteria evidence in `docs/10-qa/CI-EVIDENCE.md`, including
  the durable live-PostgreSQL runs.
- The [[TD-022]] debt record for the deferred portal invoice and document
  surface, kept current with the closure's real limitations.
- The changelog entry in `docs/09-releases/CHANGELOG.md` and the roadmap status
  in `docs/01-roadmap/ROADMAP.md`.
- The reconciliation of [[BILL-001]] through [[BILL-004]]: implementation
  summary, migrations, endpoints, tests, limitations and completion notes.
- The final reconciliation of the [[EPIC-14]] record, including its explicit
  limitation list.
- The closure branch itself, cut after the implementation stories merge.

## Out of Scope

- **Any source, schema, migration, seed, route, test or UI change.** This Story
  is documentation and evidence only; a defect found during closure becomes a
  defect on the owning Story, not a fix here.
- **Marking [[EPIC-14]] `done` before every Story is `done` and every exit
  criterion is checked.** The status moves only against evidence.
- **A production-readiness claim.** `done` means epic implementation closure
  only.
- **A fiscal integration, a fiscal document view or a fiscal state** —
  [[EPIC-15]], [[EPIC-16]] and [[DEC-042]]. The closure records the deferral
  instead of implementing it.
- **Portal invoices and documents** — still deferred; the closure keeps
  [[TD-022]] current so the blocker stays visible instead of being reopened or
  closed by implication ([[DEC-044]]).
- **Resolving [[TD-018]], [[TD-013]] or [[TD-021]].** Closing an epic does not
  resolve its deferred debt.
- **Refunds, sale reversal, payment reversal and cash compensation** —
  [[TD-018]] and [[DEC-043]].
- **Printed invoice rendering, PDF export, official number formatting, reports,
  dashboards and notification delivery** — [[DEC-039]], [[DEC-044]], [[EPIC-17]]
  and [[EPIC-18]].
- **Rewriting the [[EPIC-14]] pre-implementation snapshot to read as if it had
  always described the implemented state.**
- **Rewriting the proposed decisions into accepted decisions.** Only the
  maintainer accepts them.
- **A PRD edit.** No decision here requires one.

## Acceptance Criteria

- [ ] Module documentation for Billing is created after implementation and
      describes the aggregate, commands, numbering, authorization and UI
      behavior. Evidence to produce: `docs/05-modules/Billing.md` plus its index
      entry, merged with the implementation closure.
- [ ] `docs/10-qa/CI-EVIDENCE.md`, the changelog and the roadmap status are
      updated only after the implementation stories merge with CI receipts.
      Evidence to produce: the closure branch receipt.
- [ ] Every story records migrations, endpoints, tests, limitations and any new
      technical debt before moving to `done`. Evidence to produce: story files.
- [ ] The still-deferred portal invoice surface and the absence of fiscal
      integration are recorded as explicit debt/limitation, not as silent gaps.
      Evidence to produce: the current [[TD-022]] record and the epic limitation
      list.
- [ ] The epic exits with lint, typecheck, unit, integration, live-PostgreSQL,
      build and docs checks green, or with explicit non-green/pending evidence
      recorded. Evidence to produce: CI and local command receipts.
- [ ] The documentation gates pass on the closure change: the formatter check is
      green and the closure adds no code. Evidence to produce: the format check
      and the whitespace check receipts.

## Domain Invariants

- **Closure follows evidence, not effort.** A criterion is checked only when its
  named evidence exists and is merged.
- **The snapshot stays a snapshot.** The epic's pre-implementation section is
  never rewritten to read as if it had always described the implemented state.
- **Documentation describes only implemented behavior.** The module document is
  merged with the implementation, never before it.
- **Deferred work stays visible.** No limitation recorded by a decision, a Story
  or a debt record is deleted or softened during closure.
- **Closure does not certify production.** `done` means epic implementation
  closure only.
- **The epic stays fiscal-free and portal-free until another epic owns the
  change** ([[DEC-042]], [[DEC-044]]).

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

The closure records the migration [[BILL-001]] ships and adds none.

### Models/Tables

- None. The closure documents the tables [[BILL-001]] ships; it adds none.

## UI

- None. The closure documents the surface [[BILL-004]] ships; it changes no UI.
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
  implementation stories pass in the merged CI runs; it adds no test.

## Known Limitations

- Nothing is implemented. The Story is `planned` and every criterion is
  unchecked.
- The closure can only report the CI runs and live-PostgreSQL evidence that
  actually exist. A missing or local-only run keeps the corresponding exit
  criterion unchecked and the epic non-`done`.
- `docs/05-modules/Billing.md` must not be created before the implementation
  stories merge, because module documentation describes implemented behavior
  only.
- [[TD-022]] already exists and was created during the EPIC-14 kickoff, so the
  closure keeps it current rather than creating it. It must not be softened or
  resolved by the closure.
- The closure cannot resolve [[TD-018]], [[TD-013]], [[TD-021]] or [[TD-022]],
  and it must not present the epic as production-ready.
- The epic closes with no fiscal integration, so the PRD §36 journey step
  "fiscal submission queued" remains unreached ([[DEC-042]]), and with no portal
  invoice read, so the PRD §26 invoices/documents capability remains
  unimplemented ([[DEC-044]]).
- [[DEC-038]] through [[DEC-045]] are proposed, not accepted, so no status may
  move to `done` before the maintainer accepts or amends them.
- Editing the five BILL story files carries the formatter risk [[TD-017]]
  records: a wikilink must never wrap inside a list item, and a formatting
  change must be verified idempotent before the closure commit.

## Technical Debt

- The closure **keeps** the [[TD-022]] record current for the deferred portal
  invoice and document surface ([[DEC-044]]), so the [[EPIC-08]] blocker stays
  visible; the record itself was created during the EPIC-14 kickoff.
- [[TD-018]] stays open: the closure adds no sale reversal, stock compensation,
  payment refund or compensating financial record.
- [[TD-013]] and [[TD-021]] stay open; the closure records their status and does
  not resolve them.
- [[TD-017]] stays open; the closure must respect its authoring convention while
  editing the BILL story files.
- The closure resolves no debt record, including [[TD-022]]: closing an epic is
  not resolving a deferred limitation.

## Decisions / ADRs

- [[DEC-038]] — the aggregate shape the module documentation must describe,
  including the no-standalone-invoicing limitation.
- [[DEC-039]] — the numbering guarantee the module documentation must state
  precisely, and the deferred printable rendering.
- [[DEC-040]] — the permission family, the role matrix and the `billing`
  entitlement gate recorded as implemented.
- [[DEC-041]] — the confirmation effects, the state-gated replay and the
  deferred `InvoiceConfirmed` event.
- [[DEC-042]] — the fiscal boundary ownership the closure must state as an
  explicit deferral.
- [[DEC-043]] — the cancellation boundary and its refund and fiscal-cancellation
  non-effects.
- [[DEC-044]] — the scope boundaries and the [[TD-022]] record this Story keeps
  current.
- [[DEC-045]] — the staff surface scope and the dormant navigation gate
  limitation.
- No ADR is required: the closure introduces no architecture change.

## Files / Modules

Planned paths; nothing below exists yet.

- `docs/05-modules/Billing.md`
- `docs/05-modules/README.md`
- `docs/10-qa/CI-EVIDENCE.md`
- `docs/09-releases/CHANGELOG.md`
- `docs/01-roadmap/ROADMAP.md`
- `docs/01-roadmap/EPIC-14-Billing.md`
- `docs/02-stories/BILL-001-invoice-data-foundation.md`
- `docs/02-stories/BILL-002-invoice-creation-and-read-api.md`
- `docs/02-stories/BILL-003-invoice-confirmation-and-cancellation-commands.md`
- `docs/02-stories/BILL-004-staff-billing-surface.md`
- `docs/08-tech-debt/TD-022-portal-invoice-document-surfaces-deferred.md`
  (already created during the kickoff; kept current by this Story)

## Completion Notes

_Status must remain non-done until all required gates pass._

This Story stays `planned` while nothing exists. It may not be marked `done`
before [[BILL-001]] through [[BILL-004]] are `done` with CI-backed receipts, the
Billing module documentation is merged, `docs/10-qa/CI-EVIDENCE.md`, the
changelog and the roadmap carry the real evidence, [[TD-022]] reflects the
closure's real limitations, and the maintainer has accepted or amended the
decision records the epic rests on.
