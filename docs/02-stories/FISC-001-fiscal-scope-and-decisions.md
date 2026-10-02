---
id: FISC-001
type: story
title: Fiscal scope and decisions
epic: EPIC-15
status: done
priority: high
depends_on:
  - BILL-005
prd_sections:
  - "21"
  - "22"
  - "23"
  - "36"
  - "39"
  - "40"
  - "41"
permissions: []
branch: docs/epic-15-fiscal-kickoff
created: 2026-10-02
updated: 2026-10-02
---

# FISC-001 — Fiscal scope and decisions

## Objective

Create the EPIC-15 kickoff artifacts and proposed decisions needed before any
Fiscal implementation code lands.

## Context

EPIC-14 deliberately shipped a fiscal-free invoice. [[DEC-042]], [[DEC-041]] and
[[DEC-043]] hand the Fiscal boundary, queue, fake provider, application
interface and cancellation revisit to EPIC-15. No EPIC-15 artifacts exist before
this Story.

## In Scope

- Create `docs/01-roadmap/EPIC-15-Fiscal-Abstraction.md`.
- Create planned FISC stories with acceptance criteria and verification gates.
- Create proposed DEC-046 onward for Fiscal implementation choices.
- Keep PRD scope unchanged.

## Out of Scope

- Database schema, API, worker, UI or provider implementation.
- Real SIFEN/third-party provider work.
- Accepting decisions without maintainer review.

## Acceptance Criteria

- [x] The EPIC-15 epic file exists and traces PRD sections, scope, out-of-scope,
      story slicing, dependencies, exit criteria and technical debt.
- [x] Planned FISC story files exist with YAML frontmatter, acceptance criteria,
      domain invariants and verification expectations.
- [x] Decision files exist for the fiscal aggregate/linkage, trigger model,
      provider port/fake, idempotency/retry, storage/sanitization, cancellation
      hand-off and fiscal surface/settings; all seven are accepted.
- [x] No PRD section is edited.
- [x] Implementation work remained blocked pending maintainer acceptance; these
      decisions are now accepted, and implementation is assigned to later
      stories.

## Domain Invariants

- Fiscal status belongs to Fiscal records, not to `Invoice`.
- Billing may depend on the Fiscal application boundary, never a concrete
  provider.
- Events are introduced only when the Fiscal queue consumer exists.

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
None.
```

### Models/Tables

- None.

## UI

- None.

## Implementation Summary

Completed the docs-only EPIC-15 kickoff: created the epic and planned story
artifacts, accepted DEC-046 through DEC-052 after maintainer approval, and kept
implementation code and PRD scope unchanged.

## Verification

- `pnpm exec prettier --write` applied to all touched Markdown files.
- `pnpm format-check` passed.

## Tests Added

- None planned for this docs-only kickoff.

## Known Limitations

- No Fiscal implementation code exists; schema, API, worker, provider, UI and
  implementation verification remain assigned to later EPIC-15 stories.

## Technical Debt

- None.

## Decisions / ADRs

- [[DEC-046]] through [[DEC-052]] are accepted implementation decisions. No PRD
  change or new ADR was made.

## Files / Modules

- `docs/01-roadmap/EPIC-15-Fiscal-Abstraction.md`
- `docs/02-stories/FISC-*.md`
- `docs/07-decisions/DEC-046-*.md` through `DEC-052-*.md`

## Completion Notes

The kickoff acceptance criteria are complete. This docs-only Story does not
claim completion of EPIC-15 implementation criteria; those remain unchecked in
the epic and belong to subsequent stories.
