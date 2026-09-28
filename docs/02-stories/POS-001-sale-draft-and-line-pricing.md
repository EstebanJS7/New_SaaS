---
id: POS-001
type: story
title: Sale draft and line pricing
epic: EPIC-12
status: planned
priority: high
depends_on:
  - EPIC-09
prd_sections:
  - "5"
  - "7"
  - "9"
  - "10"
  - "15"
  - "16"
  - "18"
  - "27"
  - "28"
  - "29"
  - "41"
permissions:
  - sales.read
  - sales.create
  - sales.update
  - sales.cancel
branch:
created: 2026-09-27
updated: 2026-09-27
---

# POS-001 — Sale draft and line pricing

## Objective

Deliver the `DRAFT` half of PRD §18's sale lifecycle: a tenant-scoped sale that
carries one currency, an optional customer and one or more priced lines, each
line storing the immutable snapshot the future invoice will consume
([[DEC-021]]). The operator may override a line's unit price, and the item's
catalog reference price is a suggestion rather than an authoritative value
([[DEC-022]]).

The Story also delivers the `DRAFT -> CANCELLED` transition of [[DEC-023]]:
cancel is an explicit command guarded on `DRAFT` with no stock, cash or payment
effect. A draft is inert until [[POS-003]] completes it.

## Context

- PRD §18 defines exactly three sale states — `DRAFT`, `COMPLETED`, `CANCELLED`
  — and says a sale is separate from an invoice. It does not say which states
  reach which, whether a price is tax-included, how tax is rounded, whether a
  customer is required, whether a discount exists or whether the sale carries a
  human-readable number. Those questions are closed by the accepted Decisions
  [[DEC-021]], [[DEC-022]], [[DEC-023]], [[DEC-027]] and [[DEC-028]].
- PRD §15 fixes the Paraguay rates as seeded data (`EXEMPT 0%`, `IVA_5 5%`,
  `IVA_10 10%`) and says an authorized user selects the applicable rate;
  `CatalogItem.taxRateId` is already `NOT NULL` with a `RESTRICT` reference to
  those rows, so every item already carries its rate and the catalog never
  computes tax.
- [[DEC-010]] added the optional per-item reference price as
  `referencePriceAmount Decimal(14, 2)` plus `referencePriceCurrency VarChar(3)`
  and expressly left its tax interpretation and POS use to a dedicated decision;
  [[DEC-021]] and [[DEC-022]] close both.
- No sale model, route, permission or seed exists today; this Story establishes
  the sale aggregate and the tenant-safe read/write seam that [[POS-003]]
  completes.
- The engineering rules prefer explicit command endpoints over
  `PATCH status=...`, so `CANCELLED` is a command rather than a status write.

## In Scope

- `packages/database/prisma/schema.prisma` — the `Sale` and `SaleLine` models, a
  `sale_status` enum pinned to `DRAFT`, `COMPLETED` and `CANCELLED`, the tenant
  composite ownership keys, the `RESTRICT` references to the tenant, the
  optional customer and the catalog item, the `CHECK` constraints for money and
  quantity, and the delete-rejection guarantee for a `COMPLETED` sale.
- A planned additive migration under `packages/database/prisma/migrations/`,
  plus a `packages/database/src/schema-sales.test.ts` gate.
- `apps/api/src/sales/` — the permission contract, allowlisted DTOs, strict Zod
  contracts, the tenant-safe repository, the tax and pricing arithmetic, the
  service, the controller and the module, plus its registration in
  `apps/api/src/app.module.ts` and the corresponding tables in the suite's
  shared in-memory boundary.
- Sale create, read, line-set update and cancel routes, with `DRAFT`-only
  mutation guards.
- `apps/api/src/rbac/route-contract.probe.test.ts` — the new routes and their
  per-route permission pins.
- `packages/database/src/reference-seed.ts` — the `sales.read`, `sales.create`,
  `sales.update` and `sales.cancel` keys and their role matrix, with the
  reconciled seed-count probe.
- Tenant isolation, authorization, validation, arithmetic and pricing tests over
  the real guard chain, plus durable live-PostgreSQL coverage over the real DDL.
- This Story and the epic record.

## Out of Scope

- **Completion, payments, stock and cash effects** — [[POS-003]]. This Story
  creates no `StockMovement`, touches no `StockBalance`, writes no cash movement
  and writes no payment row; `DRAFT -> COMPLETED` belongs to [[POS-003]].
