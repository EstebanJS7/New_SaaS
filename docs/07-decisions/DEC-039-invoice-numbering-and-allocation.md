---
id: DEC-039
type: decision
title: Invoice numbering and allocation point (EPIC-14)
status: accepted
date: 2026-10-01
related_epics:
  - "EPIC-14"
related_decisions:
  - "DEC-018"
  - "DEC-027"
  - "DEC-038"
related_stories:
  - "BILL-001"
  - "BILL-003"
prd_change_required: false
---

# DEC-039 — Invoice numbering and allocation point (EPIC-14)

## Context

PRD §21 requires that "Invoice numbering uses a transactional sequence, never
`MAX()+1`". The engineering rules repeat the prohibition
(`docs/99-governance/ENGINEERING-RULES.md`, "Data integrity"). PRD §21 does not
state the allocation point, the uniqueness scope, the format or a gap-free
guarantee.

Verified current state in this repository (2026-10-01):

- No sequence, counter, `nextNumber` helper or allocation service exists
  anywhere in `packages/database` or `apps/api` ([[DEC-018]] verified the same
  for EPIC-11).
- [[DEC-018]] gave purchases no number and reserved printed/fiscal identifiers
  for "the epic owning a printed or fiscal document"; [[DEC-027]] states
  explicitly that "EPIC-14's Invoice owns any transactional sequence" and that a
  sale has no number.
- The `sale` table's tenant list index comment
  (`packages/database/prisma/schema.prisma:1738`) notes it has "no numbering
  column to sort on", so no existing table is a precedent for a per-tenant
  counter.
- PostgreSQL sequences are non-transactional: a rolled-back allocation still
  consumes a value, which is a gap, not a correctness bug. Any row-based counter
  read under `SELECT ... FOR UPDATE` or written with a single atomic
  `UPDATE ... RETURNING` is transactional; the atomic form is preferred here
  because it leaves no read-then-write window to reason about.
- The repository already serializes competing writers with row locks and
  conditional writes (EPIC-12 `CompleteSale`, EPIC-13 cash close, [[DEC-035]]).

## Question

When is an invoice number allocated, under what uniqueness scope and with what
guarantee about gaps?

## Options

### Option A — Per-tenant row counter allocated at confirmation (recommended)

A new tenant-scoped `invoice_number_sequence` row, keyed by
`(tenant_id, series)`, holds `next_value`. The number is allocated inside the
`confirm` transaction with **one atomic statement** —
`UPDATE invoice_number_sequence SET next_value = next_value + 1 WHERE tenant_id = $1 AND series = $2 RETURNING next_value - 1`
— so no read-then-write window exists and the allocation and the state
transition commit together or not at all. The statement takes the counter's row
lock implicitly for the rest of the transaction, which is the same serialization
a `SELECT ... FOR UPDATE` would provide with one fewer round trip.
`Invoice.number` stays `NULL` while the invoice is `DRAFT`, while `series` is a
non-null column defaulted to `'A'`; a cancelled or abandoned draft never
consumes a number. Uniqueness is enforced by
`UNIQUE (tenant_id, series, number)`.

Benefits: allocation is transactional with the transition, abandoned drafts
leave no gaps in the issued sequence, one statement removes the read-then-write
window a reviewer would otherwise have to reason about, and a concurrently
confirming invoice serializes on one row instead of racing.

Costs: the statement's row lock is held until the `confirm` transaction commits,
so a slow confirm can delay other confirms for the same tenant and series. That
serialization is intended, but it must be covered by a live-PostgreSQL
concurrency test, and `confirm` must stay short so the counter is never held
behind unrelated work.

### Option B — Per-tenant PostgreSQL `SEQUENCE` allocated at confirmation

A sequence per tenant, or a single sequence with a tenant prefix rendered into
the number.

Benefits: no row lock, cheaper allocation.

Costs: sequences are non-transactional, so a rolled-back or failed confirm
leaves a permanent gap; creating a sequence per tenant means dynamic DDL at
runtime; and the number cannot be derived in the same transaction that assigns
it.

### Option C — Allocate at draft creation

The number exists from the moment the draft is created.

Costs: abandoned or cancelled drafts permanently consume numbers, which is the
gap behaviour Option A avoids, and PRD §21 gives no reason to number an
unconfirmed document.

