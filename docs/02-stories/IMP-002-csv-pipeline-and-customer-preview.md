---
id: IMP-002
type: story
title: The CSV pipeline and the customer preview
epic: EPIC-19
status: planned
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

_Not implemented._

## Verification

```text
Not run.
```

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

- To be recorded as implemented.

## Technical Debt

- [[TD-057]] — XLSX.

## Decisions / ADRs

- [[DEC-068]], [[DEC-069]].

## Files / Modules

- `apps/api/src/imports/` — the reader, the column map, the heuristic
- `docs/05-modules/Imports.md` — the header contract

## Completion Notes

_Status must remain non-done until all required gates pass._
