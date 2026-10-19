---
id: REP-004
type: story
title: The cash and purchase reports
epic: EPIC-18
status: planned
priority: medium
depends_on:
  - REP-002
prd_sections:
  - "17"
  - "20"
  - "31"
permissions:
  - reports.read
branch: feat/epic-18-dashboards-reports
created: 2026-10-19
updated: 2026-10-19
---

# REP-004 — The cash and purchase reports

## Objective

Answer what the drawer actually did and what the tenant actually bought: the
sessions that closed with their counted-versus-expected difference, the
movements inside them, and the purchases received in the period.

## Context

Cash is a ledger with an explicit sign convention. `CashMovement` is append-only
(no `updated_at` by design), it carries `type` (`SALE`, `ADJUSTMENT`, others), a
`direction` that is required **exactly** for `ADJUSTMENT` and NULL otherwise
(`DEC-030`), and an `amount` that stays positive with the sign owned by the
kind. A report that sums `amount` without resolving the sign is wrong by
construction — this is the single most likely defect in this Story.

`CashSession` carries `openingAmount`, and at close `expectedAmount`,
`countedAmount` and `differenceAmount`, all `Decimal(14,2)`. [[REP-001]] added
`closedAt`. `CLOSED` is terminal (`DEC-036`).

`Purchase` has `RECEIVED` as its event state and, from [[REP-001]],
`receivedAt`. `PurchaseLine` carries `quantity Decimal(10,3)` and an optional
informational `unitCost` — and the module documents state that a purchase has
**no total and no payment state**, so a "purchases by period" report reports
lines and quantities, not money. Inventing a purchase total from `unitCost`
would be reporting a number the domain deliberately does not own.

## In Scope

- `GET /reports/cash-sessions` — closed sessions in the period with opening,
  expected, counted and difference amounts.
- `GET /reports/cash-movements` — movements in the period aggregated by `type`
  with the sign convention resolved, plus the period's net.
- `GET /reports/purchases` — received purchases in the period with line count,
  total quantity and supplier, **without** a money total.
- All three under `reports.read`, tenant-scoped, period from [[REP-002]].

## Out of Scope

- Open sessions in the close report. An open drawer has no close amounts and no
  close instant; including it would report NULLs as zeros.
- Any cash-versus-payments reconciliation. `cash_movement` has **no** `sale_id`;
  the reconciliation is not expressible and would be a different Story with a
  schema change behind it.
- Purchase money totals. The domain has none.
- Branch cuts ([[TD-052]]).

## Acceptance Criteria

- [ ] `cash-movements` resolves the sign of every kind and reports
      `SALE`/correction kinds as they are defined in `DEC-030`, with
      `ADJUSTMENT` taking its sign from `direction`.
- [ ] The reported net equals the signed sum of the movements in the period, and
      a test proves it against an independently computed expectation.
- [ ] `cash-sessions` reports closed sessions only, with `expected`, `counted`
      and `difference` as decimal strings, and asserts
      `counted - expected = difference` for every row it returns.
- [ ] A session closed outside the period does not appear, and a session
      **opened** inside it does not appear unless it also closed inside it.
- [ ] `purchases` reports receive-state purchases with line count and total
      quantity, and carries no money field at all.
- [ ] A `CANCELLED` purchase and a `DRAFT` purchase never appear.
- [ ] All three routes require `reports.read` and are tenant-scoped.
- [ ] Empty-period behaviour: an empty row set with the period echoed.
- [ ] Tests required by the Story pass.

## Domain Invariants

- Movements are read, never recomputed: the report must not derive a balance it
  could read from the ledger.
- The sign convention lives in `DEC-030`; the report implements it in one place
  and tests each kind.
- A closed session's stored `differenceAmount` is authoritative; the report does
  not recompute it and then disagree with the row.
- Purchases contribute to inventory through `stock_movement`, not through this
  report; the two are separate views and neither validates the other.

## API

### Added

```text
GET /reports/cash-sessions?period=…|from=&to=
  -> 200 { report, period, currency, rows: [
             { sessionId, registerId, openedAt, closedAt,
               openingAmount, expectedAmount, countedAmount, differenceAmount } ],
           totals: { expected, counted, difference } }

GET /reports/cash-movements?period=…|from=&to=
  -> 200 { report, period, currency, net,
           rows: [ { type, direction, movementCount, signedAmount } ] }

GET /reports/purchases?period=…|from=&to=
  -> 200 { report, period, rows: [
             { purchaseId, supplierId, supplierName, receivedAt,
               lineCount, totalQuantity } ] }

  -> 400 the four REPORTS_PERIOD_* codes
  -> 403 missing reports.read
```

### Changed

```text
None
```

## Database

### Migration

```text
None — REP-001 created cash_session.closed_at and purchase.received_at
with their indexes.
```

### Models/Tables

- Reads `cash_session`, `cash_movement`, `cash_register`, `purchase`,
  `purchase_line`, `supplier`.

## UI

- None. Consumed by [[REP-008]].

## Implementation Summary

_Not implemented._

## Verification

```text
Not run.
```

## Tests Added

- Unit: the sign table — one case per `CashMovementType`, plus an `ADJUSTMENT`
  in each direction.
- Unit: net equals the independent signed sum, including a period with only
  corrections.
- Unit: `counted - expected = difference` for every returned session row.
- Unit: a session opened before the period and closed inside it is included; one
  opened inside and closed after is excluded.
- Unit: purchases exclude DRAFT and CANCELLED, and the response type carries no
  money field (asserted structurally).
- Unit: empty periods for all three.
- Integration: the three routes — 403, 400 on malformed periods, 200 with seeded
  data.
- Tenant isolation: a second tenant's sessions, movements and purchases never
  cross.

## Known Limitations

- No cash-versus-payments reconciliation, because `cash_movement` carries no
  sale linkage. Recorded as an explicit non-goal rather than a silent gap.
- No purchase money total, because the purchase aggregate owns none.

## Technical Debt

- [[TD-052]], [[TD-053]].

## Decisions / ADRs

- [[DEC-062]], [[DEC-063]], [[DEC-064]].

## Files / Modules

- `apps/api/src/reporting/` — three service methods, three repository queries,
  three routes, their DTOs
- `docs/05-modules/Reporting.md`

## Completion Notes

_Status must remain non-done until all required gates pass._