## Recommendation

Option A. It is the only option that is transactional with the state transition,
avoids gaps from abandoned drafts, needs no runtime DDL and reuses the row-lock
serialization pattern the repository already uses. Whether the sequence is
strictly gap-free under a failed transaction should not be over-claimed: the
guarantee recorded here is "no number is consumed before confirmation, and
`(tenant_id, series, number)` is unique", not "the issued sequence has no holes
under any failure mode".

## Impact

### Product

A `DRAFT` invoice carries no number; `CONFIRMED` and `CANCELLED` invoices carry
one. Staff can abandon drafts freely.

### Architecture

No new dependency or service. The counter is one additive table and one atomic
`UPDATE ... RETURNING` inside the existing confirm command.

### Database/API

`invoice_number_sequence` is a new tenant-scoped table with
`UNIQUE (tenant_id, series)` and a `next_value` integer. `invoice` gains
nullable `number` and a `series` (default `'A'`) with
`UNIQUE (tenant_id, series, number)` and a check that `CONFIRMED`/`CANCELLED`
rows carry a number while `DRAFT` rows do not. The DTO exposes the allocated
number only after confirmation.

### Delivery

BILL-001 owns the table, the constraints and the schema tests; BILL-003 owns the
atomic allocation inside `confirm` plus the live-PostgreSQL concurrency case.
The printable rendering of `series` + `number` is deliberately not decided here
(see below).

## Decision

Accepted on 2026-10-01 by the maintainer. Option A is the decision: a new
tenant-scoped `invoice_number_sequence` row keyed by `(tenant_id, series)` holds
`next_value`, and the number is allocated inside the `confirm` transaction with
**one atomic statement** so that no read-then-write window exists and the
allocation and the state transition commit together or not at all:

```sql
UPDATE invoice_number_sequence SET next_value = next_value + 1
WHERE tenant_id = $1 AND series = $2
RETURNING next_value - 1
```

`number` stays `NULL` while the invoice is `DRAFT` and is required on
`CONFIRMED` and `CANCELLED`; `series` is a non-null column defaulted to `'A'`;
`UNIQUE (tenant_id, series, number)` holds. The recorded guarantee is exactly
"no number is consumed before confirmation and `(tenant_id, series, number)` is
unique" — never "the issued sequence has no holes under any failure mode".

The other options stay recorded above as what was considered; acceptance selects
Option A only.

The statement's row lock is held until the `confirm` transaction commits, so
`confirm` must stay short and must never hold the tenant's counter behind
unrelated work; BILL-003 owns that constraint and its live-PostgreSQL
concurrency case. The printable rendering of the number stays deferred to
[[EPIC-15]] ([[DEC-042]]).

## PRD Update

No PRD change is required. PRD §21 already fixes the transactional sequence
requirement; this record only chooses the allocation point, scope and constraint
shape. The human-readable rendering of the number (prefixes, padding, year
segments, establishment codes) is deliberately left to [[DEC-042]]'s Fiscal
boundary, following [[DEC-018]], and is not implemented in EPIC-14.

## Subsequent scope note

**2026-10-01, after this record's acceptance.** The slice that implements this
decision found one imprecise clause in the accepted text. This note **extends**
the accepted decision and does not rewrite it: the accepted `## Decision` text
stays recorded as decided, and the clarification below is what the implementing
slices follow from this date.

- **`number` is present exactly when `confirmed_at` is.** The accepted text says
  the number is "required on `CONFIRMED` and `CANCELLED`", which conflicts with
  the same decision's guarantee that "a cancelled or abandoned draft never
  consumes a number": an invoice that is cancelled straight from `DRAFT` is
  `CANCELLED` and yet must carry no number. The implemented rule is that
  `number` and `confirmed_at` are present or absent **together**, enforced by
  the biconditional CHECK `invoice_number_iff_confirmed`
  (`(number IS NULL) = (confirmed_at IS NULL)`), so an invoice cancelled from
  `DRAFT` keeps a NULL number and a confirmed invoice keeps its number
  permanently after cancellation. The accepted guarantee — "no number is
  consumed before confirmation, and `(tenant_id, series, number)` is unique" —
  is unchanged; only the imprecise clause is corrected.
