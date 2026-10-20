---
id: DEC-063
type: decision
title: Report periods resolve in the tenant timezone with a bounded custom range
status: accepted
date: 2026-10-19
related_epics:
  - "EPIC-18"
related_decisions:
  - "DEC-007"
related_stories:
  - "REP-002"
prd_change_required: false
---

# DEC-063 — Report periods: `TENANT_TIME_ZONE`, presets and a bounded range

## Context

`packages/shared/src/platform.ts` exports one constant:

```ts
export const TENANT_TIME_ZONE = "America/Asuncion";
```

and its own comment records the open question:

> A per-tenant zone is a product decision that would move this into the settings
> registry; until then it is one constant so the two never disagree.

Two surfaces already depend on it: `Scheduling` stores availability as local
wall-clock minutes in this zone and converts at read time, and `Notifications`
renders an appointment instant in it. The `Tenant` model has **no** timezone
column, and the settings registry has no timezone namespace.

PRD §31 says "sales by period" and does not define the period.
`ENGINEERING-RULES.md` says persisted timestamps are UTC and conversion happens
"using tenant timezone at boundaries" — which is a rule about _where_ to
convert, not about which day a sale belongs to.

## Question

In which zone does a report cut its day, and what period shapes does the API
accept?

## Options

### Option A — `TENANT_TIME_ZONE`, presets plus a bounded custom range (accepted)

Every date boundary is resolved in `America/Asuncion` and converted to UTC
instants for the query. The API accepts presets (`today`, `last7Days`,
`last30Days`, `thisMonth`, `lastMonth`) and a custom `from`/`to` pair of
calendar dates, with the resolved inclusive-exclusive instant range computed
server-side. A custom range is bounded to **366 days**; exceeding it is a
validation error, not a truncated result.

A period boundary is a real edge in this zone, and **the correction below is
part of this decision** because the version first written here had the current
behaviour wrong.

```text
correction (2026-10-19, verified against tzdata 2025c)

the first draft of this section said "Asunción observes DST (-04/-03), so a
period boundary is a real edge". That was true until 2024 and is NOT true for
the periods a tenant will actually request.

Paraguay abolished DST. In tzdata 2025c the LAST transition in
America/Asuncion is 2024-10-06T04:00:00Z, -04 -> -03, after which the zone is
permanently -03. Verified by scanning monthly offsets 2018..2030: fourteen
transitions, the last in October 2024, none after.
```

Both halves of that matter, and they point in opposite directions:

- **For every period from late 2024 onward the offset is fixed at `-03`**, so
  the common case is the simple one and nobody should expect a DST surprise in a
  2026 report.
- **Historical ranges still cross real transitions** — a tenant exporting 2019
  data gets a range with 23- and 25-hour days in it. The resolver must therefore
  remain offset-correct rather than assume a fixed `-03`, and the DST assertion
  uses the historical 2024-10 window, where `[2024-10-04, 2024-10-08]` is five
  calendar days and **119 hours**, and local midnight of 2024-10-06 never
  existed (it resolves to `2024-10-06T04:00:00Z`).

The lesson worth keeping: a decision doc that asserts a timezone's _current_ DST
posture without checking tzdata is asserting a fact that expires.

### Option B — `TENANT_TIME_ZONE`, presets only

Fewer shapes, and the range class of bug disappears. Rejected because a
veterinary's accountant asks for a quarter and a month-to-date that no preset
covers, and answering "not supported" pushes the arithmetic into a spreadsheet —
which is exactly what the report exists to replace.

### Option C — UTC days

Rejected. A cash session closed at 21:00 in Asunción lands on the next UTC day,
so the cash report and the cash screen would disagree about the same session.
Two truths about one fact is the failure this repository spends the most effort
avoiding.

### Option D — Per-tenant zone in the settings registry now

Rejected **for this epic**: it is [[DEC-063]]-scope creep into a settings
namespace, a migration, a UI and a validation surface, for a product with one
country and one zone. The constant already carries the honest note; a report
that reads the same constant cannot introduce a third opinion. When a per-tenant
zone lands, it lands in the constant's place and every report inherits it.

## Decision

Accepted by the maintainer on 2026-10-19.

**Report day boundaries and period resolution use `TENANT_TIME_ZONE` from
`@newsaas/shared`.** The API accepts the five presets and a custom `from`/`to`
calendar-date pair, resolves them server-side into an inclusive-exclusive UTC
instant range, and rejects a span longer than 366 days with a stable error code.

The zone is **never** a request parameter and the range is **never** accepted as
raw instants from the client: a caller that could send arbitrary instants could
also bypass the span bound.

## Consequences

### Product

A report's day is the tenant's day, consistent with the agenda and the reminder.
"Today" means today in Asunción.

### Architecture

One `resolveReportPeriod(input, now)` function in the reporting module is the
only place a date becomes an instant. Every report takes its range from it, so
the boundary rule has one home and one test suite.

### Database/API

The resolved range is applied to the event timestamp column each report owns
([[DEC-064]]): `completed_at`, `received_at`, `closed_at`, `created_at`. An
index supports each one; none is a range scan over an unindexed column.

### Delivery

[[REP-002]] implements `resolveReportPeriod` and its test suite, including a
DST-crossing case, an empty range and an inverted range. Every later report
consumes it.

## PRD Update

No PRD change. PRD §31 is unchanged and the period shape is an implementation
contract, recorded here rather than in the PRD.
