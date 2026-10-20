---
type: module
status: implemented
epic: EPIC-18
updated: 2026-10-20
---

# Reporting

The reporting module answers PRD §31's questions about data the tenant already
owns: sales by period, payment methods, sales by product/service, the cash
ledger, the receipts and the inventory. It is a Core domain and a **read-only**
one — nothing in this module writes, so there is no ledger, no audit row and no
reversal to reason about here.

[[REP-002]] established the foundation every later report consumes: the period
rule, the response contract and the permission family. [[REP-003]] added the two
commercial cuts over the same completed sales, [[REP-004]] added the cash ledger
and the receipts, and [[REP-005]] added the two inventory reports.

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

| Route                                   | Permission     | Contract                                                                                                    |
| --------------------------------------- | -------------- | ----------------------------------------------------------------------------------------------------------- |
| `GET /reports/sales-by-period`          | `reports.read` | Completed sales of the resolved period, bucketed by the tenant's local day, money as decimal strings.       |
| `GET /reports/payment-methods`          | `reports.read` | The period's payments summed per `PaymentMethod`, with a payment count and the share of the period's gross. |
| `GET /reports/sales-by-product-service` | `reports.read` | The period's sale lines grouped per `catalog_item`, with quantity, net, tax, gross and the `kind` roll-up.  |
| `GET /reports/cash-sessions`            | `reports.read` | The sessions that **closed** in the period, with their stored opening, expected, counted and difference.    |
| `GET /reports/cash-movements`           | `reports.read` | The period's movements rolled up per `(type, direction)` with the [[DEC-030]] sign resolved, plus the net.  |
| `GET /reports/purchases`                | `reports.read` | The purchases **received** in the period, with their line count, total quantity and supplier (no money).    |
| `GET /reports/stock`                    | `reports.read` | The CURRENT balance per tracked item, plus the PERIOD's ledger flow (in, out, net).                         |
| `GET /reports/low-stock`                | `reports.read` | The items at or below their own threshold. **No query parameters at all.**                                  |

There is deliberately no command route, no `PATCH` and no `DELETE`: a report
aggregates and never writes. Tenant identity is never an input — it comes from
the request context inside the repository — so there is no
cross-tenant-addressable resource on this surface.

Query: `?preset=<preset>` **or** `?from=YYYY-MM-DD&to=YYYY-MM-DD`. The query
schema is strict, so an unknown key is refused rather than ignored.
`GET /reports/low-stock` is the ONE exception and takes no query at all: it is a
current-state view, so every key — `from`, `to`, `preset`, a typo, a `tenantId`
— is a `400` with `This report takes no query parameters.` instead of a key that
silently does nothing.

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

### `GET /reports/payment-methods`

How the money arrived. One row per `PaymentMethod` that HAS payments in the
period — `CASH`, `CARD`, `BANK_TRANSFER`, `QR`, `CHECK`, `OTHER`.

The period predicate is the SALE's `completed_at`, **never**
`payment.created_at`: a payment row is written only by the `CompleteSale`
transaction ([[DEC-029]]), so its own timestamp is an implementation detail of
the same commit. Cutting this report on the payment timestamp would let two
reports disagree about one revenue.

| Column         | Meaning                                                                               |
| -------------- | ------------------------------------------------------------------------------------- |
| `method`       | The `PaymentMethod` enum literal.                                                     |
| `paymentCount` | Payments recorded with this method in the period.                                     |
| `amount`       | Summed `Decimal(14, 2)` amount, exact fixed-scale string.                             |
| `shareOfGross` | `amount / totalGross`, fixed-scale **4 decimals**; `"0.0000"` when the gross is zero. |

Rows are ordered by `amount` **descending**, then `method` ascending: the
biggest tender is first, and two equal totals still have one order. A method
with no payment in the period is ABSENT — never a zero row that would claim the
tenant was paid nothing that way. Rounded shares need not add to `"1.0000"`.

The report reads `payment` and never `cash_movement`: `cash_movement` carries no
`sale_id`, so a payment cannot be traced to a cash movement and the two ledgers
answer different questions (the cash reports of [[REP-004]] read the other one).

