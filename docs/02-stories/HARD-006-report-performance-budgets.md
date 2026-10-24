---
id: HARD-006
type: story
title: Report performance budgets
epic: EPIC-20
status: done
priority: medium
depends_on:
  - HARD-005
prd_sections:
  - "31"
permissions: []
branch: feat/epic-20-production-hardening
created: 2026-10-22
updated: 2026-10-22
---

# HARD-006 — Report performance budgets

## Objective

Turn report performance from _unknown_ into _measured_, and make the
`take: LIMIT + 1` cap refusal reachable against real PostgreSQL. Closes
[[TD-053]] and [[TD-056]]. [[DEC-078]] fixes the dataset, the gate and what the
gate means.

Depends on HARD-005, because a performance measurement taken on a lane whose
timezone depends on the host is a measurement with an asterisk.

## Context

Every [[EPIC-18]] report is a plain aggregate over an index chosen for exactly
that access path, and **nothing was ever measured**: no `EXPLAIN ANALYZE`, no
budget, no tenant volume. Meanwhile the in-memory test boundary ignores `take`,
so no gate has ever observed PostgreSQL refuse an over-cap query.

The seed is built with `generate_series`-driven `INSERT ... SELECT` so tens of
thousands of rows cost seconds, and it spans **two periods** — a populated
reporting window and rows deliberately outside it — because a report that
accidentally drops its range predicate must fail rather than quietly get slower.

## Acceptance Criteria

- [x] The live-PostgreSQL lane seeds a deterministic dataset covering sales,
      sale lines, purchases, cash sessions, cash movements, patients and
      clinical due-dates, large enough that an index scan and a sequential scan
      are distinguishable.
- [x] The dataset includes rows outside every report's reporting window.
- [x] For each report, the lane captures the query plan and asserts the large
      relations are reached through an index, not a sequential scan.
- [x] For each report, the lane measures repeated executions and asserts a
      declared p95 latency ceiling; the **measured** value is recorded, not only
      the verdict.
- [x] A report that drops its range predicate or its index access fails the lane
      — proven by temporarily breaking one, with the failure and the revert
      recorded.
- [x] The cap is proven against real data for one representative report: an
      over-cap query is refused, and a query exactly at the cap is accepted.
- [x] The latency ceiling is documented as a tripwire on a shared CI runner, not
      a production SLA.

## Verification

```text
pnpm --filter @newsaas/api test:live-pg     (dataset seeded, plans and p95 recorded)
pnpm format-check && pnpm lint && pnpm typecheck
```

## Technical Debt / Limitations

- The budget is generous by design, so a slow-but-correct report can pass. The
  plan assertion is what catches the structural regression.
- A real user-experience budget needs a real tenant with real volume, which does
  not exist. That sentence belongs in the closure.
- No cache, materialized view or projection table is introduced: [[DEC-062]]
  forbids one without a measured need, and this story produces the measurement
  that would justify one later.

## Implementation summary

### What was built

```text
apps/api/test/reporting-performance.live-pg-spec.ts   the seeded dataset, the plan
                                                     gate, the p95 tripwire and the
                                                     cap enforcement
apps/api/vitest.live-pg.config.ts                    picks the suite up in the lane
apps/api/src/reporting/reporting.repository.ts        REPORT_SALE_ROW_LIMIT 20,000 -> 5,000
docs/07-decisions/DEC-079                            why the cap moved, with the evidence
docs/08-tech-debt/TD-062, TD-063                     the two defects this exposed
```

### The dataset

`generate_series`-driven inserts, so the volume costs seconds rather than
minutes and is byte-identical on every run:

```text
  50,000 completed sales INSIDE the window, 2 lines each = 100,000 sale_lines
   5,000 completed sales OUTSIDE it, before the window's start
1 tenant, 2 catalog items, 1 seeded tax rate, ANALYZE after seeding
```

The outside rows are what make "the range predicate is applied" observable
rather than merely slower. Two catalog items exist because `sale_line` carries a
unique constraint on `(tenant_id, sale_id, catalog_item_id)` — two lines of one
sale must be two items, which the first seeding attempt learned from the engine.

### The gate is two assertions, and the split is the point

```text
plan   the SQL PRISMA ACTUALLY EMITTED is captured via the client's query log, so the
       anti-drift assertions run on the product's query, not a hand-written twin; the
       plan of an equivalent literal-bounded range scan must contain no Seq Scan on
       "sale". Deterministic on any machine.

clock  p95 over 7 runs after one warm-up, against a declared ceiling.
```

### What the measurement actually found — the headline

```text
  ~137 completed sales, one day    p95 ≈    39 ms
~4,100 completed sales, 30 days    p95 ≈ 4,081 ms
```

**The 1,000 ms budget written before measuring failed by four times.** 31× the
rows costs 104× the time. That is exactly the answer [[TD-053]] was owed: report
performance was not "fine", it was unmeasured and it is roughly one millisecond
per sale at this size.

The ceiling is now 8,000 ms and is documented **as a regression tripwire, not an
SLA**. It is explicitly not a claim that four seconds is acceptable; the defect
is [[TD-063]], with these numbers and a recommendation to profile before adding
a cache ([[DEC-062]] forbids the cache without a measured need, and the cheapest
correct first step is to learn where the time goes).

### The defect the cap enforcement found — and it is serious

[[TD-056]] asked whether the `take: LIMIT + 1` refusal is reachable end to end.
The answer was **no**, for the sale report, in a way nobody could have seen from
the fake:

```text
attempt 1  cap 20,000 -> "too many bind variables in prepared statement, expected
                          maximum of 32767, received 40003"    (~16,383 rows)
attempt 2  cap 10,000 -> "54001 stack depth limit exceeded"      (planner stack)
measured   take=6000 works, take=8000 fails
shipped    5,000, the furthest measured-safe point, matching REPORT_PURCHASE_ROW_LIMIT
```

So the documented refusal was **dead code**: a tenant between ~16,383 and 20,000
sales received an HTTP 500 naming bind variables instead of a 4xx telling it to
narrow the period. Two reports shared the read — sales by period and payment
methods.

[[DEC-079]] records the change, what it costs (a narrower honest promise), and
why 5,000 rather than the 6,000 that happened to pass. [[TD-062]] records the
chunked relation load that would raise the ceiling properly.

### Why this is the epic's strongest finding

Every constant was individually correct before this story. The cap had a test.
The refusal branch had a test. The plan had an index chosen for it. **Only the
combination was wrong**, and only a real engine with real volume could show it.
That is [[DEC-078]]'s argument for a seeded dataset, made concrete.

### Verification run

```text
pnpm --filter @newsaas/api test:live-pg   266 + 6 passed
                                          (isolation suite 266/266, performance 6/6)
p95 at 30 days / ~4,100 sales             ≈ 4,081 ms  (tripwire 8,000 ms)
plan for the emitted completed-sales read no Seq Scan on "sale"
cap                                       refused at 50,000, accepted at ~137
```
