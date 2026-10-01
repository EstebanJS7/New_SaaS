---
id: BILL-002
type: story
title: Invoice creation and read API
epic: EPIC-14
status: planned
priority: high
depends_on:
  - BILL-001
prd_sections:
  - "9"
  - "10"
  - "18"
  - "19"
  - "21"
  - "22"
  - "27"
  - "28"
  - "29"
  - "36"
  - "41"
permissions:
  - billing.read
  - billing.create
branch:
created: 2026-10-01
updated: 2026-10-01
---

# BILL-002 — Invoice creation and read API

## Objective

Deliver the Billing read and creation surface: `POST /invoices` turns exactly
one `COMPLETED` in-tenant sale into one `DRAFT` invoice whose `InvoiceLine` rows
copy the sale's frozen `SaleLine` snapshot verbatim, `GET /invoices` and
`GET /invoices/:id` expose the tenant-scoped reads, and creation is audited. The
API computes no money and accepts no caller-computed amount.

## Context

- PRD §18 states "Sale is separate from Invoice" and PRD §19 states "Invoice and
  Payment are separate concepts", so an invoice is created from a completed sale
  and never carries payment data.
- [[DEC-038]] makes the invoice always originate in one completed sale, inherit
  the sale's `currency` and `customerId`, and copy `sale_line` verbatim, with
  `requireCustomerForInvoice` gating creation.
- The typed `sales` settings namespace already declares
  `requireCustomerForInvoice` (default `false`) and no code consumes it
  (`apps/api/src/settings/registry.ts`), so this Story is the first consumer.
- [[DEC-028]] makes `customerId` nullable on the sale, so an invoice for a
  walk-in sale is only possible while the gate setting is off.
- [[DEC-040]] assigns `billing.read` and `billing.create` to this Story and
  makes the `billing` entitlement mandatory on every Billing route.
- The Billing module does not exist yet: `apps/api/src/` has no `billing/`
  directory, and `apps/api/src/rbac/route-contract.probe.test.ts` pins the route
  inventory and each route's required permission, so a new route and its key
  must land in the same slice.
- [[DEC-038]], [[DEC-040]], [[DEC-042]] and [[DEC-044]] were accepted on
  2026-10-01 by the maintainer and are binding on this Story.

## In Scope

- The new `apps/api/src/billing/` module: contract, service, repository,
  controller, DTO and integration tests.
- `POST /invoices` behind `billing.create` and the `billing` entitlement: create
  one `DRAFT` invoice from exactly one `COMPLETED` in-tenant sale.
- The verbatim `InvoiceLine` copy from the sale's frozen `SaleLine` rows, with
  the invoice inheriting the sale's `currency` and `customerId` ([[DEC-038]]).
- The `requireCustomerForInvoice` gate read through the typed settings service.
- `GET /invoices` with its planned filter and `GET /invoices/:id`, both behind
  `billing.read` and tenant-scoped.
- Stable domain error codes for a sale that is not `COMPLETED`, a sale that
  already has an invoice, and an unknown sale.
- Co-committed audit for accepted creation, with actor, tenant and invoice
  reference, and no audit row for a rejection.
- The route pins in `apps/api/src/rbac/route-contract.probe.test.ts` and the
  live-PostgreSQL isolation and application-path coverage.
- This Story and the epic record.

## Out of Scope

- **The aggregate, the constraints, the triggers and the permission seeds** —
  [[BILL-001]].
- **Confirm, cancel, number allocation and audit of those commands** —
  [[BILL-003]].
- **The staff Billing workspace** — [[BILL-004]].
- **Epic closure and module documentation** — [[BILL-005]].
- **Draft invoice editing and any `billing.update` route** — [[DEC-038]] makes
  the invoice immutable from creation, so a wrong draft is cancelled and
  rebuilt.
- **Fiscal documents, fiscal status, fiscal providers and queued submission** —
  [[EPIC-15]], [[EPIC-16]] and [[DEC-042]].
- **Portal invoices and documents** — deferred, with the route-contract probe
  prohibition intact ([[DEC-044]]).
- **Accounts receivable, credit ledger and invoice payment allocation** —
  [[DEC-044]] and `docs/00-product/SCOPE.md:72`; payments stay on the sale (PRD
  §19).
- **Printed invoice rendering, PDF export and official number formatting** —
  [[DEC-018]], [[DEC-039]] and [[DEC-044]].
- **Invoice reports and dashboards** — [[EPIC-18]].
- **Email or WhatsApp invoice delivery** — [[EPIC-17]].
- **Sale reversal, stock compensation and payment refund** — [[TD-018]].
- **Standalone or manual invoicing with no completed sale** — excluded while
  [[DEC-038]] Option A stands.
