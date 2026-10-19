---
id: REP-005
type: story
title: The inventory reports — stock and low stock
epic: EPIC-18
status: planned
priority: medium
depends_on:
  - REP-002
prd_sections:
  - "16"
  - "31"
permissions:
  - reports.read
branch: feat/epic-18-dashboards-reports
created: 2026-10-19
updated: 2026-10-19
---

# REP-005 — The inventory reports

## Objective

Answer what is on hand and what is about to run out: current stock per item, and
the items whose quantity has fallen to or below the threshold somebody set for
them.

## Context

`StockMovement` is the auditable source of truth and `StockBalance` is its
transactional projection — one row per `(tenant, catalogItemId)` with
`quantity Decimal(10,3)`, written under a per-`(tenant, item)` advisory lock
that EPIC-10 introduced after the projection's `BLOCK` race exposed a real lost
update.

That history is why the stock report reads the **projection** for the current
snapshot and the **ledger** for flow within a period. They are not
interchangeable: the balance has no history, and the ledger has no snapshot. The
report states which one each number came from, and a test asserts the projection
equals the ledger's signed sum for the seeded data — the same invariant
EPIC-10's closure proved, reused here as a report-level guard.

Low stock had **no data source at all** until [[REP-001]] added
`catalog_item.low_stock_threshold` ([[DEC-065]]). The report compares against
that column and skips items whose threshold is NULL. It does not invent a
default, so it starts empty for every tenant — a first-run state the UI must
render honestly rather than as a failure.

## In Scope

- `GET /reports/stock` — current quantity per tracked item, from
  `stock_balance`, with the item's name, kind and SKU-ish identity, plus the
  period's movement flow (in, out, net) from `stock_movement`.
- `GET /reports/low-stock` — items whose `stock_balance.quantity` is at or below
  their non-NULL `low_stock_threshold`, ordered by severity.
- Both under `reports.read`, tenant-scoped.
- Items with `tracksStock = false` are excluded from both.

## Out of Scope

- Valuation of stock. No item carries a cost, only an optional informational
  reference price (`DEC-010`), so a valuation report would invent a costing
  method.
- Any recalculation or repair of `stock_balance`. The report reads it; if it is
  wrong, that is an EPIC-10 concern and this Story must not silently fix it.
- A tenant-level default threshold ([[DEC-065]], rejected).
- CSV. [[REP-007]].

## Acceptance Criteria

- [ ] `stock` returns one row per tracked item with a balance row, with
      `quantity` as a decimal string on the `Decimal(10,3)` scale.
- [ ] The reported balance equals the signed sum of that item's `stock_movement`
      rows — asserted for the seeded fixture.
- [ ] The period's flow (in, out, net) is reported per item and a movement
      outside the period does not contribute.
- [ ] An item with `tracksStock = false` appears in neither report.
- [ ] `low-stock` returns only items whose threshold is non-NULL and whose
      quantity is `<= threshold`, ordered most-depleted first.
- [ ] An item with a NULL threshold never appears in `low-stock`, even at
      quantity zero.
- [ ] An item exactly at its threshold appears; one just above does not.
- [ ] Both routes require `reports.read` and are tenant-scoped.
- [ ] Empty behaviour: `low-stock` returns an empty set with a distinguishable
      reason when no item has a threshold, versus when thresholds exist and all
      are satisfied.
- [ ] Tests required by the Story pass.

## Domain Invariants

- The balance is a projection, never a source: the report reads it, and the
  ledger remains the authority.
- Quantities are NUMERIC on `Decimal(10,3)`; the threshold shares that scale.
- `stock_movement` is immutable and append-only; the flow is a signed sum over
  rows, never a stored aggregate.
- Tenant scoping is on both tables, and the join is composite
  `(tenant_id, catalog_item_id)`.

## API

### Added

```text
GET /reports/stock?period=…|from=&to=
  -> 200 { report, period, rows: [
             { catalogItemId, name, kind, quantity,
               inbound, outbound, net } ] }

GET /reports/low-stock
  -> 200 { report, thresholdsConfigured: boolean, rows: [
             { catalogItemId, name, quantity, threshold, shortfall } ] }

  -> 400 the four REPORTS_PERIOD_* codes (stock only)
  -> 403 missing reports.read
```

### Changed

```text
None
```

## Database

### Migration

```text
None — REP-001 added catalog_item.low_stock_threshold.
```

### Models/Tables

- Reads `stock_balance` (`quantity`), `stock_movement` (`quantity`,
  `movement_type`, `created_at`), `catalog_item` (`name`, `kind`, `tracksStock`,
  `low_stock_threshold`).

## UI

- None. Consumed by [[REP-008]].

## Implementation Summary

_Not implemented._

## Verification

```text
Not run.
```

## Tests Added

- Unit: the balance-versus-ledger equality for a seeded item with inbound and
  outbound movements.
- Unit: flow excludes a movement outside the period and includes one exactly on
  each boundary.
- Unit: an item at exactly its threshold appears; one above does not; one with a
  NULL threshold never does.
- Unit: `tracksStock = false` excluded from both reports.
- Unit: the two distinguishable empty states of `low-stock`.
- Integration: both routes — 403, 400 on a malformed stock period, 200 with
  seeded data.
- Tenant isolation: a second tenant's balance, movements and items never appear.

## Known Limitations

- The stock snapshot has no as-of-date history: `stock_balance` is current only.
  A historical balance is not recoverable from this report, and reconstructing
  it from the ledger is not attempted here.
- No valuation.

## Technical Debt

- [[TD-053]].

## Decisions / ADRs

- [[DEC-062]], [[DEC-063]], [[DEC-065]].

## Files / Modules

- `apps/api/src/reporting/` — two service methods, two repository queries, two
  routes, their DTOs
- `docs/05-modules/Reporting.md`

## Completion Notes

_Status must remain non-done until all required gates pass._
