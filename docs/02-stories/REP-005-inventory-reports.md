---
id: REP-005
type: story
title: The inventory reports — stock and low stock
epic: EPIC-18
status: done
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

- [x] `stock` returns one row per tracked item with a balance row, with
      `quantity` as a decimal string on the `Decimal(10,3)` scale.
- [x] The reported balance equals the signed sum of that item's `stock_movement`
      rows — asserted for the seeded fixture.
- [x] The period's flow (in, out, net) is reported per item and a movement
      outside the period does not contribute.
- [x] An item with `tracksStock = false` appears in neither report.
- [x] `low-stock` returns only items whose threshold is non-NULL and whose
      quantity is `<= threshold`, ordered most-depleted first.
- [x] An item with a NULL threshold never appears in `low-stock`, even at
      quantity zero.
- [x] An item exactly at its threshold appears; one just above does not.
- [x] Both routes require `reports.read` and are tenant-scoped.
- [x] Empty behaviour: `low-stock` returns an empty set with a distinguishable
      reason when no item has a threshold, versus when thresholds exist and all
      are satisfied.
- [x] Tests required by the Story pass.

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

Implemented on `feat/epic-18-dashboards-reports`, extending the same module.

- **The snapshot and the flow are separate numbers and the DTO says so.**
  `quantity` comes from the `stock_balance` PROJECTION and is CURRENT, with no
  history; `inbound`/`outbound`/`net` come from the `stock_movement` LEDGER and
  are the PERIOD's flow. The real-data proof below shows one item at
  `quantity 10.000`, `inbound 20.000`, `outbound 8.000`, `net 12.000` — three
  different numbers for one item, which is exactly why they cannot be conflated.
- `stock_movement.quantity` is already signed (positive is an input, negative an
  output) and the DB rejects zero. `inbound` sums the positives, `outbound`
  reports the negatives as a POSITIVE magnitude — the stored sign already says
  the direction, so printing a second minus beside the label would double the
  meaning — and `net` is the signed sum. No movement TYPE owns the sign here, in
  contrast with cash ([[DEC-030]]).
- `low-stock` takes **no query parameters at all** and refuses ANY key with its
  own message, so `?from=...` on a current-state report is an error rather than
  silently ignored.
- The comparison is `<=`, not `<`: an item AT its threshold is already low. A
  NULL threshold is skipped BEFORE any comparison, because NULL means "not
  monitored" ([[DEC-065]]) and inventing a default is what that decision
  refused.
- **`thresholdsConfigured` is answered by its own existence probe, not derived
  from the loop.** See the corrected limitation below: the first implementation
  derived it from the balanced items, which is wrong for the one tenant it
  matters to.
- Both reads carry `take: LIMIT + 1` caps (5 000 balances, 20 000 movements) and
  refuse rather than truncating; an item with movements in the period but no
  balance row, or a balance naming an unresolvable catalog item, is a loud
  `INTERNAL` naming the id.

## Verification

```text
pnpm format-check   PASS
pnpm lint           PASS  (23/23 turbo tasks)
pnpm typecheck      PASS  (23/23)
pnpm build          PASS  (13/13)
pnpm test           PASS  (23/23)
  api        108 files (106 landed + 2 new)      1520 passed | 266 skipped  (+42)
  database    30 files                            549 passed
  web        110 files                           1164 passed
```

42 new tests: 29 service and 13 integration. They prove the
balance-versus-ledger equality, the positive-magnitude `outbound`, the
period-bounded flow, the `<=` boundary, the NULL-threshold skip, the two
distinguishable empty answers, the shortfall ordering with its name tie-break,
both caps, permission-before-any-read, and the refusal of any query key on the
current-state report.

**Both queries were also proven against real PostgreSQL.** For the period
`[2026-06-01T03:00Z, 2026-06-11T03:00Z)` in `America/Asuncion`, with one tracked
item that moved, one non-tracked item, and one thresholded item that never
moved:

