---
id: TD-063
type: tech-debt
title: A month of sales takes about four seconds to report
status: open
severity: medium
owner: backend
related_epics:
  - "EPIC-18"
  - "EPIC-20"
related_stories:
  - "HARD-006"
related_decisions:
  - "DEC-078"
  - "DEC-062"
created: 2026-10-22
updated: 2026-10-22
---

# TD-063 — A month of sales takes about four seconds to report

## What was measured

[[TD-053]] said report performance was **unknown**, not fine, and refused to
guess. [[HARD-006]] measured it against a real PostgreSQL 16 with a seeded
dataset, and the first budget it was measured against — 1,000 ms — failed by
four times:

```text
  ~137 completed sales, one day    p95 ≈    39 ms
~4,100 completed sales, 30 days    p95 ≈ 4,081 ms
```

31× the rows costs 104× the time, so the per-row cost itself grows across this
range. Both numbers come from
`apps/api/test/reporting-performance.live-pg-spec.ts`, which keeps them as its
tripwire baseline.

## Why this is debt rather than "acceptable"

[[DEC-078]] deliberately made the latency assertion a **regression tripwire**,
not a service-level agreement, because a shared CI runner cannot certify a
user-facing number. The tripwire now sits above the measurement so a real
degradation fails.

That decision must not be read as approval. A busy tenant asking for a month of
sales waits four seconds for it, and the number is now known rather than
suspected.

## What has NOT been established

- **Where the time goes.** The read loads parents and children in two statements
  and aggregates in TypeScript with `Prisma.Decimal` values throughout. Decimal
  materialization is a plausible cost and no profile has been taken.
- **Whether it is linear.** The two measured points are consistent with a
  growing per-row cost, but two points do not establish a curve.
- **What the target should be.** No user-facing latency target exists in the PRD
  for reports, so "4 seconds is bad" is a judgement, not a violated requirement.

## Why it is safe to defer

Nothing is broken: the reports return correct results, the plan is index-backed,
and the cap bounds the work. The recorded tripwire means a worsening is caught.

`AGENTS.md`'s complexity budget forbids a cache, a materialized view or a
pre-aggregation table without a measured need. The measurement now exists, but
the cheapest correct step is a **profile**, not a cache — and adding the cache
first would repeat the mistake the budget exists to prevent.

## Proposed Resolution

1. **Profile one report against the seeded dataset** before changing anything,
   and record where the time actually goes (query execution versus row
   materialization versus the TypeScript aggregation).
2. Fix what the profile names. Likely candidates, in cost order:
   - aggregate in SQL instead of TypeScript, which removes the row
     materialization entirely and would also raise the cap ([[TD-062]] is the
     same change);
   - narrow the selected columns so `Prisma.Decimal` is not constructed for
     values the report does not use.
3. Decide a user-facing target with the product owner, then set the assertion to
   it and move the tripwire out of the budget's way.

## Trigger / Target

The first tenant whose reports feel slow, or the first slice that touches the
reporting read for another reason, whichever comes first.
