---
type: module
status: implemented
epic: EPIC-18
updated: 2026-10-19
---

# Reporting

The reporting module answers PRD §31's questions about data the tenant already
owns: sales by period today, and the ten further reports EPIC-18 will add. It is
a Core domain and a **read-only** one — nothing in this module writes, so there
is no ledger, no audit row and no reversal to reason about here.

[[REP-002]] established the foundation every later report consumes: the period
rule, the response contract and the permission family. It shipped one report end
to end so the contract is proven rather than declared.

## Access

Two permission keys, and **no feature-code gate** ([[DEC-062]]).

| Key              | Held by                  | Why                                                                                                                                           |
| ---------------- | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `reports.read`   | all six roles            | Reports read what the tenant already reads through its own domain surfaces; the read-wide shape is the same one every other `*.read` key has. |
| `reports.export` | `OWNER` and `ADMIN` only | Reading an aggregate on screen and taking a file out of the system are different decisions: a CSV crosses the tenant boundary.                |

`advanced_reports` stays **unspent** and no thirteenth code is added: PRD §9.1
fixes twelve codes, and `reporting` is a domain boundary rather than a
commercial entitlement. The module therefore imports no `EntitlementsModule` and
asserts no capability; `reports.read`/`reports.export` are the whole server-side
guard, with the service re-asserting the permission behind the route decorator.

## The period rule

`report.period.ts` is the **only** place in the system where a calendar period
becomes an instant range ([[DEC-063]]). Every report takes its range from
`resolveReportPeriod(input, now)`, so the boundary rule has one home and one
test suite instead of eleven opinions.

| Preset       | Range (resolved from TODAY in the tenant zone) |
| ------------ | ---------------------------------------------- |
| `today`      | `[today, today]`                               |
| `last7Days`  | the seven days ending today inclusive          |
| `last30Days` | the thirty days ending today inclusive         |
| `thisMonth`  | month-to-date                                  |
| `lastMonth`  | the whole previous calendar month              |

A custom range is a `from`/`to` pair of **calendar dates**, `from <= to`.

- Day boundaries are resolved in `TENANT_TIME_ZONE` (`America/Asuncion`). The
  zone is never a request parameter.
- The instant range is **half-open**: `[fromInstant, toInstant)`, where
  `toInstant` is the first instant of the day **after** `toDate`. Consecutive
  periods therefore partition, and a row exactly on a boundary is counted once.
- Only `YYYY-MM-DD` is accepted. An ISO instant such as `2026-01-01T00:00:00Z`
  is refused, because a caller that could send instants could also bypass the
  span bound.
- A custom range is bounded to **366 days** inclusive. Over the bound is a
  refusal, never a truncated result.
- `fromDate === toDate` is one day (`dayCount` 1), not a zero-length range.

### Rejections

`packages/shared/src/errors/registry.ts` is a frozen, closed registry, so every
rejection is the shared `VALIDATION_FAILED` code with **one stable message per
condition**:

| Condition                                    | Message                                                                 |
| -------------------------------------------- | ----------------------------------------------------------------------- |
| unknown preset                               | `The report period preset is unknown.`                                  |
| preset combined with `from`/`to`             | `A report period takes either a preset or a from/to range, not both.`   |
| neither supplied                             | `A report period requires either a preset or a from/to range.`          |
| only one of `from`/`to`                      | `A custom report period requires both from and to.`                     |
| malformed / non-calendar date, or an instant | `A report period date must be a real calendar date in YYYY-MM-DD form.` |
| `from` after `to`                            | `The report period starts after it ends.`                               |
| span over 366 days                           | `The report period spans more than 366 days.`                           |

### Day count and DST

Calendar arithmetic runs on `YYYY-MM-DD` strings and UTC-midnight `Date`s, which
have no DST, so a "day" is always a day. The tenant zone is used at exactly one
moment per boundary: converting a resolved calendar date into an instant,
through a two-pass offset resolution over `Intl.DateTimeFormat`
(`hourCycle: "h23"`, so a midnight never renders as hour `24`).

`America/Asuncion` switched from `-04` to `-03` at **2024-10-06T04:00:00Z** and
has been permanently `-03` since (tzdata 2025c — Paraguay adopted `-03` as its
standard time from that date, so the zone has no further transitions). Data
before that switch is where a 24-hour-block implementation is visibly wrong, and
the suite pins it: a range from 2024-10-04 to 2024-10-08 resolves to
`[2024-10-04T04:00Z, 2024-10-09T03:00Z)` with `dayCount` 5 and **119** elapsed
hours. Local midnight of 2024-10-06 never existed (the clock jumped 00:00 →
01:00), so that day begins at the transition instant itself.

## Routes