```json
{
  "report": "payment-methods",
  "period": {
    "preset": null,
    "fromDate": "2026-06-10",
    "toDate": "2026-06-11",
    "timeZone": "America/Asuncion",
    "fromInstant": "2026-06-10T03:00:00.000Z",
    "toInstant": "2026-06-12T03:00:00.000Z"
  },
  "currency": "PYG",
  "totalGross": "2430.00",
  "rows": [
    {
      "method": "CASH",
      "paymentCount": 1,
      "amount": "1000.55",
      "shareOfGross": "0.4117"
    },
    {
      "method": "BANK_TRANSFER",
      "paymentCount": 1,
      "amount": "850.00",
      "shareOfGross": "0.3498"
    },
    {
      "method": "CARD",
      "paymentCount": 2,
      "amount": "579.45",
      "shareOfGross": "0.2385"
    }
  ]
}
```

### `GET /reports/sales-by-product-service`

Which products and services earned the money. Lines are grouped by their frozen
`sale_line.catalog_item_id`, and the item's identity, name and `kind` are
resolved in ONE tenant-predicated catalog read — no query per item.

| Column          | Meaning                                                                                       |
| --------------- | --------------------------------------------------------------------------------------------- |
| `catalogItemId` | The frozen `sale_line.catalog_item_id` the lines were grouped by.                             |
| `name`          | The item's name as the catalog holds it today.                                                |
| `kind`          | `PRODUCT`, `SERVICE`, `MEDICATION` or `SUPPLY` — a FACT about the item (never `tracksStock`). |
| `quantity`      | Summed `Decimal(10, 3)` quantity, exact fixed-scale **3 decimals** (`"3.500"`).               |
| `net`           | Summed `taxable_base`, exact fixed-scale 2 decimals.                                          |
| `tax`           | Summed `tax_amount`, exact fixed-scale 2 decimals.                                            |
| `gross`         | Summed `line_total` (tax included), exact fixed-scale 2 decimals.                             |

`totalsByKind` carries `net`, `tax`, `gross` and `quantity` for every `kind`
that actually appears, keyed by the enum literal. A kind with no line in the
period is ABSENT, never a zero block.

Rows are ordered by `gross` descending, then `name` ascending. An item with no
sale in the period does not appear, and an item sold only in a `CANCELLED` sale
does not appear either — the status predicate excludes the line at the query,
not by a later filter.

A referenced item the catalog read does not return is a **loud** `500 INTERNAL`
naming the id, never a silently dropped revenue line.
`sale_line.catalog_item_id` is a `RESTRICT` composite foreign key, so the branch
is unreachable; it is asserted rather than assumed precisely because the
alternative — a report that is quietly short by an amount nobody can see — looks
exactly like a correct one.

```json
{
  "report": "sales-by-product-service",
  "period": {
    "preset": null,
    "fromDate": "2026-06-10",
    "toDate": "2026-06-11",
    "timeZone": "America/Asuncion",
    "fromInstant": "2026-06-10T03:00:00.000Z",
    "toInstant": "2026-06-12T03:00:00.000Z"
  },
  "currency": "PYG",
  "totalsByKind": {
    "PRODUCT": {
      "net": "1500.00",
      "tax": "0.00",
      "gross": "1500.00",
      "quantity": "3.000"
    },
    "SERVICE": {
      "net": "550.00",
      "tax": "30.00",
      "gross": "580.00",
      "quantity": "2.000"
    },
    "MEDICATION": {
      "net": "350.00",
      "tax": "0.00",
      "gross": "350.00",
      "quantity": "3.500"
    }
  },
  "rows": [
    {
      "catalogItemId": "2222…",
      "name": "Vacuna antirrábica",
      "kind": "PRODUCT",
      "quantity": "3.000",
      "net": "1500.00",
      "tax": "0.00",
      "gross": "1500.00"
    },
    {
      "catalogItemId": "3333…",
      "name": "Consulta clínica",
      "kind": "SERVICE",
      "quantity": "2.000",
      "net": "550.00",
      "tax": "30.00",
      "gross": "580.00"
    },
    {
      "catalogItemId": "4444…",
      "name": "Antibiótico",
      "kind": "MEDICATION",
      "quantity": "3.500",
      "net": "350.00",
      "tax": "0.00",
      "gross": "350.00"
    }
  ]
}
```

### `GET /reports/cash-sessions`

What the drawer actually did. Every session that **closed** inside the period,
with the close result the close command stored.

