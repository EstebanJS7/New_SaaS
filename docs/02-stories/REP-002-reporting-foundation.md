---
id: REP-002
type: story
title: The reporting foundation — period, contract and permissions
epic: EPIC-18
status: planned
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
  pair resolved in `TENANT_TIME_ZONE` to an inclusive-exclusive UTC instant
  range, with the 366-day bound and stable error codes for an inverted, empty or
  over-long range.
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

- [ ] `resolveReportPeriod` resolves all five presets and a custom range in
      `TENANT_TIME_ZONE`, returning a half-open UTC instant range.
- [ ] A range crossing the Asunción DST transition resolves to a range whose
      local-day boundaries are correct on both sides.
- [ ] An inverted range, an empty range and a range over 366 days each produce
      their own stable error code — none is silently coerced.
- [ ] Any range is refused when it arrives as raw instants rather than calendar
      dates.
- [ ] `reports.read` and `reports.export` exist in `PERMISSION_SEEDS`, are
      mapped to roles and appear in the RBAC route-contract probe.
- [ ] Every report route requires `reports.read` server-side; a request without
      it is refused before any query runs.
- [ ] `GET /reports/sales-by-period` aggregates completed sales only, sums
      `Decimal` values and returns them as decimal strings.
- [ ] The report is tenant-scoped and a cross-tenant attempt cannot reach
      another tenant's rows.
- [ ] Loading/error/empty/success UX: N/A for the API; the empty range returns
      an empty row set with the period echoed, not an error.
- [ ] Tests required by the Story pass.

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
  -> 400 REPORTS_PERIOD_INVALID | REPORTS_PERIOD_INVERTED |
         REPORTS_PERIOD_EMPTY | REPORTS_PERIOD_TOO_LONG
  -> 403 (missing reports.read)
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

_Not implemented._

## Verification

```text
Not run.
```

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

- One report is implemented; the contract is proven, not the catalogue.
- The currency in a response is the tenant's configured sale currency; no
  conversion exists anywhere in the system ([[DEC-022]]) and the report does not
  invent one.

## Technical Debt

- [[TD-053]] — report query performance beyond directed indexes.

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

_Status must remain non-done until all required gates pass._
