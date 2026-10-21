---
id: IMP-002
type: story
title: The CSV pipeline and the customer preview
epic: EPIC-19
status: done
priority: high
depends_on:
  - IMP-001
prd_sections:
  - "32"
permissions:
  - imports.run
branch: feat/epic-19-imports
created: 2026-10-19
updated: 2026-10-19
---

# IMP-002 — The CSV pipeline and the customer preview

## Objective

Turn the stored artefact into a verdict per row: which rows would create a
customer, which cannot, and which look like somebody already there — without
writing anything.

## Context

[[DEC-068]] ships CSV only and [[DEC-069]] makes the preview's "duplicate" a
warning rather than a rule. The reader is hand-written: RFC 4180 is already
implemented on the export side ([[REP-007]]), and the quoting rules are the same
in both directions.

**The customer contract is the one the single endpoint uses**, verified:
`createCustomerBody` is a strict discriminated union on `kind`. `INDIVIDUAL`
requires `displayName` (1..200) and accepts optional `firstName`/`lastName`
(1..100) and `documentNumber` (1..50); `COMPANY` requires `legalName` (1..200)
and `taxId` (1..32). A customer may exist with no contact and no address.

## In Scope

- The CSV reader: quoting, doubled quotes, embedded newlines, CRLF, a header
  row, and a stable rejection for a file that is not CSV at all.
- The customer column map, declared in ONE place, with a documented header
  contract.
- Row validation through **`createCustomerBody`** — the same schema the endpoint
  uses, imported, not re-implemented.
- The primary contact: a customer's phone or e-mail is what makes the record
  useful in a clinic, so the file carries them and a valid row creates a primary
  `customer_contact` alongside. The contact's own rules come from
  `customerContactCreateBody`, imported.
- The duplicate heuristic ([[DEC-069]]): one function, documented, with its own
  tests, reporting a suspected match by document number or primary contact
  value. It is a warning and it changes nothing about what the row would do.
- The preview pass over the stored artefact, persisting one `import_row_outcome`
  per row and moving the import to `PREVIEWED`.

## Out of Scope

- Committing anything. [[IMP-003]].
- Addresses in the file. A customer may have none, and importing postal
  addresses is a second column map nobody asked for.
- Updating an existing customer ([[DEC-069]]).
- XLSX ([[DEC-068]]).

## Acceptance Criteria

- [x] A CSV is read with RFC 4180 quoting, including a quoted field containing a
      comma, an embedded quote, a newline and a CRLF line ending.
- [x] A file that is not CSV is refused with its own stable message, and so is
      an `.xlsx` — named as unsupported rather than as a parse failure.
- [x] Every row is validated with `createCustomerBody`, and a test asserts the
      import imports that schema rather than declaring the rules again.
- [x] A valid row creates a primary `customer_contact` from the phone/e-mail
      columns.
- [x] A suspected duplicate is a WARNING on the row, and a test asserts the row
      is still previewed as `CREATE` — the warning can never become a skip.
- [x] The preview writes no customer. Asserted by counting rows before and
      after.
- [x] The header contract is declared once and a missing required column fails
      the whole file with a message naming the column.
- [x] `imports.read`/`imports.run` enforced; the preview is tenant-scoped.
- [x] Tests required by the Story pass.

## Domain Invariants

- The import carries no second copy of any validation rule.
- A preview never writes a business record; its only writes are the row
  outcomes.
- A heuristic result is labelled as suspected, in the message and in the
  summary.

## API

### Added

