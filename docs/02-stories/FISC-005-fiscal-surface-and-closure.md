---
id: FISC-005
type: story
title: Fiscal surface and epic closure
epic: EPIC-15
status: planned
priority: high
depends_on:
  - FISC-004
prd_sections:
  - "22"
  - "36"
  - "38"
  - "40"
  - "41"
permissions:
  - fiscal.invoice.issue
branch:
created: 2026-10-02
updated: 2026-10-02
---

# FISC-005 — Fiscal surface and epic closure

## Objective

Ship the minimal staff-facing fiscal operational surface selected by the
accepted decisions, close the invoice cancellation hand-off, and record EPIC-15
module/release evidence.

## Context

[[DEC-042]] says EPIC-15 owns the `fiscal-ui` surface. [[DEC-043]] requires this
epic to revisit confirmed invoice cancellation after `FiscalDocument` exists.
Portal documents remain deferred by [[TD-022]] unless an accepted decision
changes that scope.

## In Scope

- Minimal staff fiscal status/action UI or explicit API-only scope if selected
  by accepted decisions.
- Typed `fiscal-ui` settings namespace if selected by accepted decisions.
- Confirmed-invoice cancellation hand-off resolution.
- Fiscal module documentation, roadmap/changelog/CI evidence and epic closure.

## Out of Scope

- Customer portal documents/KuDE.
- PDF/print/export and notifications.
- Real fiscal provider configuration beyond safe references.

## Acceptance Criteria

- [ ] Staff can inspect the fiscal status and operational outcome required by
      the accepted surface decision.
- [ ] Any fiscal actions are gated by backend authorization, the `fiscal`
      feature code and the accepted fiscal permission keys; frontend checks are
      UX only.
- [ ] Loading, empty, error, success, permission-denied and entitlement-denied
      states are covered when UI is in scope.
- [ ] Confirmed invoice cancellation no longer silently contradicts approved
      fiscal documents: it either requests Fiscal cancellation or the accepted
      decision records the separate workflow and UI/API block.
- [ ] `docs/05-modules/Fiscal.md` documents aggregate behavior, states, provider
      boundary, queues, retry/idempotency, authorization, audit, settings and
      limitations.
- [ ] `docs/10-qa/CI-EVIDENCE.md`, `docs/09-releases/CHANGELOG.md` and
      `docs/01-roadmap/ROADMAP.md` are updated only with real verification/CI
      evidence.
- [ ] EPIC-15 exits with required checks green or explicit non-green/pending
      evidence recorded.

## Domain Invariants

- Fiscal operations are explicit, authorized and audited.
- Portal identities do not gain staff fiscal access.
- Fiscal cancellation follows provider/Fiscal state rules, not local invoice
  edits.

## API

### Added

```text
Fiscal status/action routes per accepted decisions.
```

### Changed

```text
Invoice cancellation may be extended only through the accepted Fiscal hand-off.
```

## Database

### Migration

```text
Only if accepted settings/surface/cancellation resolution requires additive schema.
```

### Models/Tables

- Uses `FiscalDocument` and settings namespace rows when selected.

## UI

- Planned staff fiscal surface if accepted by [[DEC-052]].
- Reusable components must use semantic design tokens only.

## Implementation Summary

_Not implemented._

## Verification

```text
Not run.
```

## Tests Added

- Planned UI/API tests for the selected surface.
- Planned cancellation hand-off tests.
- Planned docs/release verification.

## Known Limitations

- Portal document surface remains deferred unless a later accepted decision
  moves it into scope.

## Technical Debt

- [[TD-022]] is re-evaluated by this Story but not closed unless its acceptance
  criteria are actually satisfied.

## Decisions / ADRs

- Depends on accepted [[DEC-051]] and [[DEC-052]].

## Files / Modules

- `apps/web/src/app/(app)/app/fiscal/*` or selected staff surface path
- `apps/api/src/fiscal/*`
- `apps/api/src/billing/*` only for accepted cancellation hand-off
- `docs/05-modules/Fiscal.md`
- `docs/10-qa/CI-EVIDENCE.md`
- `docs/09-releases/CHANGELOG.md`
- `docs/01-roadmap/ROADMAP.md`

## Completion Notes

_Status must remain non-done until all required gates pass._