The period predicate is `cash_session.closed_at`, **never** `opened_at` and
never `created_at`: a session opened yesterday and closed today is today's
close, and a session opened today and closed next week belongs to next week's
report. `OPEN` sessions never appear — an open drawer has no close result and no
close instant, and printing NULLs (or zeros) for it would report a count nobody
performed.

| Column             | Meaning                                                                   |
| ------------------ | ------------------------------------------------------------------------- |
| `sessionId`        | The `cash_session` id.                                                    |
| `registerId`       | The register the drawer belonged to.                                      |
| `openedAt`         | ISO 8601 instant the session was opened — context, not the predicate.     |
| `closedAt`         | ISO 8601 instant of the `OPEN` → `CLOSED` transition — the predicate.     |
| `openingAmount`    | Stored opening float, exact fixed-scale 2 decimals.                       |
| `expectedAmount`   | Stored server-computed expected amount, exact fixed-scale 2 decimals.     |
| `countedAmount`    | Stored operator-counted amount, exact fixed-scale 2 decimals.             |
| `differenceAmount` | Stored `counted − expected`, fixed-scale 2 decimals, negative when short. |

Rows are ordered by `closedAt` ascending. `totals` carries `expected`, `counted`
and `difference` summed with `Prisma.Decimal`, so the period total is the row
sums exactly.

There is no `currency`: a drawer amount is the tenant's own cash and the Cash
domain carries no currency column (`Cash.md`), so a code here would be invented
rather than resolved.

**The report asserts `counted − expected = difference` on every row it
returns.** The close command computes both from the same inputs ([[DEC-031]]),
so the three columns agree by construction; the report re-checks the invariant
instead of trusting it, and a row that violates it refuses with a loud
`500 INTERNAL` naming the session id. The stored `differenceAmount` is
authoritative: a report that silently printed a row where the three disagree
would publish a drawer result that never happened, and one that recomputed the
difference instead would silently overrule what the operator counted.

An empty period is `rows: []` with every total `"0.00"`.

```json
{
  "report": "cash-sessions",
  "period": {
    "preset": null,
    "fromDate": "2026-06-10",
    "toDate": "2026-06-11",
    "timeZone": "America/Asuncion",
    "fromInstant": "2026-06-10T03:00:00.000Z",
    "toInstant": "2026-06-12T03:00:00.000Z"
  },
  "rows": [
    {
      "sessionId": "7c1f…",
      "registerId": "41ab…",
      "openedAt": "2026-06-09T12:00:00.000Z",
      "closedAt": "2026-06-10T20:00:00.000Z",
      "openingAmount": "100.00",
      "expectedAmount": "250.00",
      "countedAmount": "245.00",
      "differenceAmount": "-5.00"
    }
  ],
  "totals": { "expected": "250.00", "counted": "245.00", "difference": "-5.00" }
}
```

### `GET /reports/cash-movements`

The movements recorded in the period, rolled up per `(type, direction)`, with
the sign convention of [[DEC-030]] resolved.

The period predicate is the movement's OWN `created_at`. `cash_movement` is
append-only with no `updated_at` by design, so its creation instant IS the
movement's business instant. The session a movement belongs to is a different
fact and never dates it: a movement recorded at 23:59 belongs to that day even
if its drawer closes the next morning.

| Column          | Meaning                                                                               |
| --------------- | ------------------------------------------------------------------------------------- |
| `type`          | The `CashMovementType` enum literal.                                                  |
| `direction`     | The `ADJUSTMENT`-only direction; `null` for every type-owned kind.                    |
| `movementCount` | Movements of this `(type, direction)` in the period.                                  |
| `signedAmount`  | Summed SIGNED amount, exact fixed-scale 2 decimals — negative for a subtractive kind. |

Rows are ordered by `type` ascending, then `direction` ascending with `null`
first, so the contract is total and stable rather than a map's insertion order.
`net` is the signed sum of EVERY movement in the period and may be negative: a
drawer that only paid out reports a negative net, and the sign is always
rendered.

**The stored `amount` is ALWAYS POSITIVE — the kind owns the sign**
([[DEC-030]]): `SALE`, `INCOME` and `DEPOSIT` add; `REFUND`, `EXPENSE` and
`WITHDRAWAL` subtract; `ADJUSTMENT` follows its explicit `direction`. The report
resolves the sign by IMPORTING `cashMovementSign` from `cash.expected-amount.ts`
— the ONE implementation of the map in the repository — and never by restating
it here. A second copy would be exactly the drift DEC-030 exists to prevent, so
a report that summed `amount` without that call is wrong by construction.