| Route                          | Permission     | Contract                                                                                              |
| ------------------------------ | -------------- | ----------------------------------------------------------------------------------------------------- |
| `GET /reports/sales-by-period` | `reports.read` | Completed sales of the resolved period, bucketed by the tenant's local day, money as decimal strings. |

There is deliberately no command route, no `PATCH` and no `DELETE`: a report
aggregates and never writes. Tenant identity is never an input — it comes from
the request context inside the repository — so there is no
cross-tenant-addressable resource on this surface.

Query: `?preset=<preset>` **or** `?from=YYYY-MM-DD&to=YYYY-MM-DD`. The query
schema is strict, so an unknown key is refused rather than ignored.

Response (`GET /reports/sales-by-period?from=2026-06-10&to=2026-06-11`):

```json
{
  "report": "sales-by-period",
  "period": {
    "preset": null,
    "fromDate": "2026-06-10",
    "toDate": "2026-06-11",
    "timeZone": "America/Asuncion",
    "fromInstant": "2026-06-10T03:00:00.000Z",
    "toInstant": "2026-06-12T03:00:00.000Z"
  },
  "currency": "PYG",
  "saleCount": 3,
  "totalNet": "420.00",
  "totalTax": "42.00",
  "totalGross": "462.00",
  "rows": [
    {
      "bucketDate": "2026-06-10",
      "saleCount": 2,
      "net": "120.00",
      "tax": "12.00",
      "gross": "132.00"
    },
    {
      "bucketDate": "2026-06-11",
      "saleCount": 1,
      "net": "300.00",
      "tax": "30.00",
      "gross": "330.00"
    }
  ]
}
```

`period` is echoed so a caller can prove what was aggregated. `currency` is the
tenant's configured `sales.defaultCurrency`, read server-side through
`TenantSettingsService` ([[DEC-022]]); it is never a literal and never a request
parameter, and no conversion exists anywhere in the system.

## Invariants

- **A draft is never revenue.** The query filters `status = COMPLETED` **and**
  reads `completed_at` ([[DEC-064]]). `created_at` is never a substitute: a
  draft created last month and completed today is today's revenue.
- **The bucket is the tenant's day**, computed by the same helper that resolved
  the range, so the row bucket and the period boundary cannot disagree. A sale
  completed at 23:30 local is counted on that local day, not on the next UTC
  one.
- **Money is summed as `Decimal`** (`taxable_base`, `tax_amount`, `line_total`)
  and emitted as fixed-scale `(14, 2)` strings. No monetary value is ever a
  JavaScript `number`, and no aggregation is pushed into SQL: the module is
  Prisma-delegate native, with no `aggregate`, no `groupBy` and no raw SQL.
- **The tenant comes from the request context**, never from a query parameter,
  so a report cannot be pointed at another tenant's rows.
- **The row cap is a refusal, not a truncation.** `REPORT_SALE_ROW_LIMIT` (20
  000 rows) is asked for as one extra row; exceeding it refuses with a stable
  message rather than returning a silently partial aggregate ([[TD-053]] owns
  the eventual pushdown).
- **An empty period is an answer.** It returns `rows: []`, `saleCount: 0` and
  `"0.00"` totals with the period echoed — never an error, so a caller can tell
  "no sales" apart from "rejected".
- **One aggregation path.** A dashboard card and its report will call the same
  service method ([[DEC-062]]); this module is the only place the query exists.

## What later stories add

The ten remaining reports ([[REP-003]] to [[REP-006]]) reuse
`resolveReportPeriod`, the response contract and the `reports.read` key. The CSV
export ([[REP-007]]) consumes `reports.export`. The dashboard ([[REP-008]])
consumes the same service methods rather than a second query.

## Tests

- `report.period.test.ts` — the five presets against a pinned instant, the year
  boundary, the month-length difference (28 vs 29), the 1st-of-month case, the
  DST-crossing range, a single-offset range, the 366/367 bound and every
  rejection message.
- `reporting.service.test.ts` — Decimal summation (a float accumulator cannot
  produce `"0.30"`), local-day bucketing, the declared half-open predicate, the
  empty period, the row cap at and over its limit, and the 403 that reaches no
  query.
- `reporting.integration.test.ts` — 200 with the period echoed, 400 per
  malformed period, 401 unauthenticated, 403 without `reports.read`, the
  exclusive-boundary sale counted in the next period, and tenant isolation
  (tenant B's sales never appear in tenant A's report for the same period).
- `packages/database/src/reference-seed.test.ts` — `reports.read` is held by all
  six roles and `reports.export` by exactly `OWNER` and `ADMIN`.
- `route-contract.probe.test.ts` — the route and its exact permission are
  pinned.
