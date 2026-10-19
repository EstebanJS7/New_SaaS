---
id: DEC-064
type: decision
title:
  Business-event timestamps become the reporting truth for sales, purchases and
  cash
status: accepted
date: 2026-10-19
related_epics:
  - "EPIC-18"
  - "EPIC-11"
  - "EPIC-12"
  - "EPIC-13"
related_decisions:
  - "DEC-023"
  - "DEC-031"
  - "DEC-014"
related_stories:
  - "REP-001"
prd_change_required: false
---

# DEC-064 — Event timestamps for sales, purchases and cash

## Context

The exploration of `packages/database/prisma/schema.prisma` found a gap in three
already-`done` epics, not in the reporting epic:

```text
model           status column   event timestamp    columns present
Sale            DRAFT           none               created_at, updated_at
                COMPLETED
                CANCELLED
Purchase        DRAFT           none               created_at, updated_at
                RECEIVED
                CANCELLED
CashSession     OPEN            none               opened_at, created_at,
                CLOSED                             updated_at
```

Meanwhile the neighbouring aggregates that were designed later already carry the
instant: `Invoice.confirmedAt`/`cancelledAt` and `ClinicalEncounter.closedAt`.

The consequence for PRD §31 is direct: "sales by period" is the report the PRD
names first, and it cannot be answered. A `sale` created on Monday and completed
on Wednesday would be counted on Monday. Using `updated_at` filtered by
`status = COMPLETED` happens to give the right instant today, because a
completed sale is immutable — but that is an _implicit invariant nothing
enforces_, and it is not uniform: `cash_movement` is append-only and has **no**
`updated_at` at all, so the same rule cannot be applied to the movement report.

## Question

Where does a period report get the business event instant for sales, purchases
and cash session closes?

## Options

### Option A — Add the three columns and write them in the existing terminal commands (accepted)

```text
sale.completed_at          written by CompleteSale          (EPIC-12, DEC-023)
purchase.received_at       written by the receive command   (EPIC-11, DEC-014)
cash_session.closed_at     written by the close command     (EPIC-13, DEC-031)
```

All three nullable, `TIMESTAMPTZ(3)`, set inside the transaction that already
performs the transition. Indexed for the range scans the reports need. The
migration backfills `updated_at` into them for rows already in a terminal state,
which is exact for an immutable terminal row.

This is correct rather than convenient: "when the sale happened" becomes a
stored fact instead of a derived guess, and the report reads the same column the
domain would cite if anybody asked.

### Option B — Report on `updated_at` with a terminal-status filter

Zero schema, zero writer changes. Rejected: the rule is an unenforced invariant,
it silently rewrites history if a terminal row is ever touched, and it is not
expressible on `cash_movement`, which has no `updated_at`. A report whose
historical numbers depend on nothing having modified a row since is a report
nobody should trust.

### Option C — Report on `created_at`

Rejected. It answers "when was this started", which is a different question, and
for a POS draft it is routinely a different day.

## Decision

Accepted by the maintainer on 2026-10-19.

**`sale.completed_at`, `purchase.received_at` and `cash_session.closed_at` are
added and written by the commands that already own those transitions.** Reports
read those columns. `created_at` is never a substitute for them.

The crossings this creates are declared, not smuggled:

- **EPIC-12** (`CompleteSale`, [[DEC-023]]) gains one assignment inside its
  existing transaction.
- **EPIC-11** (the receive command, [[DEC-014]]) gains one assignment inside its
  existing transaction.
- **EPIC-13** (the close command, [[DEC-031]]) gains one assignment inside its
  existing transaction.

No new transition is introduced, no state machine changes, and no endpoint
changes shape. Each assignment is idempotent by construction because each
command is.

## Consequences

### Product

"Sales by period" means completed sales, dated when they were completed. A draft
is never revenue, and a cancelled sale never disappears retroactively from a
closed period because its `completed_at` is NULL.

### Architecture

Three columns on three existing immutable-once-terminal aggregates. No new
table, no event store, no projection.

### Database/API

One migration: three nullable `timestamptz(3)` columns, three indexes supporting
the report range scans, and a backfill of `updated_at` for rows already
terminal. The response DTOs of the affected aggregates expose the instant, which
is a strictly additive change to their contract.

### Delivery

[[REP-001]] is the whole prerequisite and touches no report code. Its tests are
the existing command tests plus three assertions that the instant is written
once and never rewritten — including the refusal path, where a second
`CompleteSale` leaves the original instant intact.

## PRD Update

No PRD change. The PRD asked for the report; the schema could not answer it;
this decision makes the schema answer it.