`net` is accumulated from the movements as they are read while each row's
`signedAmount` is accumulated per group, so the two are computed on independent
paths and a rounding mistake cannot agree with itself.

An empty period is `rows: []` with `net: "0.00"`.

```json
{
  "report": "cash-movements",
  "period": {
    "preset": null,
    "fromDate": "2026-06-10",
    "toDate": "2026-06-11",
    "timeZone": "America/Asuncion",
    "fromInstant": "2026-06-10T03:00:00.000Z",
    "toInstant": "2026-06-12T03:00:00.000Z"
  },
  "net": "73.50",
  "rows": [
    {
      "type": "ADJUSTMENT",
      "direction": "DECREASE",
      "movementCount": 1,
      "signedAmount": "-2.00"
    },
    {
      "type": "ADJUSTMENT",
      "direction": "INCREASE",
      "movementCount": 1,
      "signedAmount": "1.00"
    },
    {
      "type": "DEPOSIT",
      "direction": null,
      "movementCount": 1,
      "signedAmount": "20.00"
    },
    {
      "type": "EXPENSE",
      "direction": null,
      "movementCount": 1,
      "signedAmount": "-5.50"
    },
    {
      "type": "INCOME",
      "direction": null,
      "movementCount": 1,
      "signedAmount": "3.00"
    },
    {
      "type": "REFUND",
      "direction": null,
      "movementCount": 1,
      "signedAmount": "-10.00"
    },
    {
      "type": "SALE",
      "direction": null,
      "movementCount": 2,
      "signedAmount": "107.00"
    },
    {
      "type": "WITHDRAWAL",
      "direction": null,
      "movementCount": 1,
      "signedAmount": "-40.00"
    }
  ]
}
```

This report reads `cash_movement` and never `payment`, and it does NOT reconcile
the drawer against the day's payments: `cash_movement` carries no `sale_id`, so
the reconciliation is not expressible and is an explicit non-goal ([[REP-004]])
rather than a silent gap.

### `GET /reports/purchases`

What the tenant actually received. Only `RECEIVED` purchases whose `received_at`
falls in the period: a `DRAFT` was never received and a `CANCELLED` one was
never stock.

| Column          | Meaning                                                                         |
| --------------- | ------------------------------------------------------------------------------- |
| `purchaseId`    | The `purchase` id.                                                              |
| `supplierId`    | The supplier the receipt was booked against.                                    |
| `supplierName`  | The supplier's name as the registry holds it today.                             |
| `receivedAt`    | ISO 8601 instant of the `DRAFT` → `RECEIVED` transition — the predicate.        |
| `lineCount`     | How many lines the purchase was received with.                                  |
| `totalQuantity` | Summed `Decimal(10, 3)` quantity, exact fixed-scale **3 decimals** (`"3.750"`). |

Rows are ordered by `receivedAt` ascending. Suppliers are resolved in ONE
batched, tenant-predicated read (no query per purchase); an empty period asks
for nothing. A supplier the read does not return refuses with a loud
`500 INTERNAL` naming the id — `purchase.supplier_id` is a `RESTRICT` composite
foreign key, so the branch is unreachable, and a dropped receipt would be worse
than a failure.

**There is NO money column and no total anywhere in this response.**
`PurchaseLine.unitCost` is optional and explicitly informational ([[DEC-013]]),
and the purchase aggregate owns no total and no payment state (`Purchases.md`).
Inventing a total from the unit costs would report a number the domain
deliberately does not have; what the domain DOES own is the line quantity at the
ledger scale, and that is what is summed. The row type is pinned key-by-key in
the service suite (`Record<keyof PurchaseRowDto, true>`), so adding a money key
fails to compile as well as failing the runtime key-set assertion.

An empty period is `rows: []`.

```json
{
  "report": "purchases",
  "period": {
    "preset": null,
    "fromDate": "2026-06-10",
    "toDate": "2026-06-11",
    "timeZone": "America/Asuncion",
    "fromInstant": "2026-06-10T03:00:00.000Z",
    "toInstant": "2026-06-12T03:00:00.000Z"
  },
  "rows": [
    {
      "purchaseId": "b3d2…",
      "supplierId": "9f04…",
      "supplierName": "Distribuidora Norte",
      "receivedAt": "2026-06-10T10:00:00.000Z",
      "lineCount": 2,
      "totalQuantity": "3.750"
    }
  ]
}
```

