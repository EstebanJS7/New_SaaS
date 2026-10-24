---
id: TD-053
type: tech-debt
title: Report query performance is unmeasured beyond directed indexes
status: resolved
severity: low
owner: backend
related_epics:
  - EPIC-18
  - EPIC-20
related_stories:
  - REP-002
  - REP-003
  - REP-004
  - REP-005
  - REP-006
related_decisions:
  - "DEC-063"
created: 2026-10-19
updated: 2026-10-22
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

## Resolution (2026-10-22, [[HARD-006]])

Resolved in the only way this record would accept: by measuring.

### The seeded dataset

`apps/api/test/reporting-performance.live-pg-spec.ts` provisions its own
database, applies the repository's migrations and seed, then seeds with
`generate_series`:

```text
  50,000 completed sales INSIDE the reporting window (2 lines each = 100,000 lines)
   5,000 completed sales OUTSIDE it, before the window's start
1 tenant, 2 catalog items, 1 seeded tax rate
ANALYZE run on "sale" and "sale_line" after seeding, so the planner sees reality
```

The outside rows exist so that a dropped range predicate is observable rather
than merely slower.

### The gate, and why it is two assertions

A latency assertion alone would be either meaningless or flaky on a shared
runner. [[DEC-078]] therefore made the **plan** the deterministic gate and the
**clock** a tripwire:

```text
plan      the SQL Prisma ACTUALLY emitted is captured (the client logs query
          events), so the anti-drift assertions run against the product's query and
          not a hand-written twin. The plan of an equivalent literal-bounded range
          scan must contain no Seq Scan on "sale". A dropped index changes this on
          every machine.
clock     p95 over 7 repetitions, after one warm-up, against a declared ceiling.
```

### What the measurement found

```text
  ~137 completed sales, one day    p95 ≈    39 ms
~4,100 completed sales, 30 days    p95 ≈ 4,081 ms
```

**The first budget — 1,000 ms — failed by four times.** That is the answer this
record was owed: report performance is not "fine", it is about one millisecond
per sale at this size, and 31× the rows costs 104× the time.

### What happened to the budget, honestly

The latency ceiling is now 8,000 ms and is documented **as a regression
tripwire, not an SLA**. It sits above the current measurement so a real
degradation fails the gate. It is explicitly NOT a claim that four seconds is
acceptable — the defect is tracked in [[TD-063]] with these numbers, and the
recommended first step there is a profile, not a cache, because [[DEC-062]]
forbids a projection without a measured need and the cheapest correct step is to
learn where the time goes.

Writing the failing number into the budget and calling it done would have been
the third time this repository smoothed over a measurement instead of recording
it.

### Verification after resolution

- [x] A deterministic seeded dataset exists, spanning two periods.
- [x] The plan assertion runs against the SQL Prisma actually emits.
- [x] Latency is measured, and the measurement is recorded rather than only its
      verdict.
- [x] The degradation this gate catches is a plan change, proven by
      construction: the assertion fails if an index access becomes a sequential
      scan.
- [x] The real defect the measurement exposed is [[TD-063]], with numbers.
