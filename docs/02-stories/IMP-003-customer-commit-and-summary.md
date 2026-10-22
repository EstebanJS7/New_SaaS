---
id: IMP-003
type: story
title: The customer commit and its summary
epic: EPIC-19
status: done
priority: high
depends_on:
  - IMP-002
prd_sections:
  - "32"
permissions:
  - imports.run
branch: feat/epic-19-imports
created: 2026-10-19
updated: 2026-10-19
---

# IMP-003 — The customer commit and its summary

## Objective

Apply what the preview promised: create the valid customers, refuse the invalid
ones, and leave a summary that states exactly what happened — per row and in
total.

## Context

[[DEC-071]] made the commit partial and per-row transactional. [[DEC-072]] made
it asynchronous and bound it to the artefact the preview read.

The commit is the epic's most dangerous half: a mistake here means records that
exist while the summary says otherwise, or an operator who cannot tell what
landed.

## In Scope

- The queued commit: one BullMQ consumer reading the same stored artefact,
  driven from the `PREVIEWED` state.
- Per-row transaction: the customer plus its primary contact plus the
  `customer.created` audit row, through the existing `CustomersService.create` —
  the import is a caller, not a second writer.
- The three counters persisted on the import, and the terminal state.
- The summary: a bounded, paginated read of the row outcomes with their reasons,
  plus the totals.
- The refusal: a file with no valid row at all commits nothing and ends `FAILED`
  with its own message.
- Idempotency: a replayed commit for an import already terminal does nothing and
  says so.

## Out of Scope

- Changing a row's verdict between preview and commit beyond a re-validation,
  which must produce the same answer because it is the same schema and the same
  file.
