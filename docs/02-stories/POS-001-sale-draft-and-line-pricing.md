---
id: POS-001
type: story
title: Sale draft and line pricing
epic: EPIC-12
status: in-progress
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
branch: feat/epic-12-sale-draft
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
- No sale model, route, permission or seed existed when this Story was written;
  this Story establishes the sale aggregate and the tenant-safe read/write seam
  that [[POS-003]] completes.
- The engineering rules prefer explicit command endpoints over
  `PATCH status=...`, so `CANCELLED` is a command rather than a status write.

## In Scope

- `packages/database/prisma/schema.prisma` — the `Sale` and `SaleLine` models, a
  `sale_status` enum pinned to `DRAFT`, `COMPLETED` and `CANCELLED`, the tenant
  composite ownership keys, the `RESTRICT` references to the tenant, the
  optional customer and the catalog item, the `CHECK` constraints for money and
  quantity, and the delete-rejection guarantee for a `COMPLETED` sale.
- The additive migration under `packages/database/prisma/migrations/`, plus a
  `packages/database/src/schema-sales.test.ts` gate.
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

- [x] The sale status enum is exactly `DRAFT`, `COMPLETED`, `CANCELLED` (PRD
      §18); no other state is representable and there is no partial or held
      state. Evidence: the enum cases of `schema-sales.test.ts`, over the
      migration artifact and the Prisma model, plus the applied-enum case of the
      live-PostgreSQL block.
- [x] A sale is tenant-scoped with a tenant composite ownership key and a
      `RESTRICT` tenant foreign key; a cross-tenant or unknown sale UUID is one
      byte-equivalent `404`. Evidence: the tenant-scope case of
      `schema-sales.test.ts`, the shared-`404` cases of
      `sales.integration.test.ts`, and the cross-tenant `404` case of the
      live-PostgreSQL block.
- [x] The optional `customerId` and every referenced catalog item are resolved
      in the caller's tenant; a foreign or unknown reference is rejected with
      the same shared `404` and persists nothing. Evidence: the
      optional-customer and foreign-customer cases of
      `sales.integration.test.ts`, plus the rejected-create case of the
      live-PostgreSQL block, which asserts nothing persisted.
- [x] Only a `DRAFT` sale is mutable: editing or cancelling a `COMPLETED` sale
      is a stable `409 CONFLICT` that persists nothing. Evidence: the `409`
      update/cancel cases of `sales.integration.test.ts` and the live-PostgreSQL
      case that rejects a `CANCELLED` update and cancel while keeping the row
      and its lines intact.
- [x] Cancel is an explicit `DRAFT`-guarded command, never a generic
      `PATCH status` write; there is no `PATCH` and no `DELETE` route anywhere
      on the sale surface, and cancellation never deletes a sale or a line.
      Evidence: the five-route inventory and the per-route permission pins of
      `route-contract.probe.test.ts`, the no-`PATCH`/no-`DELETE` case of
      `sales.integration.test.ts`, and the per-status delete-trigger case of the
      live-PostgreSQL block.
- [x] Each line stores the immutable snapshot `rateCode`, `unitPrice`,
      `quantity`, `lineTotal`, `taxableBase` and `taxAmount` with explicit
      `Decimal` precision, computed tax-included with half-up rounding at the
      currency's minor unit ([[DEC-021]]). Evidence: the snapshot-scale cases of
      `schema-sales.test.ts` and the half-up arithmetic case of
      `sales.integration.test.ts`, which keeps `base + tax === total`.
- [x] Money is `Decimal(14, 2)` and quantities are `Decimal(10, 3)`; the sale
      total is the sum of the line totals, no floating-point arithmetic is used,
      and an unknown or missing rate code is rejected before any write
      ([[DEC-021]]). Evidence: the single `ROUND_HALF_UP` rounding site in
      `apps/api/src/sales/sales.pricing.ts` over `Prisma.Decimal`, the
      unresolved-rate and total-sum cases of `sales.integration.test.ts`, and
      the five applied line `CHECK`s of the live-PostgreSQL block.
- [x] The unit price is overridable per line, an item with no reference price
      can still be sold with a manually entered price, and the applied price is
      what the line snapshot records ([[DEC-022]]). Evidence: the price-override
      and no-reference-price case of `sales.integration.test.ts`.
- [x] The sale currency is read server-side from the `sales.defaultCurrency`
      tenant setting through the typed settings service and never from the
      request body; an item whose `referencePriceCurrency` differs from the sale
      currency cannot join the sale and returns a stable error, with no
      conversion anywhere ([[DEC-022]]). Evidence: the currency-resolution,
      unsupported-currency and cross-currency-rejection cases of
      `sales.integration.test.ts`, plus the strict create contract in
      `apps/api/src/sales/sales.zod.ts`.
