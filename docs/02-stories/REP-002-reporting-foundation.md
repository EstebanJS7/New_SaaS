---
id: REP-002
type: story
title: The reporting foundation — period, contract and permissions
epic: EPIC-18
status: done
priority: high
depends_on:
  - REP-001
prd_sections:
  - "9"
  - "31"
permissions:
  - reports.read
  - reports.export
branch: feat/epic-18-dashboards-reports
created: 2026-10-19
updated: 2026-10-19
---

# REP-002 — The reporting foundation

## Objective

Give every report one period rule, one response contract and one permission
family, and prove the contract end to end with the report PRD §31 names first:
sales by period.

## Context

Nothing about reporting exists: no module, no route, no permission, no CSV path.
Sixteen permission families are seeded and none of them is `reports`
([[DEC-062]]).

Two things must be decided **once** rather than eleven times: how a calendar
period becomes an instant range ([[DEC-063]]), and what a report response looks
like. Eleven reports each inventing a date filter is eleven chances to disagree
about which day a sale belongs to.

`TENANT_TIME_ZONE = "America/Asuncion"` is the only zone the system has;
`Notifications` and `Scheduling` already depend on it. It observes DST, so a
boundary is a real edge and not a formality.

`ENGINEERING-RULES.md` requires stable domain error codes and backend
authorization. `PORTAL`'s lesson applies: a `404` for another tenant's identity,
never a `403` that confirms existence.

## In Scope

- `reports.read` and `reports.export` in `PERMISSION_SEEDS`, mapped to the roles
  that already read the underlying domains, with their RBAC route pins.
- `resolveReportPeriod(input, now)`: the five presets and a `from`/`to` calendar
  pair resolved in `TENANT_TIME_ZONE` to an **inclusive-start, exclusive-end**
  UTC instant range, with the 366-day bound.
  - Errors are `VALIDATION_FAILED` with a distinct, stable **message** per
    condition. `packages/shared/src/errors/registry.ts` is frozen and closed
    (`ErrorCode` is a union of registered keys) and modules do not mint codes,
    so no `REPORTS_PERIOD_*` code is added. An inverted range and a zero-length
    range are the same condition (`from > to` has no days); the span bound and
    the shape errors are the other two.
- The report response contract: a period echo, a currency where money is
  involved, decimal strings for every money/quantity aggregate, and rows.
- The reporting module skeleton: `apps/api/src/reporting/` with a service, a
  repository and a controller.
- One reference report end to end — `GET /reports/sales-by-period` — including
  its tenant isolation and its aggregate tests.
- The RBAC route-contract probe entries for the new routes.

## Out of Scope

- The other ten reports. [[REP-003]] to [[REP-006]].
- The CSV export. [[REP-007]].
- Any UI. [[REP-008]].
- Any cache, materialized view, query builder or charting dependency
  ([[DEC-062]]).
- Any feature-code gate. [[DEC-062]] leaves the module ungated.

## Acceptance Criteria

- [x] `resolveReportPeriod` resolves all five presets and a custom range in
      `TENANT_TIME_ZONE`, returning a half-open UTC instant range
      (`[fromInstant, toInstant)`), where `toInstant` is the start of the day
      **after** `toDate`.
- [x] Presets are fixed and documented: `today` = today only; `last7Days` = the
      seven days ending today inclusive; `last30Days` = the thirty days ending
      today inclusive; `thisMonth` = month-to-date; `lastMonth` = the whole
      previous calendar month.
- [x] A request carrying both a preset and `from`/`to`, or neither, is
      `VALIDATION_FAILED`.
- [x] A range crossing a real Asunción offset transition resolves to a range
      whose local-day boundaries are correct on both sides. **The test uses the
      historical 2024-10 window**, because Paraguay abolished DST and the zone
      has been permanently `-03` since 2024-10-06T04:00:00Z (see the correction
      in [[DEC-063]]); `[2024-10-04, 2024-10-08]` is 5 calendar days and 119
      hours.
- [x] An inverted range (which is also the zero-length case) and a range over
      366 days each produce `VALIDATION_FAILED` with their own stable message —
      none is silently coerced, truncated or swapped.
- [x] Any range is refused when it arrives as raw instants rather than calendar
      dates: `from`/`to` are `YYYY-MM-DD` calendar dates in the tenant zone,
      never ISO instants, so a caller cannot bypass the span bound by choosing
      instants.
- [x] `reports.read` and `reports.export` exist in `PERMISSION_SEEDS`, are
      mapped to roles and appear in the RBAC route-contract probe.
- [x] Every report route requires `reports.read` server-side; a request without
      it is refused before any query runs.
- [x] `GET /reports/sales-by-period` aggregates completed sales only, sums
      `Decimal` values and returns them as decimal strings.
- [x] The report is tenant-scoped and a cross-tenant attempt cannot reach
      another tenant's rows.
- [x] Loading/error/empty/success UX: N/A for the API; the empty range returns
      an empty row set with the period echoed, not an error.
- [x] Tests required by the Story pass.

## Domain Invariants

