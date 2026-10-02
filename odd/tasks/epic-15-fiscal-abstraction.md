---
feature: epic-15-fiscal-abstraction
status: done
created: 2026-10-02
updated: 2026-10-02
branch: docs/epic-15-fiscal-kickoff
---

# EPIC-15 Fiscal Abstraction — ODD task tracker

## Goal

Kick off EPIC-15 Fiscal Abstraction with repository-facing scope artifacts
before any implementation code: epic record, planned stories, and proposed
decisions that resolve the Fiscal boundary questions inherited from EPIC-14.

## Tasks

- [x] T1 — Draft the EPIC-15 epic record from PRD, roadmap and EPIC-14
      hand-offs.
  - Evidence: `docs/01-roadmap/EPIC-15-Fiscal-Abstraction.md` exists with scope,
    out-of-scope, acceptance criteria, story list, dependencies and decision
    links.
- [x] T2 — Draft planned EPIC-15 story files.
  - Evidence: `docs/02-stories/FISC-001-*.md` through the selected final story
    exist with YAML frontmatter, acceptance criteria and verification gates.
- [x] T3 — Draft proposed fiscal decisions.
  - Evidence: proposed `DEC-046+` files cover trigger model, FiscalDocument
    state/multiplicity, idempotency/queue/retry, provider/fake contract,
    cancellation hand-off, fiscal UI/settings and storage/sanitization as
    needed.
- [x] T4 — Reconcile documentation indexes and roadmap kickoff status.
  - Evidence: `ROADMAP.md` already lists EPIC-15 as planned,
    `docs/02-stories/README.md` is convention-only, and
    `docs/05-modules/README.md` says module docs describe implemented behavior
    only. No changelog/QA/module index write is appropriate for the kickoff
    before implementation evidence.
- [x] T5 — Run documentation verification and summarize acceptance-needed items.
  - Evidence: `pnpm format-check` passed after Prettier wrote the kickoff docs;
    code/test/build gates are not applicable to this docs-only planning slice.
- [x] T6 — Accept DEC-046 through DEC-052 and close FISC-001.
  - Evidence: all seven decisions have accepted status and recorded outcomes;
    FISC-001 is done with its docs-only acceptance criteria verified. No
    implementation code or PRD edits were made.

## Notes

- The maintainer accepted the binding EPIC-15 decisions; implementation proceeds
  only in the subsequent EPIC-15 stories.
- PRD scope must remain unchanged; if scope changes are discovered, create a
  Decision proposal instead of editing the PRD.
- Current base branch: `origin/main` after EPIC-14 closure.