```text
POST /imports/:id/preview   → { state, counts }
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

- Reads and writes `import_job` and `import_row_outcome`.
- Reads `customer` and `customer_contact` for the duplicate heuristic only.

## UI

- None. Consumed by [[IMP-005]].

## Implementation Summary

Implemented in two commits: `WU-B1` the pure pipeline, `WU-B2` the queue, the
trigger and the worker.

**Part 1 — the pure pipeline** (`packages/imports`, depends only on
`@newsaas/customers`, no Nest, no database, no queue): the RFC 4180 reader with
four stable refusals and BOM handling; the single header contract; row
validation through the IMPORTED `createCustomerBody` and
`createCustomerContactBody`, with a test that reads the source and asserts no
`z.object`, no local max-length and no `zod` dependency; the conflict rule; and
the planner.

**Part 2 — the wiring:**

- `packages/imports` gained the queue contract (`import-processing` /
  `preview`), a job id built with a hyphen because BullMQ refuses a colon in a
  custom id, and an injected-queue producer.
- `runCustomerPreview` is orchestration over narrow interfaces: **`claim()`
  first**, so a replayed job or a lost race writes NOTHING and returns
  `SKIPPED`. A thrown error is turned into `FAILED` rather than rethrown,
  because the row already carries the failure and BullMQ must not retry a job
  whose claim can never be taken again.
- `POST /imports/:id/preview` enqueues and answers `202`; it refuses a
  non-`UPLOADED` import with the aggregate's `409` before touching the queue.
- The worker handler loads the row and **takes the tenant FROM the row** — the
  only place in the import path where a tenant does not come from a request
  context — reads the artefact through `STORAGE_PORT`, prefetches the duplicate
  candidates tenant-scoped, runs the runner, and persists the outcomes with the
  counters inside the transitions, co-committing the audit rows.
- The audit action codes moved into `packages/imports` so the API and the worker
  cannot drift on them.

## Verification

```text
pnpm format-check   PASS
pnpm lint           PASS  (29/29 turbo tasks)
pnpm typecheck      PASS  (29/29)
pnpm build          PASS  (16/16)
pnpm test           PASS  (29/29)
  imports         7 files   65 tests
  worker         19 files  261 tests  (was 245)
  api           118 files  1738 passed | 266 skipped  (was 1723)
  customers       1 file     7 tests
  web           118 files  1282 passed
```

Turbo went 28 → **29 tasks**. Every count delta is tests this Story added: api
+15, worker +16, imports +12.

## Tests Added

- The reader: every quoting case above, an empty file, a header-only file.
- The column map: missing column, unknown column, wrong order tolerated by
  header name.
- Validation parity: a row rejected by the import is rejected by the endpoint
  with the same reason.
- The contact created on commit is primary.
- The heuristic: a true positive, a false positive (still created), and the case
  it cannot detect (no document, no contact).
- The preview writes no customer.

## Known Limitations

- **Contact values are validated by LENGTH ONLY**, because that is all
  `createCustomerContactBody` requires. The import accepts `"not-an-email"` as
  an EMAIL contact for exactly the same reason the endpoint does; adding a
  format check here would make the import stricter than the endpoint. Recorded
  as [[TD-059]].
- **A COMPANY row has no `document_number`**, so the document-based duplicate
  heuristic can never fire for one: a company is detected only by its primary
  contact values.
- `kind` is not case-folded: `company` is refused with the create contract's own
  discriminator message rather than silently becoming `COMPANY`.
- **The duplicate lookup is a PREFETCH.** The planner's `DuplicateLookup` is
  synchronous, so the worker collects the candidate values from the parsed file
  first (chunked, 500 per query) and answers from two sets. Two consequences:
  the artefact is read before the claim, so a lost claim costs one wasted object
  read; and a very large file costs one round trip per batch. Making the lookup
  async would change part 1's planner signature and its 53 tests.
- **A preview interrupted by process death leaves the row `PREVIEWING` with no
  writer.** The TTL sweep is the operator's only route until a recovery pass
  exists.
- **The `PATIENT` preview is refused at the API** with its own message, because
  its column map arrives with [[IMP-004]]. The worker also refuses a `PATIENT`
  job rather than failing it: `FAILED` is terminal, so failing it would strand
  the import the day the patient map lands.
- **The preview HTTP suite composes its own module graph** instead of using
  `bootTestApp()`. It registers the same chain in the same order
  (`AuthModule → TenancyModule → RbacModule`, plus `CommonModule` and
  `ImportsModule`), but a reconstruction is not the real graph and it can drift
  when the harness changes. This Story could not use the harness because the
  producer factory needed an override there; the parent added it afterwards, so
  switching this suite is now a cheap cleanup rather than a blocker.
- The reader implements exactly the four specified refusals. A `"` that does not
  start a field is a literal character and text after a closing quote continues
  the field; RFC 4180 defines neither.

## Technical Debt

- [[TD-057]] — XLSX.
- [[TD-059]] — no contact format validation anywhere in the product.

## Decisions / ADRs

- [[DEC-068]], [[DEC-069]].

## Files / Modules

- `apps/api/src/imports/` — the reader, the column map, the heuristic
- `docs/05-modules/Imports.md` — the header contract

## Completion Notes

_Status must remain non-done until all required gates pass._
