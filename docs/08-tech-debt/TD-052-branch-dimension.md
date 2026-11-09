---
id: TD-052
type: tech-debt
title: The branch dimension the finance ledgers do not carry
status: resolved
severity: medium
owner: architecture
related_epics:
  - EPIC-18
  - EPIC-13
related_stories:
  - REP-003
  - REP-004
  - REP-008
related_decisions:
  - "DEC-020"
  - "DEC-062"
created: 2026-10-19
updated: 2026-11-05
---

# TD-052 — The branch dimension the finance ledgers do not carry

> **2026-11-03:** being resolved by [[DEC-094]] in four deliveries. MB-001
> (branches and staff assignment) and MB-002 (cash registers, sales and the
> issuance point per branch) are done; stock (MB-003) and report filters
> (MB-004) follow. This debt closes with MB-004.
>
> **2026-11-04:** MB-003 (stock per branch, purchases received into a branch and
> transfers between branches) is done. Only MB-004 remains.
>
> **2026-11-05 — resolved.** MB-004 is done: the commercial, cash, purchase and
> inventory reports (and their CSV exports) take an optional `branchId`, «Todas»
> by default. Sales, cash registers, purchases and stock movements all carry a
> branch now, so the dimension described below exists. The rest of this note is
> kept as the history of why it was missing.

## What does not exist

[[EPIC-18]]'s reports have **no** branch dimension, and this is not an omission
in the reporting layer. It is a property of the aggregates beneath it:

```text
model            branch_id
Appointment      YES  (the only branch-scoped domain aggregate)
Sale             no
Purchase         no
StockMovement    no
StockBalance     no
CashRegister     no   — DEC-020 made cash tenant-wide deliberately
CashSession      no
```

`DEC-020` decided it explicitly: `CompleteSale` creates a cash movement without
a branch, because a sale belongs to a tenant and cash was kept minimal. The
comment is still in `schema.prisma` at the `cash_register` model: "There is no
`branchId` (DEC-020): the register is tenant-wide."

The `multi_branch` feature code exists and is seeded, and the `Branch` model
exists — but nothing that carries money or stock references one.

## Why the reports do not work around it

A report cannot group by a column its source table does not have. Deriving one —
through the appointment, through the register, through a join — would produce a
number whose provenance nobody can state, and the second tenant with two
branches would find it wrong.

[[DEC-062]] records this as a declared boundary rather than a gap to paper over.

## What a fix would need

This is architectural and would need an accepted ADR before any of it:

- A `branch_id` on `sale`, `cash_register`/`cash_session`, `stock_movement` and
  `stock_balance`, each with its composite tenant FK.
- A decision on what an unassigned row means — a tenant with branches but a sale
  made before the column existed.
- A backfill policy that is not a guess.
- A revisit of `DEC-020`, whose minimal-cash decision this would supersede.
- Every existing report and screen acquiring a branch filter that defaults to
  "all" rather than "the caller's branch", or the numbers change for staff who
  did not ask.

## Why it is `accepted` rather than `open`

The MVP has single-branch tenants and PRD §31 asks for no branch cut. The debt
is a recorded boundary, not a pending defect: nothing in the current product is
wrong because of it.

## Pointers

- `packages/database/prisma/schema.prisma` — the `cash_register` comment and
  `Appointment.branchId`, the only branch-scoped aggregate.
- [[DEC-020]] — the minimal-cash decision this would revisit.
- [[DEC-062]] — where the boundary was declared.
