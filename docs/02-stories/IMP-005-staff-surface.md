---
id: IMP-005
type: story
title: The staff surface
epic: EPIC-19
status: planned
priority: medium
depends_on:
  - IMP-004
prd_sections:
  - "32"
permissions:
  - imports.run
  - imports.read
branch: feat/epic-19-imports
created: 2026-10-19
updated: 2026-10-19
---

# IMP-005 — The staff surface

## Objective

One screen where an operator uploads a file, sees exactly what will happen,
starts it, watches it and reads the result — including why each failed row
failed.

## Context

PRD §32 asks for "validation, preview and result summary", and the summary is
the artefact the operator keeps. [[DEC-072]] made every upload asynchronous, so
the surface polls rather than blocks.

The BFF follows the established proxy pattern, including the buffered-body rule
the release checklist records.

## In Scope

- `/app/imports`: the upload for either entity, the tenant's import history, and
  one import's detail.
- Upload: entity choice, file picker, the accepted format stated next to it, and
  the refusals surfaced verbatim (wrong type, too large).
- Preview: the counts, plus a bounded table of row outcomes with their reasons
  and their `suspected duplicate` warnings distinguished from errors.
- Commit: the action, and then progress by polling until a terminal state.
- Summary: created / failed / suspected duplicates, and the row table, readable
  after a reload because the outcomes are stored.
- Every state: loading, empty, error, permission-denied, in-progress, terminal
  success and terminal failure.
- A BFF proxy at `apps/web/src/app/api/imports/` following the buffered-body
  pattern.
- Playwright specs in `apps/e2e/specs/` for one import end to end.

## Out of Scope

- Downloading the uploaded file back. It is INTERNAL data the operator already
  has.
- Editing a row and re-committing it through the UI; the operator fixes the
  file.
- XLSX ([[DEC-068]]).

## Acceptance Criteria

- [ ] An operator can upload a customers CSV, see the preview counts, commit,
      and read the summary without leaving the screen.
- [ ] A refusal is shown with the server's own message: wrong content type,
      oversized file, missing required column.
- [ ] Row outcomes distinguish an ERROR from a `suspected duplicate` warning
      visually and in the accessible text, not only by colour.
- [ ] The row table is bounded and paginated; a 5 000-row file does not render 5
      000 rows.
- [ ] Progress polling stops at a terminal state and does not poll forever.
- [ ] The summary survives a page reload because it is read from the stored
      outcomes.
- [ ] The upload action is hidden without `imports.run` and the history without
      `imports.read` — UX only; the backend still refuses.
- [ ] Semantic branding tokens only; the surface-integrity test covers the new
      files.
- [ ] Playwright covers one import end to end.
- [ ] Tests required by the Story pass.

## Domain Invariants

- The UI computes no verdict; every verdict is the server's.
- The file is never re-uploaded by the client between preview and commit.
- No personal data from the file is rendered from the outcomes — the outcomes
  carry row numbers and reasons, not payloads.

## API

### Added

```text
None in the API.
Web (BFF, buffered body): /api/imports and its sub-paths.
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

- None written.

## UI

- `apps/web/src/app/(app)/app/imports/` — the surface.
- The nav gains an `Imports` destination, ungated by feature code ([[DEC-072]]).

## Implementation Summary

_Not implemented._

## Verification

```text
Not run.
```

## Tests Added

- Upload, preview, commit, summary through the mocked BFF, one case per state.
- The warning-versus-error distinction asserted in text.
- The bounded table.
- The BFF proxy: refusal, cookie forward, buffered body.
- Playwright: one import end to end.

## Known Limitations

- To be recorded as implemented.

## Technical Debt

- None new.

## Decisions / ADRs

- [[DEC-072]].

## Files / Modules

- `apps/web/src/app/(app)/app/imports/`, `apps/web/src/app/api/imports/`
- `apps/web/src/components/shell/nav-sidebar.tsx`
- `apps/e2e/specs/`

## Completion Notes

_Status must remain non-done until all required gates pass._