- **A schema, migration or seed change.** [[BILL-001]] ships the tables and the
  seeds; this Story consumes them.
- **A PRD edit.** No decision here requires one.

## Acceptance Criteria

- [ ] `POST /invoices` creates a `DRAFT` invoice from exactly one `COMPLETED`
      in-tenant sale behind `billing.create` and the `billing` capability, and
      copies the sale's `SaleLine` snapshot verbatim. Evidence: the integration
      case asserting the copied amounts and the route permission pin.
- [ ] `requireCustomerForInvoice` gates creation when the sale has no customer,
      and the gate reads the typed setting rather than raw JSON. Evidence: the
      integration case toggling the setting and the rejection case.
- [ ] A sale that is not `COMPLETED`, a sale with an existing invoice, and a
      nonexistent sale each fail with their own stable domain code and persist
      nothing. Evidence: the three rejection cases plus the no-residue
      assertion.
- [ ] `GET /invoices` and `GET /invoices/:id` are tenant-scoped behind
      `billing.read`; foreign identifiers are byte-equivalent `404`s. Evidence:
      the tenant-isolation integration and live-PostgreSQL cases.
- [ ] The API never accepts tenant authority from body, query or route.
      Evidence: the tenant-isolation cases and the request-schema review.
- [ ] Creation is audited with actor, tenant and invoice reference, and rejected
      attempts write no audit row. Evidence: the audit assertions of both
      suites.
- [ ] Tenant isolation is enforced when applicable. Evidence: the
      byte-equivalent foreign/unknown invoice and sale `404` cases over real
      HTTP, and the tenant-predicated repository reads.
- [ ] Backend authorization is enforced when applicable. Evidence: the
      deny-by-default route pins for `GET /invoices`, `GET /invoices/:id` and
      `POST /invoices`, plus the permission and `billing` capability sweeps.
- [ ] Required loading/error/empty/success UX exists. Evidence: not applicable
      in this story, owned by [[BILL-004]].
- [ ] Required audit exists. Evidence: exactly one `invoice.created` row
      co-committed with each accepted creation, carrying field NAMES only.
- [ ] Tests required by the Story pass. Evidence: the integration suite, the
      route-contract probe, the live-PostgreSQL block and the repository gates
      are green in the merged work unit.

## Domain Invariants

- **Invoice lines are immutable snapshots.** An `InvoiceLine` copies the sale's
  frozen `SaleLine` values verbatim; Billing performs no money arithmetic and
  trusts no caller-computed amount ([[DEC-038]]).
- **One invoice per completed sale.** `UNIQUE (tenant_id, sale_id)` rejects a
  second invoice for the same sale, and an invoice always originates in exactly
  one completed sale ([[DEC-038]]).
- **Payments stay on the sale.** No payment, cash or receivable record is read
  or written by this Story (PRD §19, [[DEC-044]]).
- **A number is allocated only at confirmation.** Creation writes no number;
  `number` and `series` stay `NULL` while `DRAFT` ([[DEC-039]]).
- **`CANCELLED` is terminal and drafts are never edited.** There is no edit,
  patch or delete route for an invoice at any status ([[DEC-038]], [[DEC-043]]).
- **The invoice is fiscal-free.** Billing imports no Fiscal provider and stores
  no fiscal state ([[DEC-042]]).
- **Tenant identity is server-owned.** No body, query or route value is treated
  as tenant authority, and a cross-tenant or unknown identifier is a
  byte-equivalent `404`.
- **Money and quantities use `Decimal`/NUMERIC**, never a float.

## API

### Added