- A draft sale is never revenue: the query filters `status = COMPLETED` **and**
  reads `completed_at` ([[DEC-064]]).
- Money is summed as NUMERIC in the database, never as a JavaScript `number`.
- The tenant comes from the authenticated request context, never from a query
  parameter.
- The period is echoed back so a caller can prove what was aggregated.

## API

### Added

```text
GET /reports/sales-by-period?period=<preset>|from=&to=
  -> 200 { report, period: { preset|from,to, timeZone, fromInstant, toInstant },
           currency, totalNet, totalTax, totalGross, saleCount,
           rows: [{ bucketDate, saleCount, net, tax, gross }] }
  -> 400 VALIDATION_FAILED (one stable message per condition:
         unknown preset · preset combined with from/to · neither supplied ·
         malformed calendar date · from after to · span over 366 days)
  -> 403 FORBIDDEN (missing reports.read)
```

### Changed

```text
None
```

## Database

### Migration

```text
None — REP-001 created the columns and indexes this report reads.
```

### Models/Tables

- Reads `sale` (`completed_at`, `status`, `currency`) and `sale_line`
  (`line_total`, `taxable_base`, `tax_amount`).

## UI

- None in this Story.

## Implementation Summary

Implemented on `feat/epic-18-dashboards-reports`.

- **`apps/api/src/reporting/report.period.ts`** is the single place a calendar
  date becomes an instant. It resolves the five presets and a `from`/`to` pair
  in `TENANT_TIME_ZONE`, returns a half-open `[fromInstant, toInstant)` range
  where `toInstant` is local midnight of the day after `toDate`, and exposes
  `startOfTenantDay` and `tenantCalendarDate` so no other module re-implements
  the conversion.
  - Calendar-day arithmetic happens on UTC-midnight serials, never on
    tenant-zone instants: UTC has no offset changes, so day and month hops are
    exact there and only the final conversion touches the tenant zone.
  - The offset is resolved with `Intl.DateTimeFormat` in two passes, re-checking
    the offset at the corrected instant. `hourCycle: "h23"` is load-bearing:
    `en-US` renders midnight as hour `24` without it and the offset lands a day
    off.
  - Every rejection is `VALIDATION_FAILED` with its own stable message — no new
    error code, because `packages/shared/src/errors/registry.ts` is a frozen
    closed registry and modules do not mint codes.
- **`reporting.repository.ts`** resolves the tenant from the request context
  (never an argument) and reads only `status: COMPLETED` with a half-open
  `completedAt` predicate. It carries an explicit `REPORT_SALE_ROW_LIMIT` cap
  and refuses rather than returning a silently truncated aggregate.
- **`reporting.service.ts`** re-asserts `reports.read` as defense in depth
  behind the route decorator, takes an injected clock, buckets by the LOCAL
  calendar date of `completedAt` through the shared helper, and sums with
  `Prisma.Decimal`, emitting fixed-scale strings. Money is never a JavaScript
  `number`. The currency is the tenant's configured `sales.defaultCurrency`,
  never a constant.
- **`reporting.controller.ts` / `reporting.module.ts`** expose
  `GET /reports/sales-by-period` behind `reports.read`, with a `.strict()` query
  schema. Per [[DEC-062]] the module asserts **no** entitlement.
- **`reference-seed.ts`** seeds `reports.read` (all six roles, the
  `notifications.delivery.read` read-wide precedent) and `reports.export` (OWNER
  and ADMIN only): reading an aggregate and taking a file out of the system are
  different decisions. Catalog 62 → 64 keys.
- **`rbac/route-contract.probe.test.ts`** pins the route in
  `EXPECTED_ROUTE_INVENTORY` and adds a `REPORTING_PERMISSION_BY_ROUTE`
  assertion, so the new permission is pinned rather than merely declared.
- **`docs/05-modules/Reporting.md`** created and indexed.

## Verification

```text
pnpm format-check   PASS
pnpm lint           PASS  (23/23 turbo tasks)
pnpm typecheck      PASS  (23/23)
pnpm build          PASS  (13/13)
pnpm test           PASS  (23/23)
  api        104 files (101 passed | 1 skipped after the new suites)  1405 passed | 266 skipped  (+44)
  database    30 files                                                  549 passed  (+1)
  web        110 files                                                 1164 passed
  worker      17 files                                                  245 passed
```

The period resolver was additionally verified by direct execution against the
real tzdata, not only through its assertions:

```text
startOfTenantDay("2026-10-19") -> 2026-10-19T03:00:00.000Z   (-03, the live offset)
startOfTenantDay("2024-10-05") -> 2024-10-05T04:00:00.000Z   (-04)
startOfTenantDay("2024-10-06") -> 2024-10-06T04:00:00.000Z   (local midnight never existed)
startOfTenantDay("2024-10-07") -> 2024-10-07T03:00:00.000Z   (-03)
[2024-10-04, 2024-10-08]        -> 5 calendar days, 119 hours
{preset: "today"} @ 2026-10-19 -> [2026-10-19T03:00Z, 2026-10-20T03:00Z)
```

