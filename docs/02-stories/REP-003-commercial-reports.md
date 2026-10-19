---
id: REP-003
type: story
title: The commercial reports — payment methods and sales by product/service
epic: EPIC-18
status: planned
priority: medium
depends_on:
  - REP-002
prd_sections:
  - "19"
  - "31"
permissions:
  - reports.read
branch: feat/epic-18-dashboards-reports
created: 2026-10-19
updated: 2026-10-19
---

# REP-003 — The commercial reports

## Objective

Answer two questions a tenant's owner asks every month: how the money actually
arrived, and which products and services earned it.

## Context

[[REP-002]] established the period rule and the response contract with sales by
period. This Story adds the two commercial cuts over the same data.

`Payment` holds `method` (one of `CASH`, `CARD`, `BANK_TRANSFER`, `QR`, `CHECK`,
`OTHER`) and `amount Decimal(14,2)`, and its rows are written only by the
`CompleteSale` transaction — a `DRAFT` sale carries none (`DEC-029`). So the
payment-method report and the sales-by-period report are two views of the same
completed revenue, which is a property the tests must assert rather than assume:
**the payment totals must equal the gross total for the same period.** If they
ever diverge, one of the two reports is lying.

`SaleLine` carries the frozen `catalogItemId`, `quantity Decimal(10,3)`,
`unitPrice`, `lineTotal`, `taxableBase` and `taxAmount`. `CatalogItem.kind`
distinguishes `PRODUCT`, `SERVICE`, `MEDICATION` and `SUPPLY`, which is what the
"product/service" split actually means here.

Note what does not exist: `cash_movement` has **no** `sale_id`, so a payment
cannot be traced to a cash movement. The payment-method report reads `payment`,
never `cash_movement`, and the cash reports ([[REP-004]]) read `cash_movement`,
never `payment`. They are different ledgers about different facts.

## In Scope

- `GET /reports/payment-methods` — total per `PaymentMethod` for the period,
  with the count of payments and the share of gross.
- `GET /reports/sales-by-product-service` — quantity sold, net, tax and gross
  per `catalog_item`, with the item's `kind` and a `PRODUCT`/`SERVICE` grouping.
- Both under `reports.read`, both tenant-scoped, both reading the period from
  [[REP-002]]'s resolver.
- The cross-report invariant test: payment totals equal the gross total of sales
  by period for the same range.

## Out of Scope

- Sales by period — already delivered by [[REP-002]].
- Any per-customer or per-branch cut. There is no branch dimension on `sale`
  ([[DEC-062]], [[TD-052]]).
- Gross-margin or cost-of-goods reporting. `PurchaseLine.unitCost` is
  informational and `CatalogItem` carries only an optional reference price
  (`DEC-010`); a margin report would invent a costing method the system does not
  have.
- CSV. [[REP-007]].

## Acceptance Criteria

- [ ] `payment-methods` returns one row per method **present in the period**,
      with summed `amount` as a decimal string and a payment count.
- [ ] The sum of per-method amounts equals the period's gross from
      `sales-by-period` exactly — asserted in a test, not assumed.
- [ ] `sales-by-product-service` returns quantity, net, tax and gross per item,
      with the item's `kind`, for completed sales only.
- [ ] An item with no sales in the period does not appear; an item sold and then
      cancelled does not appear.
- [ ] Both routes require `reports.read` server-side.
- [ ] Both are tenant-scoped; no cross-tenant row is reachable.
- [ ] Empty-period behaviour: an empty row set with the period echoed.
- [ ] Loading/error/empty/success UX: N/A for the API.
- [ ] Tests required by the Story pass.

## Domain Invariants

- Only `COMPLETED` sales contribute. A `CANCELLED` sale's lines and payments are
  excluded by the join's predicate, not by trusting the caller.
- Quantity is summed as NUMERIC on the `Decimal(10,3)` scale; money on
  `Decimal(14,2)`. Neither is ever a JavaScript `number`.
- A sale's currency is single and tenant-configured (`DEC-022`); the reports
  return that currency and never mix two.
- `catalog_item.kind` is read as a fact about the item, not re-derived from
  `tracksStock`.

## API

### Added

```text
GET /reports/payment-methods?period=…|from=&to=
  -> 200 { report, period, currency, totalGross, rows: [
             { method, paymentCount, amount, share } ] }

GET /reports/sales-by-product-service?period=…|from=&to=
  -> 200 { report, period, currency, rows: [
             { catalogItemId, name, kind, quantity, net, tax, gross } ],
           totalsByKind: { PRODUCT, SERVICE, MEDICATION, SUPPLY } }

  -> 400 the four REPORTS_PERIOD_* codes from REP-002
  -> 403 missing reports.read
```

### Changed

```text
None
```

## Database

### Migration

```text
None — REP-001 created the indexes these reports read.
```

### Models/Tables

- Reads `payment` (`method`, `amount`), `sale` (`completed_at`, `status`),
  `sale_line` (`catalog_item_id`, `quantity`, `line_total`, `taxable_base`,
  `tax_amount`) and `catalog_item` (`kind`, `name`).

## UI

- None. Both are consumed by [[REP-008]].

## Implementation Summary

_Not implemented._

## Verification

```text
Not run.
```

## Tests Added

- Unit: payment-methods grouping, a single-method period, a period with all six
  methods, and the share arithmetic without floating-point drift.
- Unit: sales-by-product-service grouping by item, the `kind` roll-up, and an
  item sold in two lines of one sale.
- Unit: the cross-report invariant — per-method sum equals gross.
- Unit: an empty period for both reports.
- Integration: both routes 403 without `reports.read`, 400 on each malformed
  period, and 200 with the seeded data.
- Tenant isolation: a second tenant's payments and sale lines are absent from
  both reports for the same period.

## Known Limitations

- No cost or margin dimension; the system has no accepted costing method.
- No customer cut and no branch cut.

## Technical Debt

- [[TD-052]] — the branch dimension `sale` does not carry.
- [[TD-053]] — query performance beyond the directed indexes.

## Decisions / ADRs

- [[DEC-062]], [[DEC-063]].

## Files / Modules

- `apps/api/src/reporting/` — two service methods, two repository queries, two
  controller routes, their DTOs
- `docs/05-modules/Reporting.md`

## Completion Notes

_Status must remain non-done until all required gates pass._