- [x] A sale carries no discount field, no discount permission, no
      `appointmentId` and no `patientId` ([[DEC-028]]). Evidence: the header
      absence case of `schema-sales.test.ts`.
- [x] A sale carries no `number`, `sequence` or formatted identifier column
      ([[DEC-027]]). Evidence: the same header absence case of
      `schema-sales.test.ts` and the verified applied-column inspection of the
      migrated live database.
- [x] Every route enforces authentication, server-side tenant context and a
      granular permission re-asserted by the service before data access, plus
      the `sales` entitlement through `EntitlementsService.has`; a missing
      permission or a tenant without the capability is a stable `403` that
      persists nothing, and the frontend gate is UX only ([[DEC-026]]).
      Evidence: the read, write and entitlement `403` sweeps of
      `sales.integration.test.ts`, the entitlement-first gate of
      `apps/api/src/sales/sales.service.ts`, and the permission pins of
      `route-contract.probe.test.ts`.
- [x] All request bodies are strict allowlisted contracts that reject unknown
      keys; `tenantId` is never read from body, query or route; no Prisma model
      crosses the HTTP boundary. Evidence: the strict Zod contracts of
      `apps/api/src/sales/sales.zod.ts`, the invalid create and update/query
      sweeps of `sales.integration.test.ts`, and its DTO case that returns the
      stored snapshot without exposing a Prisma model.
- [x] Every accepted mutation co-commits exactly one audit row carrying the
      actor, the sale id, stable field names and
      `{ schemaVersion, changedFields     }` with no stored value; no
      CONFIDENTIAL or RESTRICTED payload is logged, and reads are not audited
      (PRD §27, PRD §41). Evidence: the create and cancel audit cases of
      `sales.integration.test.ts`, and the live-PostgreSQL create and concurrent
      cancel cases, each asserting exactly one `sale.created` or cancel audit
      row.
- [x] The draft path is inert: it performs no stock movement, balance change,
      cash movement, invoice, payment or fiscal operation. Evidence: the INERT
      case of `sales.integration.test.ts`.
- [x] The new permission keys and role matrix are seeded, and the seed-count
      probe is reconciled: the seeded permission count moves 43 → 50 across the
      epic, with this Story contributing `sales.read`, `sales.create`,
      `sales.update` and `sales.cancel` ([[DEC-026]]). Evidence: the four keys
      and their role matrix in `packages/database/src/reference-seed.ts` and the
      reconciled probe in `reference-seed.test.ts`. **Reading flagged for
      review:** this Story moves the seeded count **43 → 47**; the epic's
      DEC-026 total of **50** arrives with [[POS-002]] (`cash.read`,
      `cash.session.open`) and [[POS-003]] (`sales.complete`).
- [x] Tenant isolation tests exist for the sale aggregate, authorization and
      validation tests cover every new route, and durable live-PostgreSQL
      evidence proves the atomic create, the byte-equivalent cross-tenant `404`
      and the composite ownership keys. Evidence: `sales.integration.test.ts`
      (22 tests), the route-contract pins, and the 9-case EPIC-12 block of
      `apps/api/test/live-pg-isolation.e2e-spec.ts`.
- [x] Required lint, typecheck, test, integration and build checks pass.
      Evidence: `pnpm lint` 14/14, `pnpm typecheck` 14/14, `pnpm build` 9/9, the
      database suite (16 files / 293 tests) and the API suite (74 files / 998
      tests with `DATABASE_URL_TEST` exported) locally. **The CI receipt for
      this branch is still pending**, and root `pnpm test` without
      `DATABASE_URL_TEST` fails for the pre-existing [[TD-021]] reason.

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

Unprefixed routes behind the four granular permissions. The surface is exactly
two reads, the draft create, the draft line-set update and the explicit cancel.
There is deliberately **no** `PATCH` (status is server-owned) and **no**
`DELETE`. Completion is [[POS-003]].

| Route                    | Permission     | Contract                                                                                                                                |
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

Additive migration `20260927000001_sales`: one enum, two tables, their indexes,
constraints and the delete-rejection guarantee. It alters no existing table and
inserts no rows. This Story created it as its first work unit, and it is applied
to the live database (23 migrations, `migrate status` up to date).

### Models/Tables

- `Sale` (table `sale`) — tenant-scoped draft header. Columns: `id` (`UUID` PK),
  `tenant_id` (`UUID NOT NULL`), `customer_id` (`UUID NULL`), `currency`
  (`VarChar(3) NOT NULL`), `status` (`sale_status NOT NULL DEFAULT 'DRAFT'`),
  `created_at`, `updated_at`. There is deliberately no `number`, no `discount`,
  no `appointment_id`, no `patient_id` and no `total` column: the total is the
  sum of the line totals ([[DEC-021]], [[DEC-027]], [[DEC-028]]).
