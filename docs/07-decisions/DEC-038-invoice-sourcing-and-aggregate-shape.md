---
id: DEC-038
type: decision
title: Invoice sourcing and aggregate shape (EPIC-14)
status: proposed
date: 2026-10-01
related_epics:
  - "EPIC-14"
related_decisions:
  - "DEC-021"
  - "DEC-022"
  - "DEC-027"
  - "DEC-028"
related_stories:
  - "BILL-001"
  - "BILL-002"
prd_change_required: false
---

# DEC-038 — Invoice sourcing and aggregate shape (EPIC-14)

## Context

PRD §21 defines the Billing aggregate at a high level: invoice states `DRAFT`,
`CONFIRMED` and `CANCELLED`; items that are "immutable snapshots of description,
quantity, unit price, tax and totals"; numbering by a transactional sequence;
and the rule that "Invoice is distinct from fiscal status". PRD §18 states "Sale
is separate from Invoice" and PRD §19 states "Invoice and Payment are separate
concepts". Nothing in the PRD says where an invoice's line data comes from.

Verified current state in this repository (2026-10-01):

- No `Invoice`, `InvoiceLine`, `InvoiceStatus` or `FiscalDocument` model and no
  invoice-related enum exist in `packages/database/prisma/schema.prisma`; the
  word "invoice" appears only in comments.
- `Sale` (`schema.prisma:1705`) carries a server-resolved `currency`
  (`VarChar(3)`, from the typed `sales.defaultCurrency` setting, [[DEC-022]]), a
  nullable `customerId` ([[DEC-028]]: a walk-in counter sale needs none) and
  `SaleStatus` with `DRAFT / COMPLETED / CANCELLED`.
- `SaleLine` (`schema.prisma:1766`) is documented as "the immutable money record
  ... the frozen snapshot a future invoice consumes" and carries `rateCode`
  (`VarChar(20)`), `unitPrice` (`Decimal(14,2)`), `quantity` (`Decimal(10,3)`),
  `lineTotal`, `taxableBase` and `taxAmount` (all `Decimal(14,2)`), which
  [[DEC-021]] fixes as the half-up per-line arithmetic at the currency minor
  unit.
- [[DEC-027]] decided that a sale carries no human-readable number and that
  "EPIC-14's Invoice owns any transactional sequence".
- The typed `sales` settings namespace already declares
  `requireCustomerForInvoice` (default `false`) and no code consumes it
  (`apps/api/src/settings/registry.ts`).
- `apps/api/src/sales/sales.pricing.ts` holds the only sale/invoice-grade money
  arithmetic in the repository; Billing owns no pricing code.

## Question

What is the invoice aggregate's shape, and where do its immutable line snapshots
come from — always from a completed sale, or also standalone?

## Options

### Option A — One invoice per completed sale (recommended)

`Invoice` is a tenant-scoped aggregate with `saleId` NOT NULL and `UNIQUE`, so
an invoice always originates in exactly one `COMPLETED` sale and a sale can
produce at most one invoice. `InvoiceLine` rows are copied verbatim from that
sale's frozen `SaleLine` snapshot at creation time. The invoice inherits the
sale's `currency` and `customerId` (nullable, following [[DEC-028]]), and
`requireCustomerForInvoice` gates invoice creation for a sale without a
customer. The invoice is immutable from creation at every status: a `DRAFT` may
only be confirmed or cancelled, never edited, so there is no draft-editing
route, no `billing.update` permission and no way for a draft to drift from the
sale snapshot it copied. Cancelling a draft consumes no number.

Benefits: one money arithmetic only (Billing performs none and reuses the frozen
snapshot), no second pricing path, no client-supplied money amounts, a natural
`UNIQUE` idempotency anchor per sale, and it matches the PRD §36 journey and
[[DEC-027]]'s assignment of numbering to the invoice.

Costs: a tenant cannot invoice work that never went through a completed sale
(for example a service rendered without a POS transaction). That limitation is
real and must be recorded as a limitation rather than hidden. Draft editing is
also unavailable, so fixing a wrong draft means cancelling it and creating a new
invoice from a new sale.

### Option B — Optional sale link plus standalone invoices

`Invoice.saleId` is nullable; an invoice built from a sale copies the frozen
snapshot, and a standalone invoice accepts caller-supplied lines.

Benefits: covers invoicing without a completed sale.

Costs: Billing would need its own trusted money arithmetic (or must import
`apps/api/src/sales/sales.pricing.ts` across a domain boundary), which either
duplicates the [[DEC-021]] rounding rules or couples Billing to a Sales-internal
module; and a standalone invoice needs its own customer requirement, currency
resolution and totals validation.

### Option C — Standalone invoices only

No sale link at all; the invoice is an independent document.

Rejected: it discards the frozen `SaleLine` snapshot the whole EPIC-12 schema
comment reserves for this epic, and it forces the money arithmetic problem of
Option B immediately.

## Recommendation

Option A. It is the smallest slice that satisfies PRD §21 without inventing a
second pricing authority, and it is the only option under which Billing never
computes money, never trusts a caller-computed amount and never duplicates the
[[DEC-021]] rounding rules. Option B is the honest extension path if a tenant
needs to invoice work with no completed sale; that is a product decision the
maintainer should accept explicitly, not a detail to be discovered during
implementation.

## Impact

### Product

Every invoice is traceable to the sale it bills, which keeps the audit story
simple. Invoicing work outside a completed sale is not possible in this epic and
must be requested as new scope.

### Architecture

No new runtime, dependency, queue or API protocol. Billing is a Core domain that
reads the Sales aggregate's frozen snapshot; it does not import a Fiscal
provider (see [[DEC-042]]) and does not import Veterinary code.

### Database/API

`Invoice` and `InvoiceLine` are new tenant-scoped models with composite
`(tenant_id, id)` ownership keys, a composite `(tenant_id, sale_id)` FK to
`sale`, and a `UNIQUE (tenant_id, sale_id)` so one sale yields at most one
invoice. The invoice reuses the sale's `currency` and `customer_id`. Errors are
stable domain codes and foreign identifiers stay byte-equivalent `404`s.

### Delivery

BILL-001 owns the models and the constraints; BILL-003 owns invoice creation
from a completed sale, including the `requireCustomerForInvoice` gate and the
verbatim snapshot copy.

## Decision

_Pending. Proposed to the maintainer on 2026-10-01; Option A is recommended._

## PRD Update

No PRD change is required. PRD §21 does not define the invoice's source, so
choosing "always from a completed sale" is an implementation choice inside the
approved scope. If the maintainer prefers Option B, the product scope gains
standalone invoicing and the change should be recorded here as an accepted
decision before implementation, not as a PRD edit.
