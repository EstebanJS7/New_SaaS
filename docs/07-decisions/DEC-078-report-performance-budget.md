---
id: DEC-078
type: decision
title:
  Report performance is a seeded dataset plus a declared latency budget, gated on
  the query plan as well as the measurement
status: accepted
date: 2026-10-22
related_epics:
  - "EPIC-18"
  - "EPIC-20"
related_decisions:
  - "DEC-062"
  - "DEC-063"
related_stories:
  - "HARD-006"
prd_change_required: false
---

# DEC-078 — What "fast enough" means, and why the gate is the plan and not only the clock

## Context

[[TD-053]] records the position honestly: every [[EPIC-18]] report is a plain
aggregate over an indexed column, the index was chosen for exactly that access
path, and **nothing was ever measured**. No `EXPLAIN ANALYZE` is recorded, no
budget exists, and no report has run against a tenant with a realistic year of
activity. The status of report performance in this repository is *unknown*, not
*fine*.

[[TD-056]] adds the second half of the same problem: the in-memory test boundary
ignores `take`, and no reporting block exists in the live-PostgreSQL lane, so the
`take: LIMIT + 1` cap refusal that every reporting read depends on has never been
observed against the engine that has to enforce it.

Both are unmeasurable without data. Seeding it is the work.

## Question

Against what data, with what budget, and which assertion actually catches a
regression?

## Options

**A. Latency budget only.** Seed a dataset and assert each report's p95 is under a
declared ceiling.

**B. Query plan only.** Seed a dataset, run `EXPLAIN` on each report and assert the
plan uses the intended index and does not sequentially scan a large relation.

**C. Both**: the plan as the deterministic gate, the latency as a coarse tripwire,
and the measured numbers recorded as evidence either way.

**D. No measurement.** Keep TD-053 open with its trigger. Record performance as
unknown at closure.

## Decision

**C.**

### The dataset is deterministic and seeded in the live-PostgreSQL lane

The lane already provisions a real PostgreSQL 16 with the applied schema, which
is the only place an aggregate can be timed meaningfully. The seed is built with
`generate_series`-driven `INSERT ... SELECT` statements rather than row-by-row
`create` calls, so tens of thousands of rows cost seconds instead of minutes, and
the values are derived from the series index so the dataset is identical on every
run.

The dataset is sized so that the difference between an index range scan and a
sequential scan is a difference a gate can see, and it spans **two periods**: a
populated reporting window and rows deliberately outside it, because a report
that accidentally drops its range predicate must fail rather than quietly get
slower.

### The deterministic gate is the query plan

A latency assertion on a shared CI runner is noisy: the same query can vary by
several hundred milliseconds across runners, which forces a budget so loose it
stops catching anything, or a budget so tight it flakes. Neither is a gate.

So the assertion that must never be wrong is about the **plan**: for each report
the lane captures the plan for its query and asserts that the large relations are
reached through an index rather than a sequential scan. A dropped index, a
predicate that stops being sargable, or a range that stops being applied changes
the plan deterministically and fails immediately, on any machine.

### The latency budget is a tripwire, not a promise

Each report additionally has a declared latency ceiling, measured as the total
over several repeated executions with the p95 taken. The number is deliberately
**generous** — its job is to catch the catastrophic case (a plan that degrades to
something minutes long, or an N+1 that was not there before), not to promise a
user experience. It is recorded in the report's own evidence so a reader sees the
real measured value rather than only the pass/fail.

The distinction is stated in the evidence block, because a latency number on a CI
runner is not a statement about production.

### The cap is proven on the same dataset

The same seeded data makes [[TD-056]]'s gap closable: with more rows than a
report's cap, the refusal is reachable against real PostgreSQL, and the lane
asserts both that an over-cap query is refused and that a query exactly at the
cap is accepted. One representative report is enough, because the cap mechanism
is shared and each report's constant is already pinned by its service suite.

## Rejected

- **A cache, a materialized view or a pre-aggregation table.** [[DEC-062]] and
  `AGENTS.md` forbid one without a measured need. This decision produces the
  measurement that would justify one; it does not presume it.
- **A synthetic benchmark harness outside the test lanes.** It would measure the
  benchmark rather than the product, and it would not run in any gate.
- **Latency as the only assertion.** See above: on a shared runner it is either
  meaningless or flaky.

## Consequences

- [[TD-053]] and [[TD-056]] close with numbers and plans attached.
- The live-PostgreSQL lane gets slower, because seeding tens of thousands of rows
  per run costs seconds. That is the price of a measurement that exists.
- A future report must add its own plan assertion and budget, or it inherits
  nothing. The story's acceptance criteria name the reports individually for that
  reason.
- The budget being generous means a slow-but-correct report could pass. That is
  the intended trade: the plan assertion catches the structural regression, and
  the record states that a real UX budget needs a real tenant, which no one has.