- `SaleLine` (table `sale_line`) — tenant-scoped child. Columns: `id`,
  `tenant_id`, `sale_id`, `catalog_item_id`, `rate_code`, `unit_price`
  (`DECIMAL(14,2)`), `quantity` (`DECIMAL(10,3)`), `line_total`
  (`DECIMAL(14,2)`), `taxable_base` (`DECIMAL(14,2)`), `tax_amount`
  (`DECIMAL(14,2)`), timestamps. There is no tax rate column beyond the frozen
  `rate_code` and no derived document-level arithmetic.

| Guarantee                | Applied shape                                                                                                                 |
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

Implemented and committed on `feat/epic-12-sale-draft` as three work units.

**W1 — data foundation.** The `SaleStatus` enum pinned to `DRAFT`, `COMPLETED`
and `CANCELLED`, the `Sale` and `SaleLine` models, and the additive migration
`20260927000001_sales`: two tables, the composite tenant-ownership keys, the
`RESTRICT` foreign keys, the one-line-per-item unique, the status lookup index,
the five money and quantity `CHECK`s and the two status-conditional delete
triggers. The line's `rate_code` carries a slice-level `RESTRICT` reference to
the global `tax_rate(code)` unique column, which is what makes an invalid frozen
code unrepresentable rather than merely validated in application code. The
schema gate `packages/database/src/schema-sales.test.ts` pins all of it,
including the [[DEC-027]]/[[DEC-028]] absences. `reference-seed.ts` gains
`sales.read`, `sales.create`, `sales.update` and `sales.cancel` with their role
matrix and the seed-count probe moves the catalog 43 → 47; the clinical schema
probe reconciles its composite-ownership count from 12 to 14 for the two new
models.

**W2 — API surface.** `apps/api/src/sales/` holds the permission contract, the
single rounding site of the pricing arithmetic, the allowlisted DTOs, the strict
Zod contracts, the tenant-safe repository with the row-lock-first `DRAFT` gate,
the entitlement-first service that re-asserts the granular permission before any
data access, and the controller's five routes: `GET /sales`, `GET /sales/:id`,
`POST /sales`, `PUT /sales/:id` and `POST /sales/:id/cancel`. `SalesModule` is
registered in `apps/api/src/app.module.ts`, and the shared in-memory boundary
models the two new tables. There is deliberately no `PATCH` and no `DELETE`.

**W3 — live coverage.** The EPIC-12 block of
`apps/api/test/live-pg-isolation.e2e-spec.ts` proves the same behavior against
the booted `AppModule` and a disposable real PostgreSQL: the atomic create with
the [[DEC-021]] snapshot and exactly one audit row, a rejected create that
persists nothing, the byte-equivalent cross-tenant `404`, the applied enum, the
six `RESTRICT` foreign keys, the ownership uniques and the status index plus
three rolled-back FK probes, the `DRAFT`-only `409`, the per-status delete
triggers, the one-line-per-item unique, the five `CHECK`s and two concurrent
cancels of the same draft resolving to exactly one `201` and one `409` with no
lost line set and exactly one audit row.

## Verification

Run on 2026-09-27 on `feat/epic-12-sale-draft`. `DATABASE_URL_TEST` must be
schema-less: with the Prisma-style `DATABASE_URL` from `.env` and no
`DATABASE_URL_TEST`, the API suite falls back to the Prisma URL and fails for
the pre-existing [[TD-021]] reason instead.

```text
pnpm --filter @newsaas/database test                          -> 16 files / 293 tests passed
pnpm --filter @newsaas/api test (DATABASE_URL_TEST exported)  -> 74 files passed / 998 tests passed, live suite included
pnpm --filter @newsaas/api test:live-pg                       -> 80 tests passed, 0 skipped; 9 are the EPIC-12 sale-draft cases
pnpm lint                                                     -> 14/14 successful
pnpm typecheck                                                -> 14/14 successful
pnpm build                                                    -> 9/9 successful
pnpm format-check                                             -> green repository-wide
pnpm --filter @newsaas/api test (no DATABASE_URL_TEST)        -> 1 file failed / 918 passed / 80 skipped  (pre-existing, [[TD-021]])
```

Live database state after `db:deploy` plus `db:seed`: 23 migrations applied and
`migrate status` reports "Database schema is up to date!"; `permission` count
**47**; `sale_status` exactly `DRAFT, COMPLETED, CANCELLED`; the `sale` columns
`id, tenant_id, customer_id, currency, status, created_at, updated_at` (no
`number`, no `total`, no discount, no appointment and no patient); and **6**
foreign keys plus **2** delete triggers across `sale`/`sale_line`.

