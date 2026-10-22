---
id: IMP-005
type: story
title: The staff surface
epic: EPIC-19
status: done
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

- [x] An operator can upload a customers CSV, see the preview counts, commit,
      and read the summary without leaving the screen.
- [x] A refusal is shown with the server's own message: wrong content type,
      oversized file, missing required column.
- [x] Row outcomes distinguish an ERROR from a `suspected duplicate` warning
      visually and in the accessible text, not only by colour.
- [x] The row table is bounded and paginated; a 5 000-row file does not render 5
      000 rows.
- [x] Progress polling stops at a terminal state and does not poll forever.
- [x] The summary survives a page reload because it is read from the stored
      outcomes.
- [x] The upload action is hidden without `imports.run` and the history without
      `imports.read` — UX only; the backend still refuses.
- [x] Semantic branding tokens only; the surface-integrity test covers the new
      files.
- [x] Playwright covers one import end to end.
- [x] Tests required by the Story pass.

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

Implemented on `feat/epic-19-imports`.

- **The BFF is a closed `(method, path shape)` allowlist.** The multipart upload
  is forwarded as the parsed `FormData` and fetch writes its own boundary (the
  branding precedent); the JSON routes are buffered as TEXT with the status,
  `content-type` and `x-request-id` preserved. An unknown path, a wrong method,
  an unknown query key, a malformed id, a portal cookie or no session are all
  refused LOCALLY, and a refusal never touches the network.
- **Polling stops by construction**: `refetchInterval` returns the interval only
  for `PREVIEWING`/`COMMITTING` and `false` otherwise, which clears TanStack
  Query's timer. The interval is an exported constant the detail accepts as a
  prop so a test can shorten it.
- The upload form states CSV as the accepted format and surfaces the server's
  own refusal verbatim rather than duplicating the rule — including the `.xlsx`
  message.
- The row table is bounded and paginated at the summary's own ceiling; **an
  ERROR and a `suspected duplicate` warning are distinguishable in TEXT**,
  asserted by requiring the flagged row to never contain the failure wording and
  the failed row to never contain the warning wording.
- The summary is read from the STORED outcomes, so it renders after a reload; a
  test re-mounts the detail and asserts the table is still there.
- `imports.run` hides the upload and the commands; `imports.read` hides the
  history and issues no read. Both are UX only and no page supplies the
  permission list yet, which is stated in a comment and tested through the prop.
- `Imports` joins the nav with **no `requiredFeature`** ([[DEC-072]]).

## Verification

```text
pnpm format-check   PASS
pnpm lint           PASS  (29/29 turbo tasks)
pnpm typecheck      PASS  (29/29)
pnpm build          PASS  (16/16)  — registers /app/imports, its detail and the BFF
pnpm test           PASS  (29/29)
  web 122 files  1343 passed  (+61)
  api 120 files  1760 passed | 266 skipped
```

**The `apps/e2e` spec is written and UNRUN.** Docker is unavailable here, so the
lane has no built apps, no API, no worker and no database. It is statically
valid (`apps/e2e` typecheck and lint exit 0), and its own header states that it
is unrun.

The spec's failing row was written against a rule the product does NOT have: it
used a malformed e-mail, but `createCustomerContactBody.value` is length-only
([[TD-059]]), so that row would have been CREATED and the spec's "find the
FAILED row" step would have thrown on its first real run. It now omits
`display_name`, which `createCustomerBody` itself refuses, so the failure is
real and its reason comes from the shared schema.

## Tests Added

- Upload, preview, commit, summary through the mocked BFF, one case per state.
- The warning-versus-error distinction asserted in text.
- The bounded table.
- The BFF proxy: refusal, cookie forward, buffered body.
- Playwright: one import end to end.

## Known Limitations

- **The Playwright spec has never executed.** Its selectors were written against
  the component source and its flow assumes the lane runs an `import-processing`
  consumer; the first real run is where both get proven.
- **A reload inside the trigger-to-claim window can miss the poll.** A read
  issued right after `POST /imports/:id/preview` can still answer `UPLOADED`,
  because the worker has not claimed the row yet, and the literal polling rule
  would then stop before it started. The surface seeds the accepted phase into
  that job's cache entry so the watch begins immediately; a full reload inside
  that window falls back to the stored state.
- **A malformed UUID is refused as `404`, not `400`**, following the sales and
  scheduling proxy convention. It is still refused locally with no upstream
  call.
- **The entity filter is the API's `?entity=`**, not a browser query string. It
  is a control on the page rather than a URL parameter, so the filtered view is
  not shareable by link.
- [[TD-056]] still applies to the caps, and [[TD-058]] to the artefact's
  retention.

## Technical Debt

- [[TD-057]] — XLSX.
- [[TD-058]] — the artefact's retention has no approved policy behind it.
- [[TD-059]] — no contact format validation anywhere in the product.
- [[TD-056]] — the in-memory boundary cannot prove `take` enforcement.

## Decisions / ADRs

- [[DEC-072]].

## Files / Modules

- `apps/web/src/app/(app)/app/imports/`, `apps/web/src/app/api/imports/`
- `apps/web/src/components/shell/nav-sidebar.tsx`
- `apps/e2e/specs/`

## Completion Notes

All required gates passed on 2026-10-19 except the `apps/e2e` lane, which cannot
run in this environment. The spec is written, statically valid and unrun.
