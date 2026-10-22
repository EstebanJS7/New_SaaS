---
id: DEC-079
type: decision
title:
  The completed-sales row cap drops to 5,000 because 20,000 was unreachable and
  the engine refuses the query long before the cap could fire
status: accepted
date: 2026-10-22
related_epics:
  - "EPIC-18"
  - "EPIC-20"
related_decisions:
  - "DEC-062"
  - "DEC-078"
related_stories:
  - "HARD-006"
prd_change_required: false
---

# DEC-079 — The sale cap drops to 5,000, a number the engine can actually reach

## Context

[[HARD-006]] seeded 55,000 completed sales in a disposable PostgreSQL 16 and ran
the product's own reporting read against them, which is the first time any gate
had done so ([[TD-053]], [[TD-056]]).

The read refused — but not with the refusal it documents:

```text
Assertion violation on the database: `too many bind variables in prepared
statement, expected maximum of 32767, received 40003`
PrismaClientKnownRequestError
```

`readCompletedSales` issues `take: REPORT_SALE_ROW_LIMIT + 1` = 20,001 parent
rows and loads their relation with `include`. Prisma loads that relation as a
separate statement whose `WHERE sale_id IN (...)` binds one parameter per parent
row (two, counting the tenant predicate). 20,001 rows therefore ask PostgreSQL
for ~40,003 bind parameters against a hard protocol maximum of 32,767.

The consequence is a defect, not a performance question:

```text
documented behaviour   a period over the cap returns VALIDATION_FAILED with
                       "The report period contains more than 20,000 completed
                        sales. Narrow the period and try again."  -> HTTP 4xx

actual behaviour       a period over ~16,383 completed sales throws a raw
                       PrismaClientKnownRequestError -> HTTP 500 INTERNAL,
                       with a message naming bind variables

reachable cap          20,000 is UNREACHABLE: the engine refuses at ~16,383, so
                       the refusal branch that every reporting read depends on
                       was dead code for this report
```

Two reports share the read and therefore the defect: **sales by period** and
**payment methods**. The purchase report has the same `include` shape but a cap
of 5,000, which is comfortably inside the engine's limit and is unaffected.

## Question

How is the cap made honest — lower it, or make the read stop binding one
parameter per row?

## Options

**A. Lower `REPORT_SALE_ROW_LIMIT` to a value the engine can reach.** One
constant, and the documented refusal starts happening.

**B. Keep 20,000 and change the read** to load lines in chunks (or with a single
join) so the bind count stops scaling with the page size.

**C. Keep 20,000 and accept a 500.** Record the defect as debt.

## Decision

**A**, with the number set to **5,000**.

### Why not B

B is the better long-term shape and the wrong change now. Loading relations in
chunks means choosing a chunk size, handling partial failure across chunks, and
re-testing the ordering guarantee `(completed_at asc, id asc)` on a
multi-statement load — a real redesign of a read that two reports and one CSV
export depend on, made during a hardening epic whose subject is not report
architecture.

`AGENTS.md`'s complexity budget is explicit: the current design stays unless a
measured need changes it. The measured need here is "the refusal must fire", and
lowering the constant satisfies it. B is recorded as [[TD-062]] with a trigger.

### Why 5,000, measured rather than guessed

Lowering 20,000 to 10,000 was the first attempt, and it **also failed** — with a
different error:

```text
PrismaClientUnknownRequestError
ConnectorError(PostgresError { code: "54001", message: "stack depth limit exceeded",
  hint: "Increase the configuration parameter \"max_stack_depth\" (currently 2048kB)" })
```

So the bind-variable limit is not the only wall. Loading the relation for N
parent rows makes PostgreSQL evaluate an `IN` list of N elements, and the
planner exhausts its 2 MB stack before any bind limit is reached. That ceiling
was then measured directly rather than reasoned about:

```text
take=1000 OK    take=2500 OK    take=4000 OK    take=5000 OK    take=6000 OK
take=8000 FAILED (stack depth)  take=10000 FAILED (stack depth)
```

5,000 is the furthest measured-safe point that keeps real margin below a
**planner** limit which is not documented as a contract, is not visible from the
code, and can move with a PostgreSQL version. It also matches
`REPORT_PURCHASE_ROW_LIMIT`, which loads the same relation shape, so the module
has one number for one shape instead of two numbers nobody could justify.

Aiming at 6,000 — the highest number that happened to pass — would be sitting on
the cliff that produced this defect twice already.

### The user-visible consequence, stated

`REPORT_ROW_LIMIT_EXCEEDED_MESSAGE` names the number, so the copy changes:

```text
"The report period contains more than 20000 completed sales. Narrow the period and try again."
-> "The report period contains more than 5000 completed sales. Narrow the period and try again."
```

A tenant between 5,001 and ~16,383 sales now receives that sentence instead of
a 500. That is the entire point: a bounded refusal a user can act on is a better
answer than an internal error, and the alternative was an error either way.

**What is genuinely lost, stated plainly:** a tenant above ~6,000 completed
sales in one period could previously have received an answer — if the query had
survived — and now receives a refusal. It never actually received one, because
the engine failed at ~6,000-8,000 regardless, but the _documented_ limit said
20,000 and that promise was never true. The reduction makes the promise honest
at the cost of a narrower one. [[TD-062]] is the change that widens it back with
evidence.

### The cap is now proven reachable, not merely declared

[[TD-056]]'s gap was that no gate had ever observed the refusal against real
PostgreSQL, because the in-memory boundary ignores `take`. The live-PostgreSQL
performance suite now seeds 50,000 sales in the window and asserts:

- the full window is REFUSED with the report's own message and a `DomainError`;
- a narrow day inside it is ACCEPTED, so the refusal is not simply always-on;
- the accepted read's lines come back, so the `include` is real rather than a
  stub.

## Consequences

- Report latency budgets are measured on a period that fits under the cap (60
  days of the seeded window), because a refused query has no latency to measure.
  That is stated in the suite rather than left implicit.
- [[TD-062]] records the redesign that would let the cap rise again, with the
  trigger "a real tenant refused at 10,000 for a period it cannot narrow" — the
  same trigger discipline [[TD-051]] uses.
- The defect was found by executing the refusal against the engine instead of
  asserting the constant and the branch in isolation. Both were individually
  tested before this epic; only the combination was wrong. That is the argument
  for [[DEC-078]]'s real-dataset gate in one sentence.
