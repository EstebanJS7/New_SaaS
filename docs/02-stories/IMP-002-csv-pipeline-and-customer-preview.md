---
id: IMP-002
type: story
title: The CSV pipeline and the customer preview
epic: EPIC-19
status: in-progress
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

- [ ] A CSV is read with RFC 4180 quoting, including a quoted field containing a
      comma, an embedded quote, a newline and a CRLF line ending.
- [ ] A file that is not CSV is refused with its own stable message, and so is
      an `.xlsx` — named as unsupported rather than as a parse failure.
- [ ] Every row is validated with `createCustomerBody`, and a test asserts the
      import imports that schema rather than declaring the rules again.
- [ ] A valid row creates a primary `customer_contact` from the phone/e-mail
      columns.
- [ ] A suspected duplicate is a WARNING on the row, and a test asserts the row
      is still previewed as `CREATE` — the warning can never become a skip.
- [ ] The preview writes no customer. Asserted by counting rows before and
      after.
- [ ] The header contract is declared once and a missing required column fails
      the whole file with a message naming the column.
- [ ] `imports.read`/`imports.run` enforced; the preview is tenant-scoped.
- [ ] Tests required by the Story pass.

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

**Part 1 implemented (the pure pipeline); part 2 — the queue trigger, the worker
consumer and the outcome persistence — pending.** Keeping part 1 pure is
deliberate: it is where the correctness lives and where the tests need no
infrastructure.

Part 1 — commit `WU-B1`:

- **`packages/imports`** mirrors `packages/notifications` and depends only on
  `@newsaas/customers`. No Nest, no database, no queue — it is usable without
  any of them, which is what will let the worker call it.
- **The reader** (`csv.ts`) handles RFC 4180 quoting, `\r\n` and `\n` and a lone
  `\r`, strips a leading BOM (a spreadsheet export usually has one and it would
  corrupt the first header), and has four stable refusals: unterminated quoted
  field, field-count mismatch naming its row, a blank line in the MIDDLE naming
  its row (it would shift every row number after it), and an empty file. A
  trailing blank line is ignored; a row of empty cells is DATA, not a blank
  line.
- **The header contract** is declared once. Headers are normalized (trim,
  lowercase, whitespace runs to `_`); an unknown column is a file-level error
  naming it, because silently ignoring a column risks silently dropping its
  data.
- **Row validation goes through `createCustomerBody` and
  `createCustomerContactBody`, imported from `@newsaas/customers`.** A test
  reads the source and asserts the module declares no `z.object`, no local
  max-length and no `zod` dependency — parity is proved, not promised.
- **The conflict rule**: a row carrying `legal_name` or `tax_id` while `kind` is
  absent or `INDIVIDUAL` is an ERROR naming the column. It is never coerced in
  either direction — an individual's record must not quietly hold a company's
  legal name.
- **The duplicate heuristic is an interface the caller supplies**, so the
  package stays pure. A test asserts a suspected duplicate is still `CREATE`:
  the warning can never become a skip ([[DEC-069]]).
- The contact create schema moved into `packages/customers` behind a shim, so
  the phone and e-mail rules have one home too.

## Verification

```text
pnpm format-check   PASS
pnpm lint           PASS  (28/28 turbo tasks)
pnpm typecheck      PASS  (28/28)
pnpm build          PASS  (16/16)
pnpm test           PASS  (28/28)
  imports         5 files   53 tests (new)
  customers          1 file   7 tests
  api           116 files  1723 passed | 266 skipped   UNCHANGED
```

53 new tests, none of which need a database, a queue or an HTTP server. The api
suite is unchanged at 1723.

**A pre-existing flake was found and fixed here**, because it kept making the
gate red: `notification-delivery.read.integration.test.ts` asserts the response
body matches no `/[+]?\d{9,}|@|\bat\b\s*10:00/`, and nine consecutive decimal
digits occur inside a `randomUUID()` by chance — about 1.5 % per UUID, several
UUIDs per delivery, so roughly one suite failure in four. The scan now masks
UUIDs first, which keeps the assertion's subject (no phone number, address or
payload timestamp reached the projection) and removes the identifier alphabet
that could impersonate one. Three consecutive full-suite runs were green
afterwards, where two of eight had failed before.

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
  an EMAIL contact for exactly the same reason the endpoint does. Adding a
  format check inside the import would make it stricter than the endpoint, which
  is the drift [[DEC-073]] exists to prevent; the fix belongs in the shared
  contract. Recorded as [[TD-059]].
- **A COMPANY row has no `document_number`**, so the document-based duplicate
  heuristic can never fire for one: a company is detected only by its primary
  contact values. Documented in the heuristic rather than worked around, since
  [[DEC-069]] gives `document_number` no unique meaning.
- `kind` is not case-folded: `company` is refused with the create contract's own
  discriminator message rather than silently becoming `COMPANY`, because folding
  case would make the import accept a value `POST /customers` rejects.
- The reader implements exactly the four specified refusals. A `"` that does not
  start a field is a literal character and text after a closing quote continues
  the field; RFC 4180 defines neither, and inventing rules would refuse files
  other tools produce.
- **Part 2 is not implemented**: no queue, no worker consumer, no route, no
  persistence. The story's "the preview writes no customer" assertion and the
  `PREVIEWED` transition land with it.

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
