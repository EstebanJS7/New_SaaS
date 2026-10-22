---
id: HARD-006
type: story
title: Report performance budgets
epic: EPIC-20
status: planned
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

- [ ] The live-PostgreSQL lane seeds a deterministic dataset covering sales,
      sale lines, purchases, cash sessions, cash movements, patients and
      clinical due-dates, large enough that an index scan and a sequential scan
      are distinguishable.
- [ ] The dataset includes rows outside every report's reporting window.
- [ ] For each report, the lane captures the query plan and asserts the large
      relations are reached through an index, not a sequential scan.
- [ ] For each report, the lane measures repeated executions and asserts a
      declared p95 latency ceiling; the **measured** value is recorded, not only
      the verdict.
- [ ] A report that drops its range predicate or its index access fails the lane
      — proven by temporarily breaking one, with the failure and the revert
      recorded.
- [ ] The cap is proven against real data for one representative report: an
      over-cap query is refused, and a query exactly at the cap is accepted.
- [ ] The latency ceiling is documented as a tripwire on a shared CI runner, not
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
