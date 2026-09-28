---
id: DEC-028
type: decision
title:
  "Sale scope boundaries: optional customer, no discounts, no clinical links
  (EPIC-12)"
status: accepted
date: 2026-09-27
related_epics:
  - "EPIC-12"
related_decisions:
  - "DEC-022"
related_stories:
  - "POS-001"
  - "POS-004"
prd_change_required: false
---

# DEC-028 — Sale scope boundaries: optional customer, no discounts, no clinical links (EPIC-12)

## Context

The PRD leaves three sale-shape questions open: whether a sale requires a
customer, whether any discount concept exists, and whether a sale links to an
appointment or a patient. PRD §11 defines the customer and PRD §18 the sale but
connects them only implicitly, while the typed `sales` settings namespace
already carries `requireCustomerForInvoice` with a default of `false`
(`apps/api/src/settings/registry.ts:54-74`), which implies a customer is
optional at sale time and may be required at invoice time. [[DEC-022]] makes the
line-level price override the only price adjustment. The tenancy baseline
requires a cross-tenant resource UUID to return one byte-equivalent `404`.
POS-001 and POS-004 record these boundaries.

Verified current state in this repository (2026-09-27):

- `apps/api/src/settings/registry.ts:54-74` defines `requireCustomerForInvoice`
  with default `false` and `defaultCurrency` with default `PYG` in the strict
  `sales` namespace, and the namespace `requiresFeature: "sales"`.
- [[DEC-022]] fixes the operator's line-level unit-price override as the only
  price adjustment on a sale, with no other adjustment concept defined.
- The tenancy baseline resolves a resource only inside the caller's tenant and
  renders a foreign UUID as a byte-equivalent `404`.
- No sale model exists, and PRD §18 defines no discount, no customer
  requirement, no `appointmentId` and no `patientId` on a sale.

## Question

Is a customer required on a sale, does a sale carry any discount, and does a
sale link to an appointment or a patient?

## Options

### Option A — Optional customer, no discount, no clinical links (recommended)

`customerId` is optional on a sale, validated as the same tenant's customer with
a cross-tenant request returning one byte-equivalent `404`, and invoice-time
customer requiredness stays `sales.requireCustomerForInvoice` (default `false`)
for EPIC-14. The line-level price override from [[DEC-022]] is the only price
adjustment and there is no discount concept: no percentage, no amount, no reason
field and no separate permission. The sale has no `appointmentId` and no
`patientId`, so it never touches Scheduling or clinical records.

Benefits: it supports the walk-in counter sale without forcing a customer
record, it keeps the sale strictly inside the sales domain with no cross-domain
coupling to Scheduling or Clinical, and it leaves the configurable invoice-time
customer rule to the epic that owns the invoice.

Costs: a sale cannot be attributed to a patient or an appointment, so a clinical
sale is reconciled by the optional customer rather than by a clinical link, and
an operator with no discount has only the line-price override to adjust a price.

### Option B — Require a customer on every sale

Make `customerId` required, mirroring how EPIC-11 requires a supplier on a
purchase.

Benefits: every sale is attributable to a customer from creation.

Costs: it would make a two-item walk-in sale require a customer record, which
contradicts the shipped `requireCustomerForInvoice: false` default and the POS
counter reality, and it pre-empts EPIC-14's configurable invoice-time rule.

### Option C — Add discount fields and/or appointment and patient links

Add a discount (percentage or amount) with a reason and permission, and an
`appointmentId` and/or `patientId` on the sale.

Costs: a discount adds a second price-adjustment semantic with its own rounding,
audit and permission surface that PRD §18 does not ask for, while [[DEC-022]]'s
line-price override already covers the counter adjustment need; and
appointment/patient links couple the Core sales domain to Scheduling and
Clinical, which the domain-boundary rules keep apart. Both can be added later by
a decision that owns them.

## Recommendation

Option A. The shipped `requireCustomerForInvoice: false` default already
indicates that a customer is optional at sale time, [[DEC-022]] already provides
the single permitted price adjustment, and the domain-boundary rules keep Core
sales out of Scheduling and Clinical. Option B is rejected because it
contradicts the shipped default, and Option C is rejected as new product surface
with no PRD requirement.

## Impact

### Product

A walk-in sale completes with an optional customer, and the price override is
the only way to adjust a line. No discount, no patient link and no appointment
link exist, so nothing about a sale couples the counter to the clinical or
scheduling domains.

### Architecture

No new runtime, datastore, queue, dependency or API protocol, and no
cross-domain import: the sales module references only the customers aggregate
for the optional customer, exactly as the tenancy and domain-boundary rules
require.

### Database/API

`customerId` is a nullable tenant-composite reference validated in-tenant, with
a cross-tenant UUID returning one byte-equivalent `404`. No discount column,
discount permission or adjustment-reason field exists, and no `appointmentId` or
`patientId` column exists. Invoice-time customer requiredness stays read from
`sales.requireCustomerForInvoice`.

### Delivery

POS-001 owns the optional customer reference and the absence of discount and
clinical links; POS-004 owns the POS surface that offers the optional customer
selector and the line-price override. EPIC-14 owns the invoice-time
`requireCustomerForInvoice` behaviour.

## Decision

Accepted on 2026-09-27 by the maintainer. Option A is the decision: `customerId`
is optional on a sale, validated as the same tenant's customer with a
cross-tenant request returning one byte-equivalent `404`, and invoice-time
customer requiredness stays `sales.requireCustomerForInvoice` (default `false`)
for EPIC-14; the line-level price override from [[DEC-022]] is the only price
adjustment and there is no discount concept (no percentage, no amount, no reason
field, no separate permission); and the sale has no `appointmentId` and no
`patientId`, so it never touches Scheduling or clinical records.

The other options stay recorded above as what was considered; acceptance selects
Option A only.

POS-001 owns the aggregate boundary and POS-004 the POS surface, and EPIC-14
owns the invoice-time customer rule.

## PRD Update

No PRD change is required. PRD §18 defines no discount, customer requirement or
clinical link, and the typed `sales` settings already carry
`requireCustomerForInvoice` with a default of `false`, so this record applies
existing intent and withholds capabilities the PRD never promised. It adds no
approved scope, and the engineering rules forbid editing the PRD to normalize an
implementation detail, so no PRD edit is proposed here.
