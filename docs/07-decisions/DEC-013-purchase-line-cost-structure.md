---
id: DEC-013
type: decision
title:
  Purchase line cost and tax structure (EPIC-11)
status: accepted
date: 2026-09-26
related_epics:
  - "EPIC-11"
related_stories:
  - "PUR-001"
  - "PUR-002"
prd_change_required: false
---

# DEC-013 — Purchase line cost and tax structure (EPIC-11)

## Context

PRD §17 defines the purchase states and the receiving steps but defines **no
price, no line cost, no computed line total, no purchase total and no tax
arithmetic**. [[PUR-001 Purchase draft]] records the cost/tax question as open
and forbids inventing a column, and the [[EPIC-11]] epic keeps tax arithmetic out
of its scope.

Verified current state in this repository (2026-09-26):

- No purchase model or line model exists; nothing consumes a purchase amount.
- The inventory ledger is **quantity-only**: `StockMovement.quantity` and
  `StockBalance.quantity` are signed `Decimal(10, 3)` quantities with a
  non-negative CHECK on the projection, and the schema comment states there is
  "no arithmetic beyond the quantity CHECKs" (`schema.prisma`, movement/projection
  doc comments). There is no inventory valuation.
- A **precedent for an informational, non-authoritative amount exists**:
  [[DEC-010]] accepts an optional catalog reference price that is explicitly not
  a sale, invoice, cash or fiscal value, and `CatalogItem.referencePriceAmount`
  is a nullable `Decimal(14, 2)` with no arithmetic derived from it
  (`schema.prisma:1274`).
- A **precedent for storing a reference to seeded tax data exists**: every
  `CatalogItem` carries a NOT NULL `taxRateId` to the global seeded
  `EXEMPT` / `IVA_5` / `IVA_10` rates (`schema.prisma:1268`), and `TaxRate.rate`
  is `Decimal(5, 2)` with the explicit statement that it "defines no arithmetic"
  (`schema.prisma:1239`).
- Tax totals and invoice arithmetic belong to [[EPIC-14]] and fiscal emission to
  [[EPIC-15]], neither of which is implementation scope for EPIC-11.

## Question

Does a purchase line carry a unit cost, a tax rate, a computed total or nothing
at all, given that no consumer of a purchase amount exists and no valuation or
tax arithmetic is approved?

## Options

### Option A — One optional informational unit cost, no tax field (recommended)

Each line MAY carry one unit cost as `Decimal(14, 2)`, validated as an exact
decimal string, **informational only**: no tax rate, no computed line total, no
purchase total, no tax arithmetic and no inventory valuation. It mirrors
[[DEC-010]]'s framing of the catalog reference price as a value that is not a
sale, invoice, cash or fiscal amount.

Benefits: it records what a line actually cost without asserting an arithmetic
the PRD has not approved, reuses the catalog's `Decimal(14, 2)` scale
(`schema.prisma:1274`) and its exact-decimal-string validation, and stays
compatible with a later valuation or billing slice that reads the value instead
of re-deriving it.

Costs: nothing consumes the cost yet, because the ledger is quantity-only with no
valuation, so the column is speculative surface today; tax is deliberately not
represented here and belongs to [[EPIC-14]] and [[EPIC-15]]. A future valuation
slice may need to decide whether the stored cost is authoritative or only a
capture-time reference, which is exactly the boundary [[DEC-010]] leaves open for
the catalog price.

### Option B — Unit cost plus a per-line tax-rate reference

Store the unit cost and a `taxRateId` reference to the global seeded rate list,
mirroring the catalog's store-a-reference precedent (`schema.prisma:1268`), and
compute nothing.

Benefits: the tax identity of a line would be captured at purchase time, so a
later invoice/valuation slice would not have to infer it.

Costs: it imports a catalog tax concept into a domain with no tax consumer, and a
stored rate reference whose arithmetic is explicitly undefined invites a reader
to assume a total that nothing computes. It is more surface than the information
requires today.

### Option C — No monetary fields at all

Quantity-only lines; cost arrives with the first real consumer (inventory
valuation or Billing).

Benefits: it is the honest minimal position — no speculative column, no
undefined arithmetic, nothing to migrate away from.

Costs: a received purchase records no cost at all, so the first slice that needs
a purchase price must add the field and backfill or accept historical gaps.

## Recommendation

Option A. It is the smallest addition that captures the one number a purchase
realistically exists to record, it borrows an already-accepted informational-value
framing ([[DEC-010]]) and an already-shipped decimal scale (`schema.prisma:1274`)
instead of inventing either, and it keeps tax out of a domain that owns none.
Option B is rejected because a stored rate with no arithmetic is a false
precision, and Option C is the honest minimal alternative if the maintainer
prefers to carry no speculative column at all.

## Impact

### Product

Staff can record what a purchase line cost without that number becoming an
inventory valuation, an invoice total or a fiscal value. The purchase surface
shows a unit cost and never a tax-inclusive or tax-exclusive total.

### Architecture

No new runtime, datastore, queue, dependency or API protocol. The cost is a
nullable value on the tenant-scoped line aggregate; no valuation service, no
arithmetic module and no tax engine is introduced. The line stays a tenant-scoped
private model subject to isolation tests.

### Database/API

One nullable `Decimal(14, 2)` column on the purchase line, validated as an exact
decimal string at the boundary (floats are never accepted). No total column, no
tax column under Option A, and no derived value is stored. A line without a cost
is a valid state.

### Delivery

[[PUR-001 Purchase draft]] owns the column, its DTO and its validation;
[[PUR-002 Purchase receiving]] writes no amount to the ledger. Any later slice
that makes the cost authoritative is a new decision, not an EPIC-11 follow-up.

## Decision

Accepted on 2026-09-26 by the maintainer. Option A is the decision: each line MAY
carry one unit cost as `Decimal(14, 2)`, validated as an exact decimal string, and
that cost is **informational only** — no tax rate, no computed line total, no
purchase total, no tax arithmetic and no inventory valuation is derived from it,
mirroring [[DEC-010]]'s framing of the catalog reference price as a value that is
not a sale, invoice, cash or fiscal amount.

The other options stay recorded above as the alternatives that were considered;
acceptance selects Option A only.

[[PUR-001 Purchase draft]] owns the implementation slice — the column, its DTO
and its validation — while [[PUR-002 Purchase receiving]] writes no amount to the
ledger; any later slice that makes the cost authoritative is a new decision, not
an EPIC-11 follow-up.

## PRD Update

No PRD change is required. PRD §17 defines no purchase price or tax total, and
this record adds an informational field without extending product scope; the
engineering rules forbid editing the PRD to normalize an implementation detail.
No PRD edit is proposed here.
