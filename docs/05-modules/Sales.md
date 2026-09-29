---
type: module
status: implemented
epic: EPIC-12
updated: 2026-09-29
---

# Sales

The sales module owns the counter sale: the `Sale` aggregate with its priced
lines, the payments recorded at completion, and the single transition that turns
a draft into a completed sale with its stock and cash effects. It is a Core
Business domain: it knows about catalog items, money and stock, and it knows
nothing about pets, clinical records or fiscal documents.

Implemented by [[POS-001]] (draft and pricing), [[POS-002]] (the cash foundation
it consumes) and [[POS-003]] (completion). The staff surface lives in
[[POS-004]]; a sale is distinct from an invoice, which is EPIC-14.

## Owned tables

| Table                | Purpose                                                                                                                                                                                                            |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `sale`               | The tenant-scoped header: `currency`, `status` (`DRAFT` / `COMPLETED` / `CANCELLED`), optional `customer_id`. There is deliberately **no** `number`, `discount`, `appointment_id`, `patient_id` or `total` column. |
| `sale_line`          | One priced line per catalog item: the frozen `rate_code`, `unit_price`, `quantity` and the derived `line_total`, `taxable_base` and `tax_amount`.                                                                  |
| `payment`            | One row per payment of a completed sale: its PRD §19 `method` and its `amount`. No tender, change, refund or credit column exists.                                                                                 |
| `idempotency_record` | The tenant-scoped replay guard: `operation`, `key`, a 64-character request `fingerprint` and the `result_sale_id` it resolved to.                                                                                  |

Every table carries the tenant composite ownership key `(tenant_id, id)` and a
`RESTRICT` reference to its tenant, so a cross-tenant UUID is one
byte-equivalent `404` rather than a distinguishable error.

## Money and tax

Prices are **tax-included** ([[DEC-021]]). Completion derives each line from its
frozen inputs:

```text
lineTotal   = round_half_up(unitPrice × quantity)      at the currency minor unit
taxableBase = round_half_up(lineTotal ÷ (1 + rate/100)) at the currency minor unit
taxAmount   = lineTotal − taxableBase
```

The subtraction means base plus tax equals the total exactly, with no cent gap.
Money is `NUMERIC(14,2)` and quantities `NUMERIC(10,3)`; the sale total is the
sum of the line totals and there is no stored total column. The minor unit comes
from a single exponent map that currently supports **only `PYG` (0 decimals)**;
an unsupported `sales.defaultCurrency` is a stable `400` rather than a silently
wrong rounding. The currency is read server-side from the `sales`
tenant-settings namespace and is recorded once on the sale.

The reference price on a catalog item is a **suggestion**: the operator override
is the only price adjustment, and there is no discount concept ([[DEC-022]],
[[DEC-028]]). An item whose reference currency differs from the sale currency
cannot join the sale, and no conversion exists anywhere.

## Routes

| Route                      | Permission       | Contract                                                                                      |
| -------------------------- | ---------------- | --------------------------------------------------------------------------------------------- |
| `GET /sales`               | `sales.read`     | The tenant's sales, newest first with an id tiebreaker; optional `status` filter.             |
| `GET /sales/:id`           | `sales.read`     | One sale with its lines; foreign or unknown is the shared `404`.                              |
| `POST /sales`              | `sales.create`   | Create a `DRAFT` with at least one priced line; the currency is resolved server-side (`201`). |
| `PUT /sales/:id`           | `sales.update`   | Replace a `DRAFT`'s authoritative line set, reconciled by `catalog_item_id`.                  |
| `POST /sales/:id/cancel`   | `sales.cancel`   | Cancel a `DRAFT` (`201`); never deletes.                                                      |
| `POST /sales/:id/complete` | `sales.complete` | The atomic completion (`201`), or the prior result on an identical replay (`200`).            |

There is no `PATCH` and no `DELETE` anywhere on the sale or payment surface.

## The completion command

One transaction, in this order, with the `sales` entitlement asserted before the
permission on every route:

1. Lock the sale header (`SELECT … FOR UPDATE`).
2. With an `Idempotency-Key`, look up `idempotency_record` for
   `(tenant, "sale.complete", key)` **after** the lock: the same fingerprint
   returns the prior sale as a replay; a different one is a stable `409`.
3. Re-read and gate on `DRAFT`; any other status that is not an identical replay
   is a stable `409` that persists nothing.
4. Recompute the per-line snapshot and the total in memory.
5. Validate the payments: one or more, each a PRD §19 method with a positive
   amount, summing **exactly** to the total, else `400`.
6. Gate reference state: an inactive catalog item or inactive customer is a
   stable `409`; the item currency is not re-validated because the line was
   already priced.
7. Resolve the cash session when a CASH payment exists: **exactly one** `OPEN`
   session tenant-wide is required. Zero is a `409` naming the absence and more
   than one is a different `409` naming the ambiguity, because the sale carries
   no register reference and attributing cash to the wrong drawer would be worse
   than rejecting ([[DEC-020]]).
8. For each tracking line, in ascending `catalog_item_id`: acquire
   `stockSerializationLockKey(tenantId, catalogItemId)` **before** reading or
   writing the balance, evaluate the fixed `BLOCK` policy against the
   projection, write exactly one signed negative `SALE` `StockMovement` through
   the EPIC-10 ledger, and write the absolute projected balance. A non-tracking
   line writes no movement and gets no stock validation.
