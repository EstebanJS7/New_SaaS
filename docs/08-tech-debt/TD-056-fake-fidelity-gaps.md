---
id: TD-056
type: tech-debt
title:
  The in-memory reporting boundary cannot prove cap enforcement or select
  projection
status: resolved
severity: low
owner: qa
related_epics:
  - EPIC-18
  - EPIC-20
related_stories:
  - REP-002
  - REP-005
  - REP-007
related_decisions:
  - "DEC-062"
created: 2026-10-19
updated: 2026-10-22
---

# TD-056 — two fake-fidelity gaps in the reporting test boundary

## What was found

Two independent adversarial passes over [[EPIC-18]] flagged that
`apps/api/test/support/in-memory-database.ts` does not model two Prisma features
the reporting module relies on. They carry **different risk**, and conflating
them would hide that.

### Gap 1 — the fake ignores `take` (a real weakening)

Every reporting read issues `take: LIMIT + 1` so an over-cap request refuses
instead of returning a truncated aggregate. The fake returns **every** match, so
a fixture-backed HTTP test cannot distinguish `take: LIMIT + 1` from no `take`
at all.

Affected delegates, as observed by the two passes: `sale`, `purchase`,
`cashSession`, `cashMovement`, `stockBalance`, `stockMovement`,
`clinicalVaccination`, `clinicalDeworming`, `clinicalEncounter`, `patient`.

What IS proven today:

- the service suites assert the **query argument** (`take: LIMIT + 1`) and the
  refusal, using a stub that returns `LIMIT + 1` rows;
- the real database is exercised by the live-PostgreSQL lane, but **no reporting
  block exists there**, so the engine's own enforcement of `take` is unproven
  for every report.

What is NOT proven: that PostgreSQL returns at most `take` rows for these
queries, and therefore that a cap refusal is reachable end to end against real
data.

### Gap 2 — the fake ignores `select` (protective, not a risk)

The `clinicalEncounter` delegate returns the FULL row including `internalNotes`,
even though the consultations read selects only `id`, `closedAt` and
`amendsEncounterId`.

This direction is **safer** than production, not weaker: the fake hands the
service more than a real query would, so the redaction has to be enforced by the
server's own projection and DTO rather than by the database's `select`. Both
hold today — the service builds `ConsultationsResponse` from `closedAt`,
`amendsEncounterId` and the counts alone, and `ConsultationDayRowDto` has no
free-text field — and this was confirmed against real PostgreSQL, where the
projection printed `keys read: amendsEncounterId,closedAt,id`.

The residual risk is a FUTURE field added to a DTO from the row: the fake would
feed it happily and the test would pass while a real query might not have
selected it. Recorded for that reason, not because anything is wrong now.

## Why it was deferred rather than fixed

Closing gap 1 properly needs a reporting block in
`apps/api/test/live-pg-isolation.e2e-spec.ts` that seeds more than the cap and
asserts the refusal. The caps are module constants (20 000 sales, 5 000
sessions, 20 000 movements, 5 000 purchases, 5 000 balances, 10 000 due rows, 10
000 export rows), so such a test must materialise tens of thousands of rows per
case — slow, and disproportionate for an MVP with no tenant near any of those
bounds.

Teaching the fake to emulate `take` was rejected: it would make the fake agree
with the code by construction while proving nothing about PostgreSQL, which is
the opposite of what a boundary fake is for.

## The trigger that would reopen it

Any of: a report whose cap is genuinely approached in real use; the first report
whose cap is lowered; [[EPIC-20]] Production Hardening; or a defect traced to a
truncated read.

## What a fix would touch

- `apps/api/test/live-pg-isolation.e2e-spec.ts` — a reporting block that seeds
  `LIMIT + 1` rows for ONE representative report (the cheapest is probably
  `new-patients`), asserts the refusal, and asserts that `LIMIT` rows is
  accepted. One report is enough: the cap mechanism is shared, and the
  per-report constants are already pinned by the service suites.
- Optionally a schema-level assertion that the `(tenant_id, <instant>)` indexes
  the reads rely on actually serve those range scans.

## Pointers

- `apps/api/test/support/in-memory-database.ts` — the delegates and the
  half-open predicate they DO implement correctly (ranges and NULL semantics are
  modelled; only `take` and `select` are not).
- `apps/api/src/reporting/reporting.repository.ts` — every `take: LIMIT + 1` and
  its matching stable refusal message.
- [[TD-053]] — the report performance question, which would measure the same
  reads.

## Resolution (2026-10-22, [[HARD-006]])

Resolved by making both gaps reachable against real PostgreSQL, and the
resolution found that gap 1 was not merely unproven — it was masking a
**defect**.

### Gap 1 — `take` enforcement: the cap was unreachable

`apps/api/test/reporting-performance.live-pg-spec.ts` seeds 50,000 completed
sales in one window and asserts:

```text
the full window is REFUSED with REPORT_ROW_LIMIT_EXCEEDED_MESSAGE
the refusal is a DomainError, not a Prisma error
a narrow day inside the window is ACCEPTED, with its lines present
```

The first attempt at the refusal produced this instead:

```text
too many bind variables in prepared statement, expected maximum of 32767, received 40003
```

The relation load binds one parameter per parent row, and at the then-cap of
20,000 the engine failed at roughly 16,383 — so the refusal branch was **dead
code** and a tenant got an HTTP 500 with a message about bind variables.
Lowering the cap to 10,000 hit a second wall
(`54001 stack depth limit exceeded`), and the measured-safe value is 5,000.
[[DEC-079]] records the change and [[TD-062]] the redesign that would raise it.

So the answer to this record's original question — "is a cap refusal reachable
end to end against real data?" — was **no**, for this report, and nobody could
have known that from the fake, whose `take` is ignored exactly as this record
said.

### Gap 2 — `select` projection: unchanged, and still not a risk

The consultations read is still protected by the server's own DTO rather than by
the database's projection. That direction was already the safe one and nothing
about this story changes it. It stays recorded in this record's history rather
than as an open item.

### Verification after resolution

- [x] The cap refusal is observed against real PostgreSQL, at the report's own
      message and error class.
- [x] A query under the cap is accepted, so the refusal is not always-on.
- [x] The accepted read's `include` is proven real (the lines come back).
- [x] The defect the gap was hiding is [[DEC-079]] and [[TD-062]].
