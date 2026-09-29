---
id: DEC-021
type: decision
title: Sale tax arithmetic, amount precision and the per-line snapshot (EPIC-12)
status: accepted
date: 2026-09-27
related_epics:
  - "EPIC-12"
related_decisions:
  - "DEC-010"
related_stories:
  - "POS-001"
  - "POS-003"
prd_change_required: false
---

# DEC-021 — Sale tax arithmetic, amount precision and the per-line snapshot (EPIC-12)

## Context

PRD §15 fixes the Paraguay rate seed `EXEMPT 0%` / `IVA_5 5%` / `IVA_10 10%` as
data/configuration rather than hardcoded invoice logic, and says "authorized
users select the applicable rate". PRD §21 says invoice items are immutable
snapshots of "description, quantity, unit price, tax and totals". The PRD does
not state whether a price is tax-included, how tax is computed or rounded, or
which decimal scale money and quantities carry. [[DEC-010]] left "Is POS pricing
tax-included or tax-excluded?" open and stated that it "needs its own decision,
with the arithmetic, per-currency scale and rounding rule stated explicitly".
POS-001 and POS-003 record the question as open.

Verified current state in this repository (2026-09-27):

- The global rate row is `TAX_RATE_SEEDS` with the exact `Decimal(5, 2)`
  literals `0.00`, `5.00` and `10.00`
  (`packages/database/src/reference-seed.ts`), and `CatalogItem.taxRateId` is
  `NOT NULL` with a `RESTRICT` reference to that global row
  (`packages/database/prisma/schema.prisma`), so every item already carries one
  seeded rate.
- The catalog reference price is
  `referencePriceAmount Decimal? @db.Decimal(14, 2)` plus
  `referencePriceCurrency String? @db.VarChar(3)` (`schema.prisma:1277-1278`),
  and [[DEC-010]] fixes the scale at `Decimal(14, 2)` for every currency and
  derives no tax interpretation from that value.
- The inventory ledger's quantity discipline is `Decimal(10, 3)`
  (`StockMovement.quantity`), and `docs/05-modules/Catalog-Taxes.md` records
  that the catalog stores a rate reference and never computes tax.
- No sale, sale line, tax computation, rounding helper or money scale exists.

## Question

Are sale line prices tax-included or tax-excluded, how is each line's tax
computed and rounded, and what immutable precision does a sale line carry?

## Options

### Option A — Tax-included prices, per-line tax computation and an immutable snapshot (recommended)

The price charged on a sale line is tax-included. The sale owns the tax
interpretation: [[DEC-010]]'s catalog reference price stays a tax-neutral
suggestion with no embedded semantics, and this record does not change it.
CompleteSale computes each line's `taxableBase` and `taxAmount` from the item's
required seeded rate (`EXEMPT`, `IVA_5`, `IVA_10`) and freezes them, together
with `rateCode`, `unitPrice`, `quantity` and `lineTotal`, as an immutable
snapshot on the sale line. Rounding is half-up per line at the currency's minor
unit, and PYG has zero decimals. The sale total is the sum of the line totals
and must equal the sum of the payments exactly. Quantities use the ledger's
`Decimal(10, 3)` discipline and money uses `Decimal(14, 2)`, matching the
catalog reference-price scale. The snapshot is what a future Invoice (EPIC-14)
consumes instead of recomputing from the catalog, so a later rate change can
never rewrite a past sale.

Benefits: it matches the Paraguay consumer-price convention that the displayed
price is what the customer pays, it makes the sale the authoritative money
record rather than the catalog, and it satisfies PRD §21's immutable-snapshot
intent before the invoice exists.

Costs: it introduces real rounding arithmetic and a stored per-line tax split
that must be pinned by tests, and it fixes the per-line rounding rule against
the currency's minor unit, which a future multi-currency epic would extend
rather than change.

### Option B — Tax-excluded prices with tax added at the sale

The catalog and POS price is the net base and the sale adds the tax on top.

Benefits: the stored price is a clean base, which simplifies some accounting
views.

