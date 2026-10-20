---
id: REP-004
type: story
title: The cash and purchase reports
epic: EPIC-18
status: done
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

- [x] `cash-movements` resolves the sign of every kind and reports
      `SALE`/correction kinds as they are defined in `DEC-030`, with
      `ADJUSTMENT` taking its sign from `direction`.
- [x] The reported net equals the signed sum of the movements in the period, and
      a test proves it against an independently computed expectation.
- [x] `cash-sessions` reports closed sessions only, with `expected`, `counted`
      and `difference` as decimal strings, and asserts
      `counted - expected = difference` for every row it returns.
- [x] A session closed outside the period does not appear, and a session
      **opened** inside it does not appear unless it also closed inside it.
- [x] `purchases` reports receive-state purchases with line count and total
      quantity, and carries no money field at all.
- [x] A `CANCELLED` purchase and a `DRAFT` purchase never appear.
- [x] All three routes require `reports.read` and are tenant-scoped.
- [x] Empty-period behaviour: an empty row set with the period echoed.
- [x] Tests required by the Story pass.

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
  -> 200 { report, period, rows: [
             { sessionId, registerId, openedAt, closedAt,
               openingAmount, expectedAmount, countedAmount, differenceAmount } ],
           totals: { expected, counted, difference } }

GET /reports/cash-movements?period=…|from=&to=
  -> 200 { report, period, net,
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

Implemented on `feat/epic-18-dashboards-reports`, extending the same module.

- **The sign map is imported, not copied.** `reporting.service.ts` imports
  `cashMovementSign` from `../cash/cash.expected-amount.js`. DEC-030 exists
  because the sign lives in the movement KIND, and a second copy of that switch
  statement would be a second opinion about the same money; a test asserts the
  coupling, so the report cannot drift from the close command. `signedAmount` is
  `amount` or `amount.negated()` on `Prisma.Decimal` — never a float multiply.
- **`cash-sessions` reads `CLOSED` sessions dated by `closedAt`** and **asserts
  the domain invariant per row**: `counted - expected === difference`, compared
  with `Decimal.equals()`. A row whose three stored amounts disagree throws
  `INTERNAL` naming the session, because reporting a drawer that does not add up
  without saying so is worse than refusing.
- **`cash-movements` dates each movement by its own `createdAt`.**
  `cash_movement` is append-only with no `updated_at`, so its creation instant
  IS the movement's business instant; dating a movement by its session's close
  would move it to a different period.
- **`purchases` reads `RECEIVED` rows dated by `receivedAt`** and carries **no
  money field and no total**, asserted structurally in a test. The aggregate
  owns no total and no payment state, and `unitCost` is informational; a total
  derived from it would report a number the domain deliberately does not have.
  Suppliers resolve in ONE batched tenant-predicated read.
- **No `currency` key on either cash response.** The first version of this
  Story's API sketch showed one; `docs/05-modules/Cash.md` and the models
  confirm the Cash domain carries **no currency column**, so inventing one would
  have been the same class of error as inventing a purchase total. The sketch is
  corrected above.
- Three per-read caps (5 000 sessions, 20 000 movements, 5 000 purchases), each
  with `take: LIMIT + 1` and a refusal rather than a truncated aggregate.
- The three routes are behind `reports.read`, re-asserted in the service, and
  pinned in `EXPECTED_ROUTE_INVENTORY` and `REPORTING_PERMISSION_BY_ROUTE`.

## Verification

```text
pnpm format-check   PASS
pnpm lint           PASS  (23/23 turbo tasks)
pnpm typecheck      PASS  (23/23)
pnpm build          PASS  (13/13)
pnpm test           PASS  (23/23)
  api        106 files (104 landed + 2 new)      1478 passed | 266 skipped  (+46)
  database    30 files                            549 passed
  web        110 files                           1164 passed
```

46 new tests: 32 service (one case per movement kind plus `ADJUSTMENT` in both
directions, the net against an independently recomputed signed sum, the
close-result mismatch refusal, the caps, the permission-before-any-read
ordering, the structural absence of a purchase money key) and 14 integration
through `bootTestApp()` (the period echo, the row-level
`OPENED inside / CLOSED outside` exclusion, the
`DRAFT`/`CANCELLED`/null-`receivedAt` exclusions, the half-open boundary, and
tenant isolation for all three).

The boundary tests are deliberately split by layer: the service suite proves the
_query_ the report issues, and the integration suite proves the _predicate the
fixture actually applies_. A stub returns whatever it is handed, so only the
second can catch a fake that agrees with a bug.

**All three queries were also proven against real PostgreSQL**, because the
route suites run on the in-memory fixture and a fake that agrees with the code
proves nothing about the planner. Against a freshly migrated database seeded
through the real invariants (a movement cannot enter a CLOSED session, one OPEN
session per register, manual kinds need a reason), for the period
`[2026-06-01T03:00Z, 2026-06-11T03:00Z)` in `America/Asuncion`:

```text
cash-sessions rows: 1   (the CLOSED session; the OPEN one is correctly excluded)
  closed 2026-06-05T20:00Z expected 600.00 counted 595.00 diff -5.00
  counted - expected === difference -> true

cash-movements rows: 3   (the 2026-06-20 sale is outside the period)
  SALE                amount 150.00  signed  150.00
  WITHDRAWAL          amount  40.00  signed  -40.00
  ADJUSTMENT/DECREASE amount   2.50  signed   -2.50
  net: 107.50   (exactly 150.00 - 40.00 - 2.50, signed by the shipped map)

purchases rows: 1   (the DRAFT purchase has a null receivedAt)
  received 2026-06-04T10:00Z supplier VetSupply lines 2 qty 3.750
  supplier read resolved: 1 of 1   (one batched read, no N+1)
```

The seeding itself surfaced three database invariants this report must respect
and does not bypass: `cash_movement_no_insert_into_closed_session`,
`cash_session_one_open_per_register_key` and `cash_movement_reason_required`. A
movement's history is append-only inside an open drawer, which is precisely why
the movement report dates rows by their own `createdAt`.

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
  sale linkage. An explicit non-goal rather than a silent gap.
- No purchase money total, because the purchase aggregate owns none.
- **The cash reports are tenant-wide and have no per-register cut.** Each
  session row carries its `registerId`, but there is no register filter and the
  movement report aggregates every register together. There is no `branchId`
  anywhere (DEC-020), so a branch cut is [[TD-052]]'s problem, but a
  per-register filter is a smaller and separate gap this Story does not close.
- `listSuppliersByIds` carries no explicit row cap: its id set is derived from
  the already-capped purchase read and deduped, so it is bounded by that cap.
  Recorded so a later reader does not mistake the asymmetry for an oversight.
- Two extra `INTERNAL` messages were needed because `closedAt`/the close amounts
  and `receivedAt` are nullable in Prisma. They assert presence rather than
  defaulting a missing close amount to `"0.00"` or dropping an undated receipt.
  No error _codes_ were minted.
- The caps on the three reads are proven at the SERVICE level (the suites assert
  the `take: LIMIT + 1` argument and the refusal), not against the engine: the
  in-memory fake ignores `take`. [[TD-056]] records that gap and its trigger.

## Technical Debt

- [[TD-052]] — the branch dimension no finance ledger carries.
- [[TD-053]] — report query performance beyond directed indexes.

## Decisions / ADRs

- [[DEC-062]], [[DEC-063]], [[DEC-064]].

## Files / Modules

- `apps/api/src/reporting/` — three service methods, three repository queries,
  three routes, their DTOs
- `docs/05-modules/Reporting.md`

## Completion Notes

All required gates passed on 2026-10-19. The `apps/e2e` lane was not run (Docker
unavailable; this Story adds no UI).
