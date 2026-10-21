---
id: IMP-003
type: story
title: The customer commit and its summary
epic: EPIC-19
status: planned
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

- [ ] The commit is queued, runs in the worker, and the import reaches a
      terminal state without the API holding the work open.
- [ ] Each valid row creates the customer, its primary contact and its audit row
      in one transaction; a failure in the middle of a row leaves no
      half-created customer.
- [ ] A failure in the middle of the FILE leaves the earlier rows committed, and
      the summary states that.
- [ ] The summary's counts equal the row outcomes: created + failed + suspected
      duplicates is consistent with the rows read.
- [ ] A suspected duplicate is still CREATED ([[DEC-069]]), and a test asserts
      it.
- [ ] A file with zero valid rows commits nothing, ends `FAILED`, and names the
      reason.
- [ ] A replayed commit on a terminal import does nothing and returns the stored
      summary.
- [ ] The commit reads the artefact the preview read, and a test asserts the
      storage key is the same one.
- [ ] Tenant isolation; a foreign import id is a `404`.
- [ ] Tests required by the Story pass.

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

_Not implemented._

## Verification

```text
Not run.
```

## Tests Added

- The three counts against a file mixing valid, invalid and duplicate rows.
- A mid-file failure leaves earlier rows committed and the summary says so.
- The zero-valid-rows refusal.
- The replay.
- The same-artefact assertion.
- Tenant isolation.

## Known Limitations

- To be recorded as implemented.

## Technical Debt

- [[TD-058]] — the artefact's retention.

## Decisions / ADRs

- [[DEC-069]], [[DEC-071]], [[DEC-072]].

## Files / Modules

- `apps/api/src/imports/`, `apps/worker/src/imports/`
- `apps/api/src/customers/` — called, not modified

## Completion Notes

_Status must remain non-done until all required gates pass._