**The report query was proven against real PostgreSQL**, because the route's own
suite runs on the in-memory fixture and that fake does not model a real planner.
Against a freshly migrated database (50 migrations + the reference seed) with
three sales — two `COMPLETED` and one `DRAFT` — the repository's exact query for
`[2026-06-01T03:00Z, 2026-06-11T03:00Z)` returned:

```text
rows in range: 1   (the sale at 2026-06-11T02:00Z; the one at 2026-06-11T03:00Z
                    sits exactly on the EXCLUSIVE end and is correctly excluded)
lines per row:  1  (include: { lines: true } resolves)
total gross: "2001.10"   emitted as a STRING, never a float
DRAFT rows: 1, completed_at NULL — excluded by the status predicate
```

The applied schema also reports **64** seeded permissions, with `reports.read`
on all six roles and `reports.export` on `OWNER` and `ADMIN` only.

## Tests Added

- Unit: `resolveReportPeriod` — five presets against a fixed `now`, a custom
  range, the DST-crossing range, the inverted range, the empty range, the
  over-long range, and the rejection of raw instants.
- Unit: the sales-by-period service — Decimal summation, an empty period, a
  period with a single day, and a boundary sale exactly on each edge of the
  range (included at the start, excluded at the exclusive end).
- Integration: `GET /reports/sales-by-period` returns 403 without
  `reports.read`, 400 for each malformed period, and rows for a seeded period.
- Tenant isolation: tenant A's report never contains tenant B's sales, and a
  cross-tenant sale id is unreachable.

## Known Limitations

- **A two-digit-year defect was found by independent verification AFTER this
  Story was first reported green, and is fixed.** `Date.UTC(99, 0, 1)` returns
  **1999**, not year 99, because JavaScript maps years `00`–`99` onto
  `1900`–`1999`. A `from`/`to` pair of `0099-01-01`..`1999-01-01` therefore
  serialised to the SAME instant, counted as **one day**, passed the 366-day
  bound, and answered a 1999 report while echoing `0099-01-01` — one request,
  two different periods. The serial now builds the month and day on a leap year
  and then sets the real year, `daysInMonth` states the Gregorian rule outright
  instead of deriving it from a `Date` (which also removed a second, latent
  rollover bug where correcting the year after "day 0 of the next month" turned
  2026-02-29 into 2026-03-01), and a year outside `1900–9999` is refused with
  its own stable message. Three regression tests pin it. The lesson is worth
  keeping: the period suite passed and the defect still shipped, because every
  existing case used a 21st-century year.
- One report is implemented; the contract is proven, not the catalogue.
- **The report aggregates in TypeScript rather than in SQL.** The in-memory test
  fixture's `$queryRaw` is a deliberate allowlist of advisory-lock queries that
  throws on anything else ("fails loudly rather than return wrong rows"), and
  the repository has no `aggregate`/`groupBy` usage. A SQL aggregate would have
  made the route untestable through `bootTestApp()` without teaching the fake to
  answer report queries — a second in-memory engine that could agree with the
  code and still be wrong. The bound is the explicit `REPORT_SALE_ROW_LIMIT`;
  the cost is [[TD-053]]'s subject, to be revisited with measurement rather than
  now.
- `America/Asuncion` has had a fixed `-03` offset since 2024-10-06, so the DST
  correctness path is only exercised by historical ranges. [[DEC-063]] records
  the correction; the code stays offset-correct rather than assuming the fixed
  offset.
- The row cap is not proven against the in-memory fake's `take` (the fake
  returns every match), so the cap is asserted by row count rather than by a
  truncated read. Two independent verifications flagged this; it is now
  [[TD-056]], which records the concrete implication: the service suites pin the
  `take` ARGUMENT, but no reporting block exists in the live-PostgreSQL lane, so
  the engine's own enforcement of `take` is unproven for every report.
- The currency in a response is the tenant's configured sale currency; no
  conversion exists anywhere in the system ([[DEC-022]]) and the report does not
  invent one.

## Technical Debt

- [[TD-053]] — report query performance beyond directed indexes; this Story
  makes the TypeScript-aggregation choice it will have to revisit.
- [[TD-055]] — unchanged by this Story: the veterinary reports this foundation
  serves still have no staff entry surface.

## Decisions / ADRs

- [[DEC-062]] — no feature-code gate; `reports.*`; one aggregation path.
- [[DEC-063]] — periods in `TENANT_TIME_ZONE`, presets plus a bounded range.

## Files / Modules

- `packages/database/src/reference-seed.ts` — the two permission keys and their
  role grants
- `apps/api/src/reporting/` — module, service, repository, controller, DTO,
  `period.ts`, `period.test.ts`
- `apps/api/src/rbac/route-contract.probe.test.ts` — the new route pins
- `docs/05-modules/Reporting.md` — created here, grown by the following Stories

## Completion Notes

All required gates passed on 2026-10-19. The `apps/e2e` lane was not run (Docker
unavailable, and this Story adds no UI).
