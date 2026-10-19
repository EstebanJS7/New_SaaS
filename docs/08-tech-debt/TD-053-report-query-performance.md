---
id: TD-053
type: tech-debt
title: Report query performance is unmeasured beyond directed indexes
status: open
severity: low
owner: backend
related_epics:
  - EPIC-18
related_stories:
  - REP-002
  - REP-003
  - REP-004
  - REP-005
  - REP-006
related_decisions:
  - "DEC-063"
created: 2026-10-19
updated: 2026-10-19
---

# TD-053 — Report query performance is unmeasured beyond directed indexes

## What was not done

Every [[EPIC-18]] report is a plain aggregate over an indexed column, with the
index chosen for exactly that access path:

```text
index                                     report
sale         (tenant_id, completed_at)    sales by period, payment methods,
                                          sales by product/service
purchase     (tenant_id, received_at)     purchases
cash_session (tenant_id, closed_at)       cash sessions
clinical_vaccination (tenant_id, next_due_at)   vaccines due
clinical_deworming   (tenant_id, next_due_at)   deworming due
```

What does **not** exist: any measurement. No report has been run against a
tenant with a realistic year of sales, no `EXPLAIN ANALYZE` is recorded, and no
budget exists for what "fast enough" means. The design is defensible on paper —
a composite tenant-first index over a bounded range — and the tests prove
correctness, not latency.

`AGENTS.md`'s complexity budget is the reason this is debt rather than work: a
cache, a materialized view or a pre-aggregation table is forbidden without a
measured need, and fabricating a synthetic dataset to manufacture the need would
be measuring the benchmark rather than the product.

## Why it was deferred

The epic has no production tenant, so the honest position is that performance is
**unknown** rather than **fine**. Recording it as unknown is the point of this
item.

## The trigger that would reopen it

The first tenant whose reports feel slow, or the first readiness review for
[[EPIC-20]] Production Hardening, whichever comes first. At that moment the
shape of the fix is chosen from measurement:

- a covering index, if the range scan is the cost;
- a projection table, if the aggregate itself is;
- a shorter default range, if the user-facing contract is the problem.

## What a fix would touch

- `packages/database/prisma/migrations/` for an index or a projection table.
- `apps/api/src/reporting/`'s repository queries.
- If a projection is chosen: its writer, its backfill and its reconciliation
  against the ledger — the same shape `stock_balance` already has, including the
  advisory-lock lesson [[EPIC-10]] learned the hard way.

## Pointers

- [[DEC-063]] — the 366-day bound that caps the range scan.
- [[DEC-062]] — the constraint against adding a cache or projection without
  measurement.
- [[EPIC-10]] — the ledger-versus-projection race a cache would reintroduce.