### `GET /reports/stock`

What is on hand, and what moved in the period. **Two different facts live in
every row and they must never be read as one:**

| Column                          | Source                       | Meaning                                                                                                     |
| ------------------------------- | ---------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `quantity`                      | `stock_balance` (PROJECTION) | The **CURRENT BALANCE** — a SNAPSHOT as of now. No history, no date, never narrowed by the period.          |
| `inbound`                       | `stock_movement` (LEDGER)    | The **PERIOD'S** sum of the POSITIVE ledger quantities.                                                     |
| `outbound`                      | `stock_movement` (LEDGER)    | The **PERIOD'S** negative quantities as a POSITIVE MAGNITUDE — the absolute value of their sum.             |
| `net`                           | `stock_movement` (LEDGER)    | The **PERIOD'S** signed sum: `inbound − outbound` exactly, negative when the period moved more out than in. |
| `name`, `kind`, `catalogItemId` | `catalog_item`               | The item's identity as the catalog holds it today.                                                          |

`quantity` is **not** the period's net. An item stocked last year and sold last
week has a positive `quantity` and a negative `net` for last week; an item with
a balance and no movement in the period reports `"0.000"` for all three flow
columns while keeping its balance. The two numbers answer different questions,
which is why the report reads the projection for one and the ledger for the
other and never derives either from the other.

`stock_balance` is a transactional projection — exactly one row per
`(tenant, item)`, written in the same transaction as the movements that change
it, under the per-`(tenant, item)` advisory lock EPIC-10 introduced after the
projection's `BLOCK` race produced a real lost update. `stock_movement` is the
immutable ledger. The balance is **never** the source of truth and this report
never recalculates or repairs it: if it were wrong, that is an EPIC-10 concern,
not a reporting one.

`stock_movement.quantity` is **already signed** — positive is an input, negative
an output — and the database rejects zero. No movement type owns that sign (the
contrast with cash is deliberate: [[DEC-030]] puts the sign in the kind). The
types are only `ADJUSTMENT`, `PURCHASE` and `SALE`, and the report never
interprets them for the flow: `inbound` sums the positives, `outbound` sums the
absolute values of the negatives, `net` sums the signed rows. All three are
`Prisma.Decimal` from the first add and are emitted on the column's own
`Decimal(10, 3)` scale.

One row per item that has a balance row **and** `tracksStock = true`. An item
with `tracksStock = false` appears in neither inventory report, even when it has
a balance and a threshold. An item with no balance row has never moved and is
absent: there is no snapshot to report.

Rows are ordered by `name` ascending, then `catalogItemId` ascending.

An item with movements in the period but **no** balance row is an anomalous data
state — the projection is co-committed with its movements — and the report
refuses with a loud `500 INTERNAL` naming the item instead of dropping the flow.
A body that names a catalog item the batched read did not return is the same
refusal: the composite `RESTRICT` foreign key makes it unreachable, and a
nameless row would be worse than a failure.

There is no `currency`: a quantity is not money, and no item carries a cost
([[DEC-010]]), so valuation would invent a costing method ([[REP-005]], out of
scope).

```json
{
  "report": "stock",
  "period": {
    "preset": null,
    "fromDate": "2026-06-10",
    "toDate": "2026-06-11",
    "timeZone": "America/Asuncion",
    "fromInstant": "2026-06-10T03:00:00.000Z",
    "toInstant": "2026-06-12T03:00:00.000Z"
  },
  "rows": [
    {
      "catalogItemId": "57aa…",
      "name": "Balanceado 10kg",
      "kind": "SUPPLY",
      "quantity": "10.000",
      "inbound": "15.000",
      "outbound": "5.000",
      "net": "10.000"
    },
    {
      "catalogItemId": "41ab…",
      "name": "Jeringa 5ml",
      "kind": "SUPPLY",
      "quantity": "0.000",
      "inbound": "0.000",
      "outbound": "20.000",
      "net": "-20.000"
    }
  ]
}
```

An empty period over an empty inventory is `rows: []` with the period echoed,
never an error.