| Route               | Permission       | Contract                                                                                                                                                                                                                                                                                                                |
| ------------------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /invoices`    | `billing.create` | Create one `DRAFT` invoice (`201`) from exactly one `COMPLETED` in-tenant sale. The body accepts the sale reference and nothing else; the snapshot lines, the currency, the customer and the totals are derived server-side from the sale's frozen rows. The response is an allowlisted invoice DTO with no `tenantId`. |
| `GET /invoices`     | `billing.read`   | List the tenant's invoices with the planned status filter, newest first, under an allowlisted DTO.                                                                                                                                                                                                                      |
| `GET /invoices/:id` | `billing.read`   | Read one in-tenant invoice with its snapshot lines.                                                                                                                                                                                                                                                                     |

Rejections are stable: `400` for an unknown body key or a malformed sale
reference; `403` for a missing permission or a tenant without the `billing`
capability; the shared byte-equivalent `404` for a foreign or unknown invoice or
sale; and `409` for a sale that is not `COMPLETED`, a sale that already has an
invoice, or a sale without a customer while `requireCustomerForInvoice` is on.
No `PATCH`, no `DELETE` and no generic status route exists on the surface.

### Changed

```text
None yet
```

## Database

### Migration

```text
None yet
```

This Story consumes the tables, constraints and triggers [[BILL-001]] ships, and
adds no migration of its own.

### Models/Tables

- None added. Creation writes one `Invoice` row and its `InvoiceLine` children;
  the reads are tenant-predicated queries over those tables.

## UI

- None. [[BILL-004]] owns the staff Billing surface.
- If UI is changed, confirm reusable components use semantic branding tokens
  rather than project-specific literals.

## Implementation Summary

_Not implemented._

## Verification

```text
Not run.
```

## Tests Added

- `apps/api/src/billing/billing.integration.test.ts` (planned) — the creation
  case with the verbatim snapshot copy, the `requireCustomerForInvoice` gate,
  the three rejection cases with their no-residue assertion, the tenant-scoped
  reads, the permission and capability sweeps, the strict body contract and the
  audit shape.
- `apps/api/src/rbac/route-contract.probe.test.ts` (planned update) — the three
  routes pinned in the deny-by-default inventory with their permissions.
- `apps/api/test/live-pg-isolation.e2e-spec.ts` (planned) — the byte-equivalent
  cross-tenant `404`, the applied-schema read of the copied snapshot and the
  second-invoice rejection for the same sale.
- `apps/api/src/settings/` (planned update, if the typed read needs a test) —
  the `requireCustomerForInvoice` consumption.

## Known Limitations

- Nothing is implemented. The Story is `planned` and every criterion is
  unchecked.
- [[DEC-038]], [[DEC-040]], [[DEC-042]] and [[DEC-044]] were accepted on
  2026-10-01 by the maintainer; changing one later needs a new decision rather
  than a reinterpretation during implementation.
- The epic and the decisions do not state whether an inactive customer or an
  inactive catalog item blocks invoice creation. The slice must resolve that
  without extending scope and record the resolution in this Story rather than
  invent a rule here.
- The epic and the decisions do not fix a list pagination shape or a default
  page size for `GET /invoices`; the slice must follow the shipped list
  precedent rather than introduce a new one.
- Draft editing is unavailable ([[DEC-038]]). A wrong draft is cancelled by
  [[BILL-003]] and rebuilt from a new sale; there is no draft update route.
- While [[DEC-038]] Option A stands, a tenant cannot invoice work that has no
  completed sale.
- No fiscal state, no portal invoice read, no printed rendering and no export
  exist in this Story ([[DEC-042]], [[DEC-044]]).
- The epic is silent on invoice search or date-range filtering beyond the
  planned status filter, so no other filter is planned here.

## Technical Debt

- [[TD-018]] stays open. This Story adds no sale reversal, stock compensation,
  payment refund or compensating financial record; nothing here corrects a
  completed sale.
- [[TD-022]] tracks the still-deferred portal invoice and document surface; it
  was created during the EPIC-14 kickoff and is kept current by [[BILL-005]]
  ([[DEC-044]]).
- No other debt is planned. If a slice ships a shortcut it must create a debt
  record rather than hide it.

## Decisions / ADRs

- [[DEC-038]] — invoice sourcing and aggregate shape: created from exactly one
  completed sale, verbatim snapshot copy, inherited currency and customer, and
  the `requireCustomerForInvoice` gate.
- [[DEC-040]] — the `billing.read` and `billing.create` keys, the role matrix
  and the `billing` entitlement gate this Story enforces on every route.
- [[DEC-042]] — fiscal boundary ownership: this Story adds no fiscal column,
  import or call.
- [[DEC-044]] — epic scope boundaries: the portal, receivable, print/export,
  report and notification exclusions this Story must not absorb.
- No ADR is required: the module preserves the tenancy, authorization and API
  conventions of the shipped domains.

## Files / Modules

Planned paths; nothing below exists yet.

- `apps/api/src/billing/`
- `apps/api/src/app.module.ts`
- `apps/api/src/settings/`
- `apps/api/src/rbac/route-contract.probe.test.ts`
- `apps/api/test/live-pg-isolation.e2e-spec.ts`
- `docs/01-roadmap/EPIC-14-Billing.md`

## Completion Notes

_Status must remain non-done until all required gates pass._

This Story stays `planned` while nothing exists. It may not be marked `done`
before the maintainer accepts or amends the decisions it depends on, the routes
and their permission pins land in the same work unit, and the merged work units
carry their CI receipts.