- **The cash foundation** — [[POS-002]].
- **Cash session close, the expected/counted difference, the six remaining cash
  movement kinds and the cash UI** — EPIC-13.
- **Invoices, billing and invoice numbering** — EPIC-14. EPIC-12 emits no
  invoice; the line snapshot this Story freezes is what EPIC-14 later consumes.
- **Fiscal documents and fiscal providers** — EPIC-15 and EPIC-16.
- **Sale reversal and payment refund** — PRD §40 names "Sale
  cancellation/reversal" and "Payment refund/reversal" as core correction cases,
  but [[DEC-023]] defers them; the reserved `POST /sales/:id/cancel` on a
  completed sale and `POST /payments/:id/refund` conventions are not implemented
  here ([[TD-018]]).
- **Discounts of any kind** — no percentage, no amount, no reason field and no
  separate permission; the line price override is the only price adjustment
  ([[DEC-022]], [[DEC-028]]).
- **Appointment and patient links** — the sale carries no `appointmentId` and no
  `patientId` and never touches Scheduling or clinical records ([[DEC-028]]).
- **A human-readable sale number, sequence or formatted identifier** —
  [[DEC-027]].
- **Barcode/SKU item codes and catalog changes** — [[DEC-025]] and [[TD-019]].
  This Story does not modify the catalog.
- **A staff browser surface** — [[POS-004]].
- **Customer credit, accounts receivable, overpayment or a running balance** —
  [[DEC-029]] and EPIC-14.
- **Reports and low-stock thresholds** — EPIC-18.
- **Stock transfers and any Branch, Warehouse or location dimension.**
- **Automatic retention or purge of any confirmed sale record** — PRD §41.
- **Hard delete of a sale or a sale line.**
- **A new Decision record or an ADR** — outside this Story's file surface.

## Acceptance Criteria

- [ ] The sale status enum is exactly `DRAFT`, `COMPLETED`, `CANCELLED` (PRD
      §18); no other state is representable and there is no partial or held
      state.
- [ ] A sale is tenant-scoped with a tenant composite ownership key and a
      `RESTRICT` tenant foreign key; a cross-tenant or unknown sale UUID is one
      byte-equivalent `404`.
- [ ] The optional `customerId` and every referenced catalog item are resolved
      in the caller's tenant; a foreign or unknown reference is rejected with
      the same shared `404` and persists nothing.
- [ ] Only a `DRAFT` sale is mutable: editing or cancelling a `COMPLETED` sale
      is a stable `409 CONFLICT` that persists nothing.
- [ ] Cancel is an explicit `DRAFT`-guarded command, never a generic
      `PATCH status` write; there is no `PATCH` and no `DELETE` route anywhere
      on the sale surface, and cancellation never deletes a sale or a line.
- [ ] Each line stores the immutable snapshot `rateCode`, `unitPrice`,
      `quantity`, `lineTotal`, `taxableBase` and `taxAmount` with explicit
      `Decimal` precision, computed tax-included with half-up rounding at the
      currency's minor unit ([[DEC-021]]).
- [ ] Money is `Decimal(14, 2)` and quantities are `Decimal(10, 3)`; the sale
      total is the sum of the line totals, no floating-point arithmetic is used,
      and an unknown or missing rate code is rejected before any write
      ([[DEC-021]]).
- [ ] The unit price is overridable per line, an item with no reference price
      can still be sold with a manually entered price, and the applied price is
      what the line snapshot records ([[DEC-022]]).
- [ ] The sale currency is read server-side from the `sales.defaultCurrency`
      tenant setting through the typed settings service and never from the
      request body; an item whose `referencePriceCurrency` differs from the sale
      currency cannot join the sale and returns a stable error, with no
      conversion anywhere ([[DEC-022]]).
- [ ] A sale carries no discount field, no discount permission, no
      `appointmentId` and no `patientId` ([[DEC-028]]).
- [ ] A sale carries no `number`, `sequence` or formatted identifier column
      ([[DEC-027]]).
- [ ] Every route enforces authentication, server-side tenant context and a
      granular permission re-asserted by the service before data access, plus
      the `sales` entitlement through `EntitlementsService.has`; a missing
      permission or a tenant without the capability is a stable `403` that
      persists nothing, and the frontend gate is UX only ([[DEC-026]]).