Costs: it contradicts the jurisdiction convention for a consumer price under
`locale: es-PY`, it makes the price the operator enters differ from what the
customer pays, and it would need its own PRD clarification just as much as
Option A. It buys no requirement that Option A does not already satisfy.

### Option C — No snapshot; recompute the tax from the catalog when an invoice is issued

Store only the totals on the sale and re-derive the tax split later.

Rejected: PRD §21 requires invoice items to be immutable snapshots, a later rate
change would silently rewrite a past sale, and recomputing from current
configuration is exactly the "hardcoded derived arithmetic" pattern the PRD
forbids. It also cannot answer what a sale charged if the catalog changed.

## Recommendation

Option A. It is the smallest reading that makes the displayed price equal the
charged price, it captures PRD §21's immutable-snapshot intent at the moment the
sale is confirmed, and it lets the catalog evolve without rewriting history.
Option C is rejected on correctness and Option B is rejected because it changes
the customer-visible meaning of the price without adding a capability. The
rounding and scale rules are part of the decision, not implementation detail,
because two readers would otherwise disagree about PYG's zero decimals.

## Impact

### Product

A customer pays the price shown, and each sale records the tax base, the tax
amount and the rate code it used, so a later rate change never changes what a
past sale charged. Reports and a future invoice read the frozen snapshot rather
than re-deriving it.

### Architecture

No new runtime, datastore, queue, dependency or API protocol. The arithmetic
lives in the sales application layer beside the ledger seam it already depends
on; the global rate rows stay read-only reference data and are never mutated by
a sale.

### Database/API

The sale line stores `rateCode`, `unitPrice`, `quantity`, `lineTotal`,
`taxableBase` and `taxAmount` with explicit `Decimal` precision, and
CompleteSale validates that the line totals sum to the sale total and that the
payments sum to the same total. Money is `Decimal(14, 2)` and quantities
`Decimal(10, 3)`; unknown or missing rate codes are rejected before any write.

### Delivery

POS-001 owns the line snapshot columns and the tax computation with its per-line
rounding; POS-003 owns the CompleteSale transaction that freezes the snapshot
and validates the totals. EPIC-14's Invoice consumes the snapshot and owns any
document-level arithmetic.

## Decision

Accepted on 2026-09-27 by the maintainer. Option A is the decision: the price
charged on a sale line is tax-included, with the sale owning the tax
interpretation while [[DEC-010]]'s catalog reference price stays a tax-neutral
suggestion; CompleteSale computes each line's `taxableBase` and `taxAmount` from
the item's required seeded rate (`EXEMPT`, `IVA_5`, `IVA_10`) and freezes them,
with `rateCode`, `unitPrice`, `quantity` and `lineTotal`, as an immutable
snapshot on the sale line; rounding is half-up per line at the currency's minor
unit, and PYG has zero decimals; the sale total is the sum of the line totals
and must equal the sum of the payments exactly; quantities use the ledger's
`Decimal(10, 3)` discipline and money uses `Decimal(14, 2)`, matching the
catalog reference-price scale; and the snapshot is what a future Invoice
(EPIC-14) consumes instead of recomputing from the catalog, so a later rate
change never rewrites a past sale.

The other options stay recorded above as what was considered; acceptance selects
Option A only.

POS-001 owns the line snapshot and tax computation, POS-003 owns the
CompleteSale transaction that freezes it, and EPIC-14 consumes the frozen
snapshot.

## PRD Update

No PRD change is required. PRD §15 already establishes the seeded rates as
configuration an authorized user selects and [[DEC-010]] already reserved the
tax-inclusive/exclusive question for a dedicated decision, which this record now
closes; PRD §21 already states the immutable-snapshot principle this record
applies one epic earlier. The decision fixes rounding and precision rules the
PRD leaves to implementation and introduces no product surface the PRD does not
already contemplate, so the engineering rules' prohibition on editing the PRD to
normalize an implementation detail applies and no PRD edit is proposed here.