9. Write one `cash_movement` of type `SALE` per CASH payment, against the
   resolved session and its register.
10. Freeze the recomputed snapshot onto the lines, insert the payments, perform
    the conditional `WHERE status = 'DRAFT'` status write, insert the
    idempotency record when a key was supplied, and append exactly one
    `sale.completed` audit row carrying field names only.

A fresh completion answers `201` and an identical replay `200`, with the same
body. Rejection paths and their stable shapes: `403 FEATURE_NOT_ENTITLED` (no
`sales` capability), `403 FORBIDDEN` (no permission), `404` (unknown or foreign
sale, item or customer), `409` (non-`DRAFT`, key reused with a different
fingerprint, inactive reference, missing or ambiguous cash session, or a
projection that would go negative), `400` (payment sum mismatch or a malformed
body).

## Invariants

- **A draft is inert.** The draft path writes no stock, cash, payment or fiscal
  state.
- **Completion is the sale's only stock, cash and payment effect**, and it
  happens at most once: the persisted idempotency record and the conditional
  transition together guarantee it.
- **Stock changes only through the ledger**, under the `(tenant, item)` advisory
  lock, with the balance as a transactionally updated projection that never goes
  negative under the fixed `BLOCK` policy ([[TD-016]]).
- **Cash changes only through immutable movements**; a register's expected
  amount is derived.
- **Payments sum exactly to the total**; there is no partial payment state, no
  change and no credit ([[DEC-029]]).
- **A `COMPLETED` sale, its lines and its payments are immutable**
  ([[DEC-023]]). A correction is a future compensating operation, not an edit;
  the sale reversal and payment refund commands are deferred ([[TD-018]]) and a
  `BEFORE DELETE` / `BEFORE UPDATE` trigger keeps a confirmed payment readable
  and unchangeable.
- **History is preserved**: a `DRAFT` line set may be reconciled, and a
  confirmed sale is never hard-deleted.

## Does Not Own

- **Cash registers, sessions and the session-open command** — the [[Cash]]
  module and [[POS-002]]. Sales consumes the `OPEN` session.
- **Session close, the expected/counted difference, the six remaining cash
  movement kinds, cash reversals and the cash UI** — EPIC-13.
- **Sale reversal and payment refund** — [[DEC-023]] defers them; [[TD-018]]
  tracks the gap, and the reserved `POST /sales/:id/cancel` on a completed sale
  and `POST /payments/:id/refund` are **not** implemented.
- **Invoices, invoice numbering and billing** — EPIC-14, which consumes the
  frozen line snapshot instead of recomputing from the catalog.
- **Fiscal documents, providers and cancellation** — EPIC-15 and EPIC-16. This
  module makes no external call.
- **Item codes, barcodes and SKU columns** — [[DEC-025]] and [[TD-019]]; the POS
  resolves items by name.
- **Discounts, appointment links and patient links** — [[DEC-028]].
- **A human-readable sale number** — [[DEC-027]]; a sale is identified by its
  UUID.
- **Reports, low-stock thresholds and imports** — EPIC-18 and EPIC-19.
- **A Branch, Warehouse or location dimension** — stock and cash are
  tenant-wide.

## Authorization

Every route requires authentication, the server-side tenant context, a granular
permission re-asserted by the service and the `sales` capability through
`EntitlementsService.has`; the entitlement is asserted first, over reads
included. The keys are `sales.read`, `sales.create`, `sales.update`,
`sales.cancel` and `sales.complete`; all six roles read, and `OWNER`, `ADMIN`
and `CASHIER` write ([[DEC-026]]). Frontend checks are UX only.

## Audit and classification

One co-committed audit row per accepted mutation (`sale.created`,
`sale.updated`, `sale.cancelled`, `sale.completed`) with the actor, the sale id
and `{ schemaVersion, changedFields }` carrying field names only — never a
payment method, an amount or any other value (PRD §27, PRD §41). Reads are never
audited. Amounts, statuses and item identity are INTERNAL; the optional customer
reference carries no personal payload of its own.

## Tests

- `packages/database/src/schema-sales.test.ts` — the enum, the tables, the
  columns and scales, the ownership uniques, the `RESTRICT` foreign keys, the
  CHECKs, the conditional delete triggers and the deliberate absences (no
  number, discount, appointment, patient or total column).
- `apps/api/src/sales/sales.integration.test.ts` — the guard chain, the draft
  lifecycle, the completion transaction, the idempotency mechanisms, the
  reference gates, the `BLOCK` refusal, the strict-body sweeps, the audit shape
  and the inertness of the draft path.
- `apps/api/test/live-pg-isolation.e2e-spec.ts` — the EPIC-12 sale-draft and
  sale-completion blocks: the atomic completion with the projection equal to the
  ledger's signed sum, the CASH path, both session rejections, the replay, the
  concurrent double-completion and the cross-tenant `404`.

## Known limitations

- With no close command until EPIC-13, an `OPEN` cash session stays open, and a
  CASH sale refuses while more than one session is open.
- Sale reversal and refund do not exist ([[TD-018]]); a mis-keyed completed sale
  cannot be corrected yet.
- Idempotency rows are never purged until an approved retention policy exists
  ([[TD-020]]).
- The serialization protocol is a convention rather than a database-enforced
  guarantee ([[TD-016]]).