- [ ] All request bodies are strict allowlisted contracts that reject unknown
      keys; `tenantId` is never read from body, query or route; no Prisma model
      crosses the HTTP boundary.
- [ ] Every accepted mutation co-commits exactly one audit row carrying the
      actor, the sale id, stable field names and
      `{ schemaVersion, changedFields     }` with no stored value; no
      CONFIDENTIAL or RESTRICTED payload is logged, and reads are not audited
      (PRD §27, PRD §41).
- [ ] The draft path is inert: it performs no stock movement, balance change,
      cash movement, invoice, payment or fiscal operation.
- [ ] The new permission keys and role matrix are seeded, and the seed-count
      probe is reconciled: the seeded permission count moves 43 → 50 across the
      epic, with this Story contributing `sales.read`, `sales.create`,
      `sales.update` and `sales.cancel` ([[DEC-026]]).
- [ ] Tenant isolation tests exist for the sale aggregate, authorization and
      validation tests cover every new route, and durable live-PostgreSQL
      evidence proves the atomic create, the byte-equivalent cross-tenant `404`
      and the composite ownership keys.
- [ ] Required lint, typecheck, test, integration and build checks pass.

## Domain Invariants

- **A draft is inert.** No draft operation changes stock, cash, an invoice or a
  fiscal document.
- **Every sale belongs to exactly one tenant.** Tenant identity comes only from
  the server-side request context; a cross-tenant UUID is a `404`.
- **Ownership is enforced twice.** The composite tenant foreign keys reject a
  cross-tenant customer or catalog-item reference at the database, and the
  service resolves references through the tenant-safe repository, which renders
  one shared `404` for a foreign and an unknown id.
- **The line is an immutable money record.** The snapshot is frozen so a later
  rate change can never rewrite what a past sale charged ([[DEC-021]]).
- **No balance is ever mutated directly.** The draft path touches no
  `StockBalance` and no cash balance.
- **History is preserved.** A sale and its lines are never hard-deleted; a
  `DRAFT` may change its line set through the update command, and a `COMPLETED`
  sale is immutable.
- **The status enum is the PRD's.** `DRAFT`, `COMPLETED`, `CANCELLED` only.
- **Money and quantities use `Decimal`.** Never a float.

## API

### Added

Planned unprefixed routes behind the four granular permissions. The surface is
exactly two reads, the draft create, the draft line-set update and the explicit
cancel. There is deliberately **no** `PATCH` (status is server-owned) and **no**
`DELETE`. Completion is [[POS-003]].

