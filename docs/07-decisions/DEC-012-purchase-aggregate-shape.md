---
id: DEC-012
type: decision
title:
  Purchase aggregate shape and the draft-versus-receive validation gate
  (EPIC-11)
status: accepted
date: 2026-09-26
related_epics:
  - "EPIC-11"
related_stories:
  - "PUR-001"
  - "PUR-002"
prd_change_required: false
---

# DEC-012 — Purchase aggregate shape and the draft-versus-receive validation gate (EPIC-11)

## Context

PRD §17 pins the purchase states `DRAFT`, `RECEIVED` and `CANCELLED` and the
atomic receiving steps, but it defines **no aggregate shape**: it does not say
whether `supplierId` is required, whether a saved draft must carry at least one
line, whether a line quantity must be strictly positive, or whether catalog-item
state is checked when a draft is saved. [[PUR-001 Purchase draft]] records these
as open questions and forbids inventing an answer.

Verified current state in this repository (2026-09-26):

- No purchase model exists in `packages/database/prisma/schema.prisma`, and no
  `apps/api/src/purchases/` module exists.
- The ledger's quantity discipline is fixed: `StockMovement.quantity` and
  `StockBalance.quantity` are `Decimal(10, 3)` and signed (`schema.prisma:1354`,
  `schema.prisma:1392`), and the movement CHECK rejects a zero quantity.
- The catalog's decimal discipline is fixed: `CatalogItem.referencePriceAmount`
  is `Decimal(14, 2)` and exact decimal strings are validated at the boundary
  (no floats).
- A **tenant-reference precedent exists**: a catalog item is resolved through a
  tenant-safe repository and a cross-tenant or unknown id collapses to the same
  `404 NOT_FOUND`. Purchases reference both a supplier and catalog items, so
  both are tenant-resolved references.
- A **command/state precedent exists**: inventory's adjustment path rejects a
  deactivated item and an item whose `tracksStock` is false with a stable `409`
  `CONFLICT` (`apps/api/src/inventory/inventory.service.ts:135-139`), so item
  state is a receive-time fact about the catalog, not a property of a draft.

## Question

What must a purchase aggregate contain to be saved as a draft and to be
received, and at which of those two moments is catalog-item state checked?

## Options

### Option A — Required supplier, at least one positive line, item state gated at receive (recommended)

`supplierId` is required. A saved draft has at least one line. Each line
quantity is strictly positive and validated as an exact `Decimal(10, 3)` decimal
**string** at the boundary; a float is never accepted. Each line resolves one
in-tenant catalog item, and a duplicate `catalogItemId` within the same purchase
is rejected. Item `isActive` / `tracksStock` state is **not** checked when the
draft is saved — a draft is inert and changes no stock — and is checked at
receive (see [[DEC-014]]).

Benefits: duplicate-line rejection keeps receiving deterministic (one movement
per line, no ambiguity about which quantity wins), the strict positive quantity
means a saved line always means something, and the split gate keeps an inert
draft from failing on catalog state that can still change before receiving.

Costs: the draft can be saved against an item that later turns out to be
untracked or inactive, so the rejection surfaces at receive instead of at save —
a deliberate deferral, not an oversight.

### Option B — Optional supplier and empty drafts (draft as scratch pad)

`supplierId` is optional and a draft may be saved with zero lines.

Benefits: staff can begin a purchase before knowing the supplier or the items,
which is convenient for data capture.

Costs: an empty, supplier-less draft cannot be received, so the aggregate admits
states that are guaranteed to fail the only command that gives them meaning, and
the draft's validity becomes a runtime question the receiving command must
reject line by line.

### Option C — Required supplier and catalog-item state checked at draft save too

Same shape as A, but `isActive` / `tracksStock` are validated when the draft is
saved as well.

Rejected as the recommended option because it makes an **inert** draft fail on
state that can still change before receive: an item deactivated after the draft
was saved would leave a previously valid draft permanently unreceivable with no
path but cancellation. It is a legitimate defense-in-depth alternative if the
maintainer prefers earlier feedback, and it does not change the receive-time
gate that A and [[DEC-014]] require.

## Recommendation

Option A. It fixes the smallest aggregate that PRD §17's lifecycle can actually
receive, it reuses the ledger's exact-decimal discipline (`schema.prisma:1354`)
instead of inventing one, and the pre-receive duplicate rejection is what makes
"one movement per line" a property rather than an assumption. Option B is
rejected because it admits states that cannot be received, and Option C because
gating an inert draft on mutable catalog state creates drafts that nothing can
rescue. The draft-versus-receive gate split chosen here is the input [[DEC-014]]
consumes when it defines the receive-time validation.

## Impact

### Product

A draft always names a supplier and at least one item, so the staff surface
never shows a purchasable document that cannot exist. Catalog state is reported
when it matters — at receiving — rather than blocking work on a document that
changes nothing.

### Architecture

No new runtime, datastore, queue, dependency or API protocol. `Purchase` and
`PurchaseLine` follow the tenant-safe aggregate shape of the catalog; receiving
consumes them through the same ledger seam that [[PUR-002 Purchase receiving]]
owns. Tenant-isolation tests are required for both new private tables.

### Database/API

`purchase_status` is pinned to `DRAFT` / `RECEIVED` / `CANCELLED` (PRD §17). A
line quantity column uses the ledger's `DECIMAL(10, 3)`. A duplicate
`catalogItemId` is rejected by the service inside the transaction, and both the
supplier and every catalog item are resolved by the tenant-safe repository so a
foreign or unknown reference yields the shared `404`. Strict allowlisted DTOs
reject unknown keys; `tenantId` is never read from body, query or route.

### Delivery

[[PUR-001 Purchase draft]] owns the models, the enum, the draft
create/edit/cancel routes and their schema gate; [[PUR-002 Purchase receiving]]
owns the receive-time item gate and the ledger transaction. No numbering, cost
or tax column is decided here.

## Decision

Accepted on 2026-09-26 by the maintainer. Option A is the decision: `supplierId`
is required; a saved draft has at least one line; each line quantity is strictly
positive and validated as an exact `Decimal(10, 3)` decimal **string** at the
boundary, and a float is never accepted; each line resolves one in-tenant
catalog item, and a duplicate `catalogItemId` within the same purchase is
rejected; and item `isActive` / `tracksStock` state is **not** checked when the
draft is saved — a draft is inert and changes no stock — and is checked at
receive ([[DEC-014]]).

The other options stay recorded above as the alternatives that were considered;
acceptance selects Option A only.

[[PUR-001 Purchase draft]] owns the implementation slice — the models, the enum,
the draft create/edit/cancel routes and their schema gate — while
[[PUR-002 Purchase receiving]] owns the receive-time item gate and the ledger
transaction.

## PRD Update

No PRD change is required. PRD §17 already fixes the three purchase states and
requires receiving to validate the draft; this record supplies the aggregate
shape that PRD §17 leaves undefined and does not extend approved scope. The
engineering rules forbid editing the PRD to normalize an implementation detail,
so no PRD edit is proposed here.