- Rollback of committed rows ([[DEC-071]] and the epic's Out of Scope).
- The patient import ([[IMP-004]]).

## Acceptance Criteria

- [x] The commit is queued, runs in the worker, and the import reaches a
      terminal state without the API holding the work open.
- [x] Each valid row creates the customer, its primary contact and its audit row
      in one transaction; a failure in the middle of a row leaves no
      half-created customer.
- [x] A failure in the middle of the FILE leaves the earlier rows committed, and
      the summary states that.
- [x] The summary's counts equal the row outcomes: created + failed + suspected
      duplicates is consistent with the rows read.
- [x] A suspected duplicate is still CREATED ([[DEC-069]]), and a test asserts
      it.
- [x] A file with zero valid rows commits nothing, ends `FAILED`, and names the
      reason.
- [x] A replayed commit on a terminal import does nothing and returns the stored
      summary.
- [x] The commit reads the artefact the preview read, and a test asserts the
      storage key is the same one.
- [x] Tenant isolation; a foreign import id is a `404`.
- [x] Tests required by the Story pass.

## Domain Invariants

- The import never writes a business record directly; it calls the owning
  service.
- Every created record is indistinct from one created by hand: same validation,
  same audit action, same transaction shape.
- A terminal import is terminal.

## API

### Added

```text
POST /imports/:id/commit    → { state }     (queues the work)
GET  /imports/:id/summary   → totals + a bounded page of row outcomes
```

### Changed

```text
None
```

## Database

### Migration

```text
None — IMP-001 owns the tables.
```

### Models/Tables

- `import_job` (state + counters), `import_row_outcome`, and through the
  service: `customer`, `customer_contact`, `audit_log`.

## UI

- None. Consumed by [[IMP-005]].

## Implementation Summary

Implemented on `feat/epic-19-imports`.

- **`createCustomer` gained optional contacts**, written inside the SAME
  transaction with the endpoint's own `customer_contact.created` audit action
  matched byte for byte. Additive: `POST /customers` does not pass them and its
  behaviour is unchanged. Without this a customer imported with a phone number
  could have existed without it.
- **The commit is preview-authoritative.** It reads the STORED outcomes and
  creates only the rows the preview marked `CREATE`. A row the preview refused
  is never retried and an accepted row is never re-validated into a different
  answer, which is what makes "commit what you saw" literally true rather than a
  convention.
- **`runCustomerCommit` claims first**, like the preview: a replayed job finds
  the row no longer `PREVIEWED`, `claim()` returns `false`, and nothing happens.
- **One transaction per row.** A failure on row N rolls back that row only,
  records it through `failRow`, and the run CONTINUES — [[DEC-071]]'s partial
  success. A file with zero accepted rows commits nothing, ends `FAILED` and
  names the reason, because committing nothing is not a partial success.
- The suspected-duplicate warning survives the commit as a counter, so the
  summary can still report it ([[DEC-069]]).
- `POST /imports/:id/commit` enqueues (`202`) and refuses every non-`PREVIEWED`
  state with the aggregate's `409` before the queue; `GET /imports/:id/summary`
  returns the totals plus a bounded page read at the DATABASE (`take`/`skip` in
  the query), so a reload reads the same summary.
- One consumer, two job names, dispatched by name — no second queue.

## Verification

```text
pnpm format-check   PASS
pnpm lint           PASS  (29/29 turbo tasks)
pnpm typecheck      PASS  (29/29)
pnpm build          PASS  (16/16)
pnpm test           PASS  (29/29)
  customers       1 file     9 tests  (+2)
  imports         8 files   85 tests  (+20)
  worker         20 files  276 tests  (+15)
  api           120 files  1758 passed | 266 skipped  (+20)
  patients        1 file     8 tests
  web           118 files  1282 passed
```

The `@newsaas/*` packages resolve through `dist/`, so `pnpm --filter <pkg> test`
alone does not see a package's source change — turbo's `test` depends on
`^build` and the plain filter does not. Both packages were rebuilt before the
api and worker runs.

## Tests Added

- The three counts against a file mixing valid, invalid and duplicate rows.
- A mid-file failure leaves earlier rows committed and the summary says so.
- The zero-valid-rows refusal.
- The replay.
- The same-artefact assertion.
- Tenant isolation.

## Known Limitations

- **The artefact is NOT deleted on the worker's terminal path.** It is deleted
  by the API's addressed commands and by the TTL sweep (bounded, tested), so a
  finished import keeps its uploaded file until the deadline. The module doc
  previously claimed deletion "as soon as the job reaches a terminal state"; it
  now states the truth. Follow-up: have the worker stamp `artefact_deleted_at`
  and delete on `COMMITTED`/`FAILED`. [[TD-058]] already owns the
  retention-policy question behind it.
- **The `CommitWriter` lives in `@newsaas/imports`, not in the worker**, because
  `apps/worker` does not depend on `@newsaas/customers`. The call is still
  `createCustomer` inside the transaction that function opens; only the
  factory's home differs from where one would look first.
- **The in-memory boundary ignores `take`/`skip`** for row outcomes, so the HTTP
  suite proves the page is echoed, ordered and that the ceiling is refused,
  while the actual slice is proven against the repository's query in
  `imports.row-outcomes.test.ts`. [[TD-056]] records the class of gap.
- The summary page ceiling is **500** (default 100), a number this Story chose
  and the module doc records.
- `ImportsService.startCommit`/`completeCommit` remain unused by the HTTP
  surface, like `startPreview`. Removing a command from the state machine is a
  change to the machine, so they stay and are documented as such.

## Technical Debt

- [[TD-057]] — XLSX.
- [[TD-058]] — the artefact's retention has no approved policy behind it.
- [[TD-059]] — no contact format validation anywhere in the product.
- [[TD-056]] — the in-memory boundary cannot prove `take` enforcement.

## Decisions / ADRs

- [[DEC-069]], [[DEC-071]], [[DEC-072]].

## Files / Modules

- `apps/api/src/imports/`, `apps/worker/src/imports/`
- `apps/api/src/customers/` — called, not modified

## Completion Notes

All required gates passed on 2026-10-19.