**The balance-versus-ledger invariant is a TEST-level check, not a runtime
one.** EPIC-10's closure proved that the projection equals the signed sum of its
movements, and the service suite reuses that equality as a report-level guard
for a seeded item with inbound and outbound movements. It cannot be asserted at
runtime: the report's ledger read is **period-bounded**, so production never
sees an item's lifetime movements and could not compute the lifetime sum the
balance represents. That asymmetry is exactly why the two numbers are labelled
separately in the DTO.

### `GET /reports/low-stock`

What is about to run out. It is a **current-state** view, not a period view, so
it takes **no query parameters at all**: `?from=…` on this route is a `400`
rather than a silently ignored key.

| Column          | Meaning                                                                                    |
| --------------- | ------------------------------------------------------------------------------------------ |
| `catalogItemId` | The item the threshold belongs to.                                                         |
| `name`          | The item's name as the catalog holds it today.                                             |
| `quantity`      | The **CURRENT BALANCE**, exact fixed-scale 3 decimals — a snapshot, exactly as in `stock`. |
| `threshold`     | The item's own non-NULL `low_stock_threshold`, 3 decimals.                                 |
| `shortfall`     | `threshold − quantity`, 3 decimals. Always `>= 0`; `"0.000"` means exactly at it.          |

A row appears only when the item's threshold is **non-NULL** and
`quantity <= threshold`. The comparison is `<=`, not `<`: an item sitting
exactly on its threshold has nothing to spare, so it is low; one a thousandth
above it is not.

**NULL means "not monitored", and the report never invents a default**
([[DEC-065]]). An item with a NULL threshold never appears — not even at
quantity zero — because nobody said what "low" means for it. A tenant-level
default was explicitly rejected: ten units of a vaccine and ten units of a
syringe are not the same fact. Every tenant therefore starts with an empty
report, which is a first-run state the UI must render honestly rather than as a
failure.

`tracksStock = false` items never appear here either.

Rows are ordered `shortfall` **descending**, then `name` ascending: the most
depleted item is first, and two items equally short still have one order. The
sort runs on exact `Decimal` values before anything is formatted, so the
ordering is never decided by a rendered string.

**`thresholdsConfigured` makes the two empty answers distinguishable.** Both are
an empty `rows` array, and they must not look identical:

| `thresholdsConfigured` | `rows` | Meaning                                                   |
| ---------------------- | ------ | --------------------------------------------------------- |
| `false`                | `[]`   | Nobody has set a threshold yet — the report is unstarted. |
| `true`                 | `[]`   | Thresholds exist and every item is above its own.         |

The flag is true when at least one tracked item the report read carries a
non-NULL threshold. It is computed over the items that HAVE a balance row,
because the projection is what the report reads: an item that has a threshold
but has never moved has no balance to compare and no row to render, so it is not
visible to this view (a data-source limitation of [[REP-005]], not a bug).

There is no `period` echo and no `currency` on this response: a current-state
view that echoed a range would claim a filter that was never applied.

```json
{
  "report": "low-stock",
  "thresholdsConfigured": true,
  "rows": [
    {
      "catalogItemId": "41ab…",
      "name": "Jeringa 5ml",
      "quantity": "0.000",
      "threshold": "2.000",
      "shortfall": "2.000"
    },
    {
      "catalogItemId": "6cd1…",
      "name": "Alcohol 500ml",
      "quantity": "6.000",
      "threshold": "6.000",
      "shortfall": "0.000"
    }
  ]
}
```

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
- **The row cap is a refusal, not a truncation.** Each read has its own cap and
  asks for one extra row: `REPORT_SALE_ROW_LIMIT` (20 000 completed sales),
  `REPORT_CASH_MOVEMENT_ROW_LIMIT` (20 000 movements),
  `REPORT_STOCK_MOVEMENT_ROW_LIMIT` (20 000 stock movements), and
  `REPORT_CASH_SESSION_ROW_LIMIT` / `REPORT_PURCHASE_ROW_LIMIT` /
  `REPORT_STOCK_BALANCE_ROW_LIMIT` (5 000 sessions / receipts / balances).
  Exceeding one refuses with a stable message rather than returning a silently
  partial aggregate ([[TD-053]] owns the eventual pushdown). The caps differ
  because a drawer closes once a day per register and an inventory holds one
  balance per item, while a movement ledger is the dense one.