| Route                    | Permission     | Planned contract                                                                                                                        |
| ------------------------ | -------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /sales`             | `sales.read`   | The caller tenant's sales with their lines, newest first with an id tiebreaker; optional `status` filter, no implicit default.          |
| `GET /sales/:id`         | `sales.read`   | One sale; a foreign or unknown UUID is the same byte-equivalent `404`.                                                                  |
| `POST /sales`            | `sales.create` | Create one `DRAFT` sale with at least one priced line, the currency resolved from `sales.defaultCurrency` (`201`).                      |
| `PUT /sales/:id`         | `sales.update` | Update a `DRAFT`: `customerId` optional and `lines` the authoritative line set reconciled by `catalogItemId`, each with its unit price. |
| `POST /sales/:id/cancel` | `sales.cancel` | Cancel a `DRAFT` (`201`); `CANCELLED` is reachable only from `DRAFT` and never deletes.                                                 |

The reserved conventions `POST /sales/:id/cancel` on a `COMPLETED` sale and
`POST /payments/:id/refund` are **not** implemented by this Story ([[DEC-023]],
[[TD-018]]).

### Changed

```text
None yet
```

No existing catalog, inventory, supplier or purchase route is touched.

## Database

### Migration

Planned additive migration `20260927000001_sales`: one enum, two tables, their
indexes, constraints and the delete-rejection guarantee. It alters no existing
table and inserts no rows. This Story creates it as its first work unit.

### Models/Tables

- `Sale` (table `sale`) — tenant-scoped draft header. Planned columns: `id`
  (`UUID` PK), `tenant_id` (`UUID NOT NULL`), `customer_id` (`UUID NULL`),
  `currency` (`VarChar(3) NOT NULL`), `status`
  (`sale_status NOT NULL DEFAULT 'DRAFT'`), `created_at`, `updated_at`. There is
  deliberately no `number`, no `discount`, no `appointment_id`, no `patient_id`
  and no `total` column: the total is the sum of the line totals ([[DEC-021]],
  [[DEC-027]], [[DEC-028]]).
- `SaleLine` (table `sale_line`) — tenant-scoped child. Planned columns: `id`,
  `tenant_id`, `sale_id`, `catalog_item_id`, `rate_code`, `unit_price`
  (`DECIMAL(14,2)`), `quantity` (`DECIMAL(10,3)`), `line_total`
  (`DECIMAL(14,2)`), `taxable_base` (`DECIMAL(14,2)`), `tax_amount`
  (`DECIMAL(14,2)`), timestamps. There is no tax rate column beyond the frozen
  `rate_code` and no derived document-level arithmetic.

| Guarantee                | Planned shape                                                                                                                 |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| Status enum              | `sale_status` pinned to `DRAFT`, `COMPLETED`, `CANCELLED`                                                                     |
| Tenant scope             | `sale_tenant_id_fkey` and `sale_line_tenant_id_fkey` — `RESTRICT` tenant FKs on delete and update                             |
| Ownership is composite   | `sale_tenant_id_id_key` and `sale_line_tenant_id_id_key` unique on `(tenant_id, id)`                                          |
| Same-tenant customer     | `sale_tenant_id_customer_id_fkey` on `(tenant_id, customer_id)` → `customer(tenant_id, id)`, `RESTRICT`                       |
| Same-tenant sale         | `sale_line_tenant_id_sale_id_fkey` on `(tenant_id, sale_id)` → `sale(tenant_id, id)`, `RESTRICT`                              |
| Same-tenant catalog item | `sale_line_tenant_id_catalog_item_id_fkey` on `(tenant_id, catalog_item_id)` → `catalog_item(tenant_id, id)`, `RESTRICT`      |
| One line per item        | `sale_line_tenant_id_sale_id_catalog_item_id_key` unique on `(tenant_id, sale_id, catalog_item_id)` where the product decides |
| List lookup              | `sale_tenant_id_status_idx` on `(tenant_id, status)`                                                                          |
| Positive quantity        | `sale_line_quantity_positive` `CHECK (quantity > 0)`                                                                          |
| Non-negative money       | `CHECK (unit_price >= 0)`, `CHECK (line_total >= 0)`, `CHECK (tax_amount >= 0)`                                               |

The exact index and constraint list is a slice-level implementation choice
inside approved scope and follows the sibling migration shapes.

## UI

- None. [[POS-004]] owns the draft pages and the line editor.
- If UI is changed later, reusable components must use semantic branding tokens
  rather than project-specific literals.

## Implementation Summary

_Not implemented._

## Verification

```text
Not run.
```

## Tests Added

Planned coverage; none of it exists yet.

- `packages/database/src/schema-sales.test.ts` — the additive migration's enum
  literal, the two tables, the columns, the composite ownership keys, the
  `RESTRICT` tenant/customer/sale/catalog-item foreign keys, the quantity and
  money `CHECK`s, the delete-rejection guarantee for a `COMPLETED` sale, and the
  [[DEC-027]]/[[DEC-028]] absence of a number, discount, appointment or patient
  column.
- `apps/api/src/sales/sales.integration.test.ts` — the read and write permission
  sweeps that persist nothing on denial, the `sales` entitlement `403`, draft
  create, line-set update, cancel and list, the `DRAFT`-only `409`, the invalid
  create/update sweeps, the tax and rounding cases, the price-override case, the
  currency-resolution case with the cross-currency rejection, the optional
  customer resolution, the co-committed audit rows with field names only, the
  cross-tenant `404`, and the proof that the draft path is inert.
- `apps/api/src/rbac/route-contract.probe.test.ts` — the five sale routes in the
  deny-by-default survival inventory and their per-route permission pins.
- `apps/api/test/live-pg-isolation.e2e-spec.ts` — an EPIC-12 sale-draft block
  against the booted AppModule and a disposable real PostgreSQL: the atomic
  create, the byte-equivalent cross-tenant `404`, the composite ownership keys,
  the `DRAFT`-only transition and the delete-rejection guarantee.

## Known Limitations

- None yet; nothing is implemented.
- Planned: the in-memory boundary cannot enforce the composite foreign keys or
  the unique constraints, so the live-PostgreSQL block must prove them against
  real PostgreSQL as the EPIC-11 slices did.

## Technical Debt

- [[TD-019]] records the deferred barcode/SKU identification ([[DEC-025]]); this
  Story resolves items by name because the catalog has no code column.
- [[TD-018]] records the deferred sale reversal and payment refund
  ([[DEC-023]]); this Story ships the `DRAFT -> CANCELLED` command only.
- [[TD-016]] binds only the stock writers; this Story writes no stock and is not
  a call site.
- No new debt record is planned: the arithmetic, pricing and tenant-isolation
  risks this Story owns are covered by its own gates rather than deferred.

## Decisions / ADRs

- Accepted Decision records govern this Story (accepted 2026-09-27):
  - [[DEC-021]] — sale tax arithmetic, amount precision and the per-line
    snapshot.
  - [[DEC-022]] — line pricing, price override and sale currency.
  - [[DEC-023]] — sale status transitions and the deferred reversal boundary;
    this Story owns the `DRAFT -> CANCELLED` command.
  - [[DEC-026]] — sales permission keys, role matrix and the entitlement gate;
    this Story owns `sales.read`, `sales.create`, `sales.update` and
    `sales.cancel`.
  - [[DEC-027]] — sale identifier: no human-readable number.
  - [[DEC-028]] — sale scope boundaries: optional customer, no discount, no
    clinical links.
  - [[DEC-010]] — the catalog reference price is an informational pair with no
    conversion; [[DEC-022]] applies it to the sale line.
- An ADR is not expected: the sale aggregate introduces no architecture change
  that the complexity budget gates.

## Resolved by Decision

- **Tax interpretation, rounding and precision** — [[DEC-021]]: tax-included
  prices, half-up per line at the currency minor unit, money `Decimal(14, 2)`
  and quantities `Decimal(10, 3)`, with a frozen per-line snapshot.
- **Price source and override** — [[DEC-022]]: the reference price is a
  suggestion, the operator may override it, and the applied price is recorded.
- **Sale currency** — [[DEC-022]]: the tenant's `sales.defaultCurrency`, read
  server-side, with a stable cross-currency rejection and no conversion.
- **Customer optionality, discounts and clinical links** — [[DEC-028]]: an
  optional in-tenant customer, no discount and no appointment or patient link.
- **Sale numbering** — [[DEC-027]]: no number, sequence or formatted identifier.
- **Cancellation reachability** — [[DEC-023]]: `CANCELLED` is reachable only
  from `DRAFT`, and a `COMPLETED` sale is corrected only by a future reversal.
- **Permission keys and entitlement gate** — [[DEC-026]]: the four `sales.*`
  keys with their role matrix and the `sales` entitlement.
- **The exact index and constraint list** — an implementation choice inside
  approved scope, decided during the slice using the sibling migrations as
  precedent.

## Files / Modules

- `packages/database/prisma/schema.prisma` — the `SaleStatus` enum and the
  `Sale`/`SaleLine` models.
- `packages/database/prisma/migrations/20260927000001_sales/` — the planned
  additive migration.
- `packages/database/src/schema-sales.test.ts` — the planned schema gate.
- `apps/api/src/sales/` — permissions, DTOs, Zod contracts, repository, tax and
  pricing arithmetic, service, controller and module.
- `apps/api/src/app.module.ts` — the planned `SalesModule` registration.
- `apps/api/test/support/in-memory-database.ts` — the sale tables in the shared
  in-memory boundary.
- `apps/api/src/rbac/route-contract.probe.test.ts` — the route and permission
  pins.
- `packages/database/src/reference-seed.ts` — the four `sales.*` permission keys
  and the role matrix.
- `apps/api/test/live-pg-isolation.e2e-spec.ts` — the planned live-PostgreSQL
  block.
- `docs/01-roadmap/EPIC-12-POS-Payments.md` — the epic record.

## Completion Notes

_Status must remain non-done until all required gates pass._ This Story stays
`planned` while nothing exists; it may not be marked `done` until the schema,
the routes, the seed and the live-PostgreSQL evidence are merged with the
required CI checks green.
