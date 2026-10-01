---
id: TD-025
type: tech-debt
title: Sale lines record no order, so the invoice snapshot order is arbitrary
status: open
severity: low
related_epics:
  - EPIC-14
related_stories:
  - BILL-002
  - BILL-003
created: 2026-10-01
updated: 2026-10-01
---

# TD-025 — Sale lines record no order, so the invoice snapshot order is arbitrary

## Context

PRD §21 requires an invoice to carry immutable snapshot items, and [[DEC-038]]
fixes their source: the values are copied verbatim from the sale's frozen
`SaleLine` rows. What the PRD does not fix — and what the sale model does not
record — is the **order** of those items.

Verified current state in this repository (2026-10-01):

- `model SaleLine` (`packages/database/prisma/schema.prisma`) has no `position`,
  sequence or index column. Its columns are the identity and tenancy keys, the
  `catalogItemId`, the frozen `rateCode`/`unitPrice`/`quantity`/`lineTotal`/
  `taxableBase`/`taxAmount` and the timestamps. The only uniqueness is
  `(tenant_id, sale_id, catalog_item_id)`, which makes a catalog item appear at
  most once per sale but says nothing about order.
- `SaleRepository.findById` declares no `orderBy`, so the relation read is
  unordered, and `createdAt` is identical for every line written in one
  `CompleteSale` transaction, so it cannot act as a sequence either.
- `BILL-002` therefore builds the invoice lines in ascending `catalogItemId`
  order before assigning `invoice_line.position`. The document is
  **deterministic** — the same sale always produces the same layout, which is
  what a legal document needs — but the order is **arbitrary**: it does not
  reflect the order the operator entered the lines in.
- The RDD native review of that slice flagged exactly this as
  `R3-ORDERING-TIEBREAK` (WARNING, `billing.service.ts:217-219`), and
  [[BILL-002]] records it as a known limitation.
- `invoice_line.position` exists and is
  `UNIQUE (tenant_id, invoice_id, position)`, so the receiving side is already
  able to store a faithful order; only the source of that order is missing.

## Debt

The invoice, a document whose layout a human reads and prints, orders its lines
by a UUID byproduct rather than by the order the sale recorded. Nothing is
incorrect — every amount is verbatim and the layout is stable — but the document
is less faithful than the snapshot architecture intends, and it is less faithful
for a reason that lives in a different table.

## Why It Is Safe to Defer

- No money, tax or quantity value is affected: the copy is verbatim and the
  totals are projections of those same values, so the document's content is
  correct whatever the order is.
- The order is deterministic, so nothing downstream can flap: the same sale
  always yields the same invoice layout, and `invoice_line.position` is unique
  per invoice.
- No route renders or prints an invoice yet: [[BILL-004]] owns the staff surface
  and [[EPIC-15]]/[[EPIC-16]] own the fiscal document.
- Every current acceptance criterion of [[BILL-002]] holds: the criteria require
  the values to be copied verbatim, not the order to be preserved.

## Risk

- A customer-facing or fiscal document may later be expected to list items in
  the order they were sold. If that expectation appears after invoices exist,
  the fix needs a `sale_line` order column plus a backfill rule for existing
  sales — and existing invoices keep their arbitrary order unless they are
  rebuilt.
- The longer it is deferred, the more sales exist without an order to record, so
  the backfill decision gets harder and eventually becomes "no order is
  available for historical sales".

## Proposed Resolution

Add an explicit order to the sale itself, in the slice that can own a migration
(the same corrective slice [[TD-024]] needs):

1. Add `sale_line.position` (positive integer,
   `UNIQUE (tenant_id, sale_id, position)`) and have `CompleteSale` assign it
   from the request's line order.
2. Have `SaleRepository.findById` order its lines by `position`.
3. Have Billing copy that order instead of sorting by `catalogItemId`, and
   remove the tiebreak comment that explains the current rule.
4. Decide the backfill for sales created before the column existed, and record
   that existing invoices are not rebuilt.

## Trigger / Target

Address it with [[TD-024]] in the corrective slice for the BILL-001/BILL-002
data shape, or in [[BILL-003]] if that slice takes a migration; or earlier if a
document-layout requirement appears. Owner: the EPIC-14 implementation slices.

## Verification After Resolution

- [ ] `sale_line.position` exists with a per-sale uniqueness constraint.
- [ ] `CompleteSale` writes the position from the caller's line order, and the
      sales integration suite proves the order round-trips.
- [ ] Billing copies the recorded order and no longer sorts by `catalogItemId`.
- [ ] A regression test proves two sales with the same items in different orders
      produce invoices with different line orders.
- [ ] The backfill rule for pre-existing sales is recorded, and the limitation
      is removed from the [[BILL-002]] record.
- [ ] This record is `resolved` or superseded by the change that closed it.