- **A snapshot and a flow are never the same number.** The inventory reports
  read `stock_balance` (a projection: CURRENT quantity, one row per item, no
  history) for `quantity`, and `stock_movement` (the immutable ledger) for the
  period's `inbound`/`outbound`/`net`. Neither is derived from the other,
  `quantity` is never presented as a period figure, and the DTO, this document
  and the module doc all state the difference. A balance with no movement in the
  period reports `"0.000"` flows; a movement with no balance row refuses with
  `INTERNAL` rather than being dropped.
- **The stock sign is the stored one.** `stock_movement.quantity` is already
  signed — positive in, negative out, zero rejected by the database — and no
  type owns it (unlike cash, [[DEC-030]]). `outbound` is emitted as a POSITIVE
  magnitude and `net` keeps the sign, so a reader never has to guess which
  column carries a minus.
- **A NULL threshold is not a default.** The low-stock report compares against
  the item's own `low_stock_threshold` and skips NULL entirely ([[DEC-065]]): an
  unmonitored item never appears, not even at quantity zero.
  `thresholdsConfigured` is what lets a caller tell "nobody opted in" from
  "everything is fine" — both are an empty `rows` array.
- **`tracksStock = false` is not inventory.** A non-tracking item appears in
  neither inventory report, whatever balance or threshold it holds.