```text
thresholdsConfigured probe -> Feed   (the tracksStock=false Grooming item is NOT
                                     the answer; Vitamin is thresholded but has
                                     no balance row, which is why the probe
                                     cannot be derived from the balanced items)

period movements read: 2   (the 2026-06-20 sale is outside the period)
  Feed (tracksStock=true)
    quantity 10.000   <- CURRENT balance, a snapshot with no history
    inbound  20.000   <- the PERIOD's input
    outbound  8.000   <- the PERIOD's output, as a positive magnitude
    net      12.000   <- the PERIOD's signed sum
    balance === all-time ledger sum: true (10.000)
    at-or-below threshold 10.000: true   (the `<=` boundary)
```

The three flow numbers differ from the snapshot precisely because the `-2`
movement falls outside the period — the clearest possible demonstration that
`quantity` and `net` answer different questions.

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

- **A `thresholdsConfigured` defect was found during this work unit and is
  fixed.** The first implementation derived the flag from the balanced items, so
  a tenant that set a threshold on an item which had never moved — no balance
  row, therefore invisible to the batched catalog read — was told "nobody has
  configured anything" while its configuration sat in the catalog. The flag is
  now answered by its own indexed existence probe over `catalog_item`
  (`tracksStock = true` **and** `lowStockThreshold IS NOT NULL`), and a
  regression test pins the exact case: a tenant with a thresholded, never-moved
  item now reads `thresholdsConfigured: true` with empty `rows`. The gap was
  real precisely because it only misfires for the tenant who did the
  configuring.
- The stock snapshot has no as-of-date history: `stock_balance` is current only.
  A historical balance is not recoverable from this report, and reconstructing
  it from the ledger is not attempted here.
- No valuation: no item carries a cost, only an optional informational reference
  price ([[DEC-010]]), so a valuation would invent a costing method.
- **The balance-versus-ledger equality is a TEST-level invariant, not a runtime
  check.** The runtime movement read is period-bounded, so proving the equality
  live would need a second, all-time ledger read per item. The test recomputes
  it independently and the real-database proof above confirms it on real rows.
- **A read-order defect was found by independent verification AFTER this Story
  was reported green, and is fixed.** The two reads are not one snapshot, so a
  commit landing between them is visible to exactly one. Reading balances FIRST
  meant a purchase of a previously unstocked item had its movement seen but not
  its balance, and the report answered `INTERNAL` for perfectly valid committed
  data. Reading the FLOW first makes that benign: a purchase committing between
  the reads has its movement seen here and its balance seen by the later read.
  The residual skew is the unavoidable one of any two-read approach — an
  existing item can pair a pre-commit quantity with a post-commit flow, which is
  a stale number rather than a failure — and [[TD-053]] owns the single-snapshot
  fix.
- The low-stock shortfall ordering is a total order on
  `(shortfall DESC, name ASC)` only; two rows tied on both fall back to the
  balance read's order via a stable sort. Deterministic, but not a declared
  third key (unlike the stock report's `(name, catalogItemId)`).
- `thresholdsConfigured` is answered by an existence probe over the CATALOG, so
  it is correct for a tenant whose only thresholded item has never moved. That
  correctness costs one extra indexed existence query, which the first version
  of this Story did not budget — the corrected defect below is why it is worth
  it.
- The caps on both inventory reads are proven at the SERVICE level (the suites
  assert the `take: LIMIT + 1` argument and the refusal), not against the
  engine: the in-memory fake ignores `take`. [[TD-056]] records that gap and its
  trigger.

## Technical Debt

- [[TD-053]] — report query performance beyond directed indexes.

## Decisions / ADRs

- [[DEC-062]], [[DEC-063]], [[DEC-065]].

## Files / Modules

- `apps/api/src/reporting/` — two service methods, two repository queries, two
  routes, their DTOs
- `docs/05-modules/Reporting.md`

## Completion Notes

All required gates passed on 2026-10-19. The `apps/e2e` lane was not run (Docker
unavailable; this Story adds no UI).
