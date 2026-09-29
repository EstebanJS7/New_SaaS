---
id: DEC-022
type: decision
title: Line pricing, price override and sale currency (EPIC-12)
status: accepted
date: 2026-09-27
related_epics:
  - "EPIC-12"
related_decisions:
  - "DEC-010"
  - "DEC-021"
related_stories:
  - "POS-001"
  - "POS-004"
prd_change_required: false
---

# DEC-022 — Line pricing, price override and sale currency (EPIC-12)

## Context

[[DEC-010]] added an optional per-item reference price as an amount plus an ISO
4217 currency pair with PYG as the offered default, validated as a pair, and
with no exchange rate or conversion anywhere. It explicitly left two questions
open: whether the POS pre-fills a line price from the catalog and whether staff
may override it, and whether the USD secondary currency ever requires
conversion. The `sales` tenant-settings namespace already carries
`defaultCurrency` and `requireCustomerForInvoice`, and tenant identity may never
come from the request body. POS-001 and POS-004 record the pricing and currency
questions as open.

Verified current state in this repository (2026-09-27):

- `packages/database/prisma/schema.prisma:1277-1278` stores
  `referencePriceAmount Decimal? @db.Decimal(14, 2)` and
  `referencePriceCurrency String? @db.VarChar(3)`, and the `tracksStock` comment
  (`schema.prisma:1284-1286`) states no SKU, barcode, category, unit or branch
  column exists.
- `apps/api/src/settings/registry.ts:54-74` defines the strict `sales` namespace
  with `defaultCurrency` (a `/^[A-Z]{3}$/` ISO-4217 code, default `PYG`) and
  `requireCustomerForInvoice` (default `false`), `requiresFeature: "sales"` and
  `requiredPermissionKey: "sales.settings.manage"`.
- [[DEC-010]] validates the amount/currency pair server-side, rejects unknown
  ISO 4217 codes, offers PYG as a default that is never silently coerced, and
  defines no conversion or dual display.
- No sale, line, pricing or currency surface exists yet.

## Question

Where does a sale line's unit price come from, may the operator override it, and
which currency does a sale use when the catalog item carries its own currency?

## Options

### Option A — Reference price as a suggestion, operator override, single sale currency (recommended)

The item's optional `referencePriceAmount`/`referencePriceCurrency` is a
suggestion. The operator may override the unit price for a line, and the applied
price is what the line snapshot records; an item with no reference price can
still be sold with a manually entered price. The sale currency is the tenant's
`sales.defaultCurrency`, read through `TenantSettingsService` and never from the
request body. An item whose `referencePriceCurrency` differs from the sale
currency cannot be added to the sale (stable error), and there is no currency
conversion anywhere. The sale records its currency once.

Benefits: it keeps [[DEC-010]]'s rule that the catalog value is informational,
it lets a mispriced or price-less item still be sold, and it makes the sale's
currency a server-resolved tenant setting rather than client-supplied input.

Costs: it gives the operator a price-changing capability that must be validated
and recorded through the immutable line snapshot, and it rejects a
cross-currency item outright instead of offering a converted price.

### Option B — The catalog reference price is authoritative; no override

A line always takes the item's reference price and the operator cannot change
it.

Benefits: one price source, no override capability to audit, and the catalog
becomes the single place a price is maintained.

Costs: an item with no reference price becomes unsellable, and the stored value
would become the authoritative sale amount, which [[DEC-010]] expressly forbids
for this informational field. It removes a normal POS need for no compensating
benefit.

### Option C — Allow mixed-currency lines and convert at sale time

Permit each line its own currency and convert into the sale currency.

Rejected: [[DEC-010]] defines no exchange rate, rate source or conversion, and
inventing them here would add financial arithmetic, a rate feed and a rounding
surface the PRD does not define. Cross-currency comparison and conversion remain
undefined by [[DEC-010]].

## Recommendation

Option A. It follows [[DEC-010]] exactly: the reference price stays a
suggestion, the sale line is the authoritative money record, and no conversion
is invented. Option B is rejected because it contradicts [[DEC-010]]'s own
boundary, and Option C is rejected because it adds a conversion capability with
no defined rate source. The sale currency is resolved server-side from tenant
settings, which keeps the rule consistent with the tenancy baseline.

## Impact

### Product

A counter sale can override a line price, or sell an item that has no catalog
price, while the recorded amount is the one actually charged. An item quoted in
another currency simply cannot join a sale priced in the tenant currency, so no
silent conversion ever occurs.

### Architecture

No new runtime, datastore, queue, dependency or API protocol. Pricing stays in
the sales application layer; the currency is read through the existing typed
tenant-settings service rather than scattered through the module, and the
catalog remains an advisory read.

### Database/API

The sale carries one currency column resolved from `sales.defaultCurrency`, and
each line snapshot stores the applied `unitPrice` regardless of whether it came
from the catalog or the operator. Adding a cross-currency item is a stable
error; unknown ISO 4217 codes and a mismatched item currency are rejected
server-side before any write.

### Delivery

POS-001 owns the line pricing, the override rule and the currency resolution;
POS-004 owns the POS input surface that offers the reference price as a
pre-fill. EPIC-14 owns any invoice-level currency or conversion decision, and
[[DEC-010]]'s no-conversion boundary still stands.

## Decision

Accepted on 2026-09-27 by the maintainer. Option A is the decision: the item's
optional `referencePriceAmount`/`referencePriceCurrency` is a suggestion; the
operator may override the unit price for a line and the applied price is what
the line snapshot records; an item with no reference price can still be sold
with a manually entered price; the sale currency is the tenant's
`sales.defaultCurrency`, read through `TenantSettingsService` and never from the
request body; an item whose `referencePriceCurrency` differs from the sale
currency cannot be added to the sale (stable error) and there is no currency
conversion anywhere; and the sale records its currency once.

The other options stay recorded above as what was considered; acceptance selects
Option A only.

POS-001 owns the pricing, override and currency resolution, and POS-004 owns the
POS input surface that pre-fills the reference price.

## PRD Update

No PRD change is required. PRD §15 already describes the item reference price as
informational and [[DEC-010]] already fixes it as a suggestion with PYG as the
default and no conversion; PRD §38's typed settings already own the `sales`
namespace's `defaultCurrency`. This record applies those approved boundaries to
sale-line pricing and reads the currency from existing tenant settings, so it
extends no approved scope and the engineering rules' prohibition on editing the
PRD to normalize an implementation detail applies; no PRD edit is proposed here.