## Tests Added

- `packages/database/src/schema-sales.test.ts` — **24 tests** over the migration
  artifact (the enum, the two tables, the columns and scales, the composite
  ownership keys, the `RESTRICT` foreign keys including
  `rate_code -> tax_rate(code)`, the uniques, the status index, the five
  `CHECK`s and the two status-conditional delete triggers) and over the Prisma
  models, including the [[DEC-027]]/[[DEC-028]] absences.
- `apps/api/src/sales/sales.integration.test.ts` — **22 tests**: the read, write
  and entitlement `403` sweeps that persist nothing on denial, draft create with
  its co-committed audit row, the line-set reconciliation, the optional and
  foreign customer, cancel, the `DRAFT`-only `409`, the invalid create and
  update/query sweeps, the half-up tax arithmetic, the price override, the
  currency resolution and cross-currency rejection, list ordering, the
  cross-tenant `404`, the no-`PATCH`/no-`DELETE` inventory and the INERT draft
  proof.
- `apps/api/src/rbac/route-contract.probe.test.ts` — the five sale routes in the
  deny-by-default survival inventory and their per-route permission pins.
- `apps/api/test/live-pg-isolation.e2e-spec.ts` — **9 new cases** inside the
  `EPIC-12 sale draft application-path isolation` block, against the booted
  `AppModule` and a disposable real PostgreSQL; the file now holds **80 tests**.

## Known Limitations

- The shared in-memory boundary cannot enforce the composite foreign keys or the
  uniques; the live-PostgreSQL block is what proves them against real
  PostgreSQL, so an in-memory pass alone is not evidence for those guarantees.
- A `DRAFT` does not gate on an inactive catalog item. That decision belongs to
  [[POS-003]], mirroring how [[DEC-012]] and [[DEC-014]] split the purchase
  draft gate from receiving: the draft stays inert and the completion command is
  where item state must matter.
- An update recomputes with the sale's stored currency rather than a fresh
  settings read ([[DEC-022]]): the currency is fixed at create time, so a later
  `sales.defaultCurrency` change never reinterprets an existing draft.

## Technical Debt

- [[TD-021]] records the pre-existing live-PostgreSQL environment defect:
  `pnpm test` at the root fails without `DATABASE_URL_TEST` because Turbo 2's
  strict env mode plus `turbo.json`'s `globalEnv` omit the variable, so the live
  spec falls back to the Prisma-style `DATABASE_URL`. It reproduces at
  `fd73edc`, before this Story's live coverage, and no fix was applied here
  because it is outside the Story's scope.
- [[TD-019]] records the deferred barcode/SKU identification ([[DEC-025]]); this
  Story resolves items by name because the catalog has no code column.
- [[TD-018]] records the deferred sale reversal and payment refund
  ([[DEC-023]]); this Story ships the `DRAFT -> CANCELLED` command only.
- [[TD-016]] binds only the stock writers; this Story writes no stock and is not
  a call site.
- The arithmetic, pricing and tenant-isolation risks this Story owns are covered
  by its own gates rather than deferred.

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
- `packages/database/prisma/migrations/20260927000001_sales/` — the additive
  migration.
- `packages/database/src/schema-sales.test.ts` — the schema gate.
- `apps/api/src/sales/` — permissions, DTOs, Zod contracts, repository, tax and
  pricing arithmetic, service, controller and module.
- `apps/api/src/app.module.ts` — the `SalesModule` registration.
- `apps/api/test/support/in-memory-database.ts` — the sale tables in the shared
  in-memory boundary.
- `apps/api/src/rbac/route-contract.probe.test.ts` — the route and permission
  pins.
- `packages/database/src/reference-seed.ts` — the four `sales.*` permission keys
  and the role matrix.
- `apps/api/test/live-pg-isolation.e2e-spec.ts` — the live-PostgreSQL block.
- `docs/01-roadmap/EPIC-12-POS-Payments.md` — the epic record.

## Completion Notes

Implemented and committed on `feat/epic-12-sale-draft`. The local gates pass —
lint, typecheck, the database suite, the API suite with `DATABASE_URL_TEST`, the
live-PostgreSQL block, build and `format-check` — and every acceptance criterion
is closed by local evidence. The only remaining gate is this branch's CI
receipt, which has not run yet, so `status` is `in-progress` and not `done`.
Root `pnpm test` currently fails in a local environment without
`DATABASE_URL_TEST` for the pre-existing [[TD-021]] reason; CI sets schema-less
URLs for both variables and is unaffected.
