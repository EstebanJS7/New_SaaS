---
id: TD-062
type: tech-debt
title:
  The completed-sales read loads its lines in one statement, so the cap is held
  down by a planner limit rather than by a product decision
status: open
severity: medium
owner: backend
related_epics:
  - "EPIC-18"
  - "EPIC-20"
related_stories:
  - "HARD-006"
related_decisions:
  - "DEC-079"
  - "DEC-062"
created: 2026-10-22
updated: 2026-10-22
---

# TD-062 — The relation load bounds the cap, not the product

## What was found

[[HARD-006]] ran the product's own completed-sales read against a real
PostgreSQL 16 with a seeded dataset, which no gate had done before. It failed —
twice, at two different walls — and the discovery is that the report's row cap
was never a product number at all:

```text
previous cap  20,000   UNREACHABLE. Prisma issues the `lines`/`payments` relation
                       load as a separate statement binding one parameter per parent
                       row, and PostgreSQL refuses at ~16,383:
                       "too many bind variables in prepared statement, expected
                        maximum of 32767, received 40003"
first fix     10,000   ALSO UNREACHABLE, at a different wall: "54001 stack depth
                       limit exceeded" (max_stack_depth, 2 MB default) from evaluating
                       the IN list
shipped        5,000   measured-safe: take=6000 worked, take=8000 did not
```

[[DEC-079]] ships 5,000 and records why. This item records the change that would
let the cap rise again for a real reason rather than a guess.

## Debt

A busy tenant narrows its report period sooner than the product needs it to. The
limit is set by how Prisma loads a relation, not by what the report can usefully
answer, and that is backwards: a report whose period must be shortened because
of a driver's statement shape is a report shaped by its transport.

The number is also at the edge of what was measured, which is a narrow margin
for a **planner** limit that is not a documented contract.

## Why it is safe to defer

- The refusal it produces is honest and actionable: `VALIDATION_FAILED` with
  "narrow the period", a 4xx a user can act on, rather than the raw 500 the
  previous number produced.
- No tenant exists yet, so no user loses a working report.
- The suite that would catch a regression exists now: the plan assertion and the
  p95 tripwire in `apps/api/test/reporting-performance.live-pg-spec.ts`.

## Proposed Resolution

Load the relation in bounded chunks instead of one statement:

1. Keep the parent read (`take: cap + 1`, ordered `(completed_at, id)`) as it
   is.
2. Load children for the parent ids in chunks small enough that neither the bind
   limit nor the planner stack is approached — a few hundred ids per statement.
3. Concatenate the children and re-group in id order, so the ordering guarantee
   the reports depend on is preserved and asserted.
4. Re-measure with the same suite, and raise the cap only to a value the new
   shape proves.

The alternative — pushing the aggregation into SQL — is the eventual shape, but
it changes twelve reports at once and belongs to its own slice.

## Trigger / Target

The first real tenant whose report period it cannot narrow without losing the
question, or the first slice that touches the reporting read for another reason.

## Verification After Resolution

- [ ] The relation load is chunked and the ordering guarantee is asserted on the
      merged result.
- [ ] `REPORT_SALE_ROW_LIMIT` is raised to a value measured with the new shape,
      and the plan and p95 assertions still pass at that value.
- [ ] The cap refusal remains reachable and is asserted against real PostgreSQL,
      above the new cap and below the new ceiling.
- [ ] [[DEC-079]] and this record are updated together; this record is
      `resolved`.