- **A report dates a row by its BUSINESS instant, never by a bookkeeping one.**
  Sales: `completed_at`. Closes: `closed_at`. Movements: their own `created_at`
  (the ledger is append-only, so the creation instant IS the business instant —
  and never the session's close). Receipts: `received_at`. `created_at` and
  `updated_at` are never substitutes, and consecutive periods partition because
  every range is half-open `[fromInstant, toInstant)`.
- **The cash sign lives in exactly one place.** Every cash amount is stored
  positive and the kind owns the sign ([[DEC-030]]); the cash reports resolve it
  by importing `cashMovementSign` from `cash.expected-amount.ts`, the same map
  the close command uses. The reporting module holds no second copy.
- **A closed session's stored difference is authoritative.** The report asserts
  `counted − expected = difference` for every row and refuses loudly naming the
  session otherwise; it never recomputes the difference in place of the stored
  one.
- **A purchase has no money total.** `unitCost` is informational and the
  aggregate owns no total ([[DEC-013]], `Purchases.md`), so the receipts report
  reports lines and quantities only.
- **An empty period is an answer.** It returns `rows: []`, `saleCount: 0` and
  `"0.00"` totals with the period echoed — never an error, so a caller can tell
  "no sales" apart from "rejected".
- **One aggregation path.** A dashboard card and its report will call the same
  service method ([[DEC-062]]); this module is the only place the query exists.
- **The three commercial reports describe ONE revenue.** `Sales.md` states that
  a completed sale's payments sum EXACTLY to its total, and a sale's total is
  the sum of its line totals. Therefore, for the SAME period, the sum of
  `payment-methods` amounts, the sum of `sales-by-product-service` row grosses
  and `sales-by-period`'s `totalGross` must be the same string — not almost the
  same. The suite asserts it with exact string equality and no epsilon; if the
  three ever diverge, one of them is lying. This is also why the payment report
  cuts on the sale's `completed_at` rather than the payment's own timestamp.
- **Money and quantity are never a `number`.** Every aggregate is
  `Prisma.Decimal` from the first add, and every value crosses the boundary as a
  fixed-scale string at its column scale: 2 decimals for money
  (`Decimal(14, 2)`), 3 for quantities (`Decimal(10, 3)`), 4 for `shareOfGross`.
  No `aggregate`, no `groupBy` and no raw SQL: the aggregation is TypeScript
  `Decimal` arithmetic over the rows, because the module has no second place a
  total could be computed.

## What later stories add

The remaining reports ([[REP-006]]) reuse `resolveReportPeriod`, the response
contract and the `reports.read` key. The CSV export ([[REP-007]]) consumes
`reports.export`. The dashboard ([[REP-008]]) consumes the same service methods
rather than a second query. Stock **valuation** stays out of scope: no item
carries a cost ([[DEC-010]]), so a valuation report would invent a costing
method, and repairing a wrong `stock_balance` belongs to EPIC-10 rather than to
a report.

## Tests

- `report.period.test.ts` — the five presets against a pinned instant, the year
  boundary, the month-length difference (28 vs 29), the 1st-of-month case, the
  DST-crossing range, a single-offset range, the 366/367 bound and every
  rejection message.
- `reporting.service.test.ts` — Decimal summation (a float accumulator cannot
  produce `"0.30"`), local-day bucketing, the declared half-open predicate, the
  empty period, the row cap at and over its limit, and the 403 that reaches no
  query. For the commercial reports: tender grouping and counting, the
  `amount`-descending order with the `method` tie-break, the zero-gross share
  guard, the by-item grouping at both scales, an item sold in two lines of one
  sale, the `gross`-descending order with the `name` tie-break, the `kind`
  roll-up, the single catalog read, the missing-catalog-item `INTERNAL`, the
  empty period that reads no catalog, and the cross-report equality of tenders
  and period gross.
- `reporting.integration.test.ts` — 200 with the period echoed, 400 per
  malformed period, 401 unauthenticated, 403 without `reports.read`, the
  exclusive-boundary sale counted in the next period, and tenant isolation
  (tenant B's sales never appear in tenant A's report for the same period). For
  the commercial reports: both routes 200 with their seeded rows and ordering,
  the cross-report invariant over three days and three methods, tenant isolation
  for payments and sale lines, the empty period, 400 per malformed period on
  both, and 403 without `reports.read` on both.
- `reporting.cash-purchase.service.test.ts` — [[REP-004]]: one sign case per
  `CashMovementType` plus `ADJUSTMENT` in both directions, the grouped roll-up
  and its total order, the net against an independently computed signed sum, a
  period of only corrections and one of only subtractive kinds (negative net),
  the `counted − expected = difference` refusal naming the session, the query
  predicates (`CLOSED` / `receivedAt` / movement `createdAt`, half-open), the
  purchase quantity at scale 3, the purchase row's exact key set (no money key),
  the missing-supplier `INTERNAL`, the batched supplier read and its
  empty-period skip, every empty period, each row cap, and the 403 that reaches
  no query.
- `reporting.cash-purchase.integration.test.ts` — [[REP-004]]: all three routes
  200 with the period echoed, the closed-session rows and totals with `closedAt`
  ordering, a session opened inside but closed outside EXCLUDED, a session
  opened before but closed inside INCLUDED, an `OPEN` session absent, a close
  exactly at `toInstant` counted in the next period, the movement roll-up with
  the sign resolved and the net, movements dated by their own `createdAt` and
  not by their session, the received purchases with line count and total
  quantity, `DRAFT`/`CANCELLED`/boundary receipts absent, tenant isolation for
  sessions, movements and purchases, the empty period, 400 per malformed period
  on all three, 403 without `reports.read` on all three and 401 unauthenticated.
- `reporting.inventory.service.test.ts` — [[REP-005]]: the
  balance-equals-signed- ledger-sum invariant with the reason it is a test-level
  check only, the signed flow split into a positive `inbound` /
  positive-magnitude `outbound` / signed `net`, the half-open movement query and
  the undated balance query, the balance with no period movement, an item sold
  to exactly zero, the missing-balance `INTERNAL` naming the item, the
  missing-catalog-item `INTERNAL`, the union catalog read, both orderings, the
  `tracksStock = false` exclusion from BOTH reports, the empty inventories, the
  exact row key sets (no `currency`), both row caps, the 403 that reaches no
  query, and for low stock: at-threshold included / just-above excluded /
  NULL-threshold excluded at quantity zero, the exact shortfall, the
  `shortfall`-descending order with the `name` tie-break, and the two
  distinguishable empty states.
- `reporting.inventory.integration.test.ts` — [[REP-005]]: both routes 200 with
  the snapshot and the period's flow, the period echoed on `stock` only, a
  boundary movement counted in the NEXT period, out-of-period movements reaching
  no total, the non-tracking item and the NULL-threshold item absent, the
  low-stock ordering with the `name` tie-break and an at-threshold row,
  `thresholdsConfigured: false` for a tenant where nobody opted in, 400 per
  malformed period on `stock`, **400 for ANY query key on `low-stock`**, 403
  without `reports.read` on both, 401 unauthenticated, and tenant isolation for
  balances, movements, items and low-stock rows.
- `packages/database/src/reference-seed.test.ts` — `reports.read` is held by all
  six roles and `reports.export` by exactly `OWNER` and `ADMIN`.
- `route-contract.probe.test.ts` — the route and its exact permission are
  pinned.
