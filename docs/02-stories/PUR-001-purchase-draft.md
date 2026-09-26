---
id: PUR-001
type: story
title: Purchase draft
epic: EPIC-11
status: done
priority: high
depends_on:
  - EPIC-10
  - SUP-001
prd_sections:
  - "5"
  - "7"
  - "9"
  - "17"
  - "27"
  - "28"
  - "29"
  - "41"
permissions:
  - purchases.read
  - purchases.create
  - purchases.update
  - purchases.cancel
branch: feat/epic-11-purchase-draft
created: 2026-09-26
updated: 2026-09-26
---

# PUR-001 — Purchase draft

## Objective

Deliver the `DRAFT` half of PRD §17's purchase lifecycle: create a tenant-scoped
draft purchase that references a supplier and one or more in-tenant catalog
items, edit it while it stays `DRAFT`, and cancel it through an explicit
command. A draft has no stock, cash, billing or fiscal effect: it is inert until
[[PUR-002 Purchase receiving]] receives it.

This Story establishes the purchase aggregate, its `DRAFT`/`RECEIVED`/
`CANCELLED` state enum and the tenant-safe read/write seam that the receiving
command reuses. It does not define numbering, line cost/tax structure or
cancellation reachability, which PRD §17 leaves open and which the accepted
Decisions fix (see "Resolved by Decision").

## Context

- PRD §17 defines exactly three purchase states and the receiving steps; it
  defines no purchase number, no line cost, no tax total and no cancellation
  rule.
- No purchase model, route, permission or seed existed before this Story; the
  schema comment reserves the `PURCHASE` stock movement type for this epic.
- The catalog establishes the tenant-reference precedent: a line pointing at an
  in-tenant catalog item is resolved through a tenant-safe repository and a
  cross-tenant id collapses to the same `404` as an unknown one.
- The engineering rules prefer explicit command endpoints over
  `PATCH status=...`, so `RECEIVED` and `CANCELLED` are commands rather than
  status writes.

## In Scope

- `packages/database/prisma/schema.prisma` — the `Purchase` and `PurchaseLine`
  models, a `purchase_status` enum pinned to `DRAFT`, `RECEIVED`, `CANCELLED`,
  the tenant composite ownership keys and the `RESTRICT` references to the
  supplier, tenant and catalog items.
- An additive migration under `packages/database/prisma/migrations/`, plus a
  `packages/database/src/schema-purchases.test.ts` gate.
- `apps/api/src/purchases/` — permission contract, allowlisted DTOs, strict Zod
  contracts, tenant-safe repository, service, controller and module, plus its
  registration in `apps/api/src/app.module.ts`; the suite's shared in-memory
  boundary was extended with the purchase tables.
- Draft create, edit, cancel and read routes, with `DRAFT`-only mutation guards.
- `apps/api/src/rbac/route-contract.probe.test.ts` — the new routes and their
  per-route permission pins.
- `packages/database/src/reference-seed.ts` — the new permission keys and role
  matrix, with the reconciled seed-count probe.
- Tenant isolation and validation tests over the real guard chain, plus durable
  live-PostgreSQL coverage over the real DDL.
- This Story and the epic record.

## Out of Scope

- **Receiving and any stock effect** — [[PUR-002 Purchase receiving]]. This
  Story creates no `StockMovement` and touches no `StockBalance`.
- **Cash, billing, fiscal, payment settlement and POS** — [[EPIC-12]],
  [[EPIC-13]], [[EPIC-14]], [[EPIC-15]] and [[EPIC-16]]. A draft stores no
  payment, no invoice and no fiscal document.
- **Purchase reversal** — PRD §40 names it as a correction case, but no reversal
  command is added here.
- **Partial receiving, partial state or back-order state** — PRD §17 defines no
  partial state.
- **Low-stock thresholds or reports** — [[EPIC-18]].
- **Staff UI** — [[PUR-003 Staff purchases surface]].
- **Numbering, cost/tax structure and cancellation semantics as implemented
  behavior.** These are fixed by the accepted Decision records; no assumed value
  is persisted.

## Acceptance Criteria

- [x] The purchase status enum is exactly `DRAFT`, `RECEIVED`, `CANCELLED` (PRD
      §17); no other state is representable, and there is no partial or
      back-order state.
- [x] A purchase is tenant-scoped with a tenant composite ownership key and a
      `RESTRICT` tenant foreign key; a cross-tenant or unknown purchase UUID is
      one byte-equivalent `404`.
- [x] A referenced supplier and every referenced catalog item are resolved in
      the caller's tenant; a foreign or unknown reference is rejected with the
      same shared `404` and persists nothing.
- [x] Only a `DRAFT` purchase is mutable: editing or cancelling a `RECEIVED`
      purchase is `409 CONFLICT` and persists nothing.
- [x] Receiving and cancelling are explicit transition commands, never a generic
      `PATCH status` write. **Note:** the **cancel** half ships here as
      `POST /purchases/:id/cancel`; the **receiving** half is the explicit
      command [[PUR-002 Purchase receiving]] delivers, so this Story proves only
      the shipped half plus the negative — no `PATCH` route and no
      caller-supplied status exist anywhere on the surface. The criterion is
      checked for the shape and the shipped command, not for a receive command
      that is not implemented yet.
- [x] Cancellation never deletes a purchase or a line; a cancelled purchase and
      its lines remain readable, and cancellation reachability follows the
      accepted Decision. **Note:** `CANCELLED` is reachable only from `DRAFT`
      ([[DEC-015]]), cancellation is a status transition that keeps the header
      and its lines readable, and the no-delete guarantee is enforced by
      [[DEC-019]]'s conditional `BEFORE DELETE` trigger, which refuses a delete
      exactly when the owning purchase is `RECEIVED` or `CANCELLED`.
- [x] All request bodies are strict allowlisted contracts that reject unknown
      keys; `tenantId` is never read from body, query or route; no Prisma model
      crosses the HTTP boundary.
- [x] Every route enforces authentication, server-side tenant context and a
      granular permission, re-asserted by the service before data access; a
      missing permission is `403` and persists nothing.
- [x] The draft write path performs no stock movement, balance change, cash
      movement, invoice, payment or fiscal operation.
- [x] Purchase numbering, the line cost/tax structure, supplier optionality and
      cancellation semantics are fixed by accepted and binding Decision records
      ([[DEC-012]], [[DEC-013]], [[DEC-015]], [[DEC-018]], accepted 2026-09-26)
      **before** the schema and DTO were written.
- [x] The new permission keys and role matrix are seeded, and the seed-count
      probe is reconciled (the seeded count moved 38 → 42).
- [x] Tenant isolation tests exist for the new private aggregate, and
      authorization and validation tests cover every new route.
- [x] Required lint/typecheck/test checks pass.

## Domain Invariants

- **A draft is inert.** No draft operation changes stock, cash, an invoice or a
  fiscal document.
- **Every purchase belongs to exactly one tenant.** Tenant identity comes only
  from the server-side request context; a cross-tenant UUID is a `404`.
- **Ownership is enforced twice.** The composite tenant foreign keys reject a
  cross-tenant supplier or catalog-item reference at the database, and the
  service resolves references through the tenant-safe repository, which renders
  one shared `404` for a foreign and an unknown id.
- **Confirmed state is immutable.** Once a purchase is `RECEIVED` it is no
  longer editable; a correction is a future compensating operation, not an edit.
- **History is preserved.** A confirmed or cancelled purchase and its lines are
  never hard-deleted; only a `DRAFT` may drop a line, and it does so through the
  update command.
- **The status enum is the PRD's.** `DRAFT`, `RECEIVED`, `CANCELLED` only.

## API

### Added

Five unprefixed routes ([[DEC-002]]) behind four granular permissions. The
surface is exactly two reads, the draft create, the draft update and the
explicit cancel. There is deliberately **no** `PATCH` (status is server-owned)
and **no** `DELETE` anywhere; receiving is [[PUR-002 Purchase receiving]].

| Route                        | Permission         | Contract                                                                                                                                         |
| ---------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /purchases`             | `purchases.read`   | The caller tenant's purchases with their lines, newest first with an id tiebreaker; optional `status` filter, no implicit default.               |
| `GET /purchases/:id`         | `purchases.read`   | One purchase; a foreign or unknown UUID is the same byte-equivalent `404`.                                                                       |
| `POST /purchases`            | `purchases.create` | Create one `DRAFT` purchase with at least one line (`201`).                                                                                      |
| `PUT /purchases/:id`         | `purchases.update` | Update a `DRAFT`: `supplierId` optional, `lines` is the authoritative line set reconciled by `catalogItemId` (`200`); any other status is `409`. |
| `POST /purchases/:id/cancel` | `purchases.cancel` | Cancel a `DRAFT` (`201`); `CANCELLED` is reachable only from `DRAFT` and never deletes.                                                          |

### Changed

None; the existing catalog, inventory and supplier routes are untouched.

## Database

### Migration

`20260926000002_purchases` — strictly additive: one enum, two tables, their
indexes, constraints and triggers. It alters no existing table and inserts no
rows.

### Models/Tables

- `Purchase` (table `purchase`) — tenant-scoped draft header. Columns: `id`
  (`UUID` PK, `gen_random_uuid()`), `tenant_id` (`UUID NOT NULL`), `supplier_id`
  (`UUID NOT NULL`), `status` (`purchase_status NOT NULL DEFAULT 'DRAFT'`),
  `created_at`, `updated_at` (`TIMESTAMPTZ(3)`). There is deliberately no
  `number`, `code`, `total`, `tax` or `valuation` column ([[DEC-018]],
  [[DEC-013]]).
- `PurchaseLine` (table `purchase_line`) — tenant-scoped child. Columns: `id`
  (`UUID` PK), `tenant_id` (`UUID NOT NULL`), `purchase_id` (`UUID NOT NULL`),
  `catalog_item_id` (`UUID NOT NULL`), `quantity` (`DECIMAL(10,3) NOT NULL`),
  `unit_cost` (`DECIMAL(14,2) NULL`), `created_at`, `updated_at`. The optional
  informational cost is a single column: no tax field, no computed line total
  and no purchase total exist ([[DEC-013]]).

| Guarantee                   | Shape                                                                                                                                          |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Status enum                 | `purchase_status` pinned to `DRAFT`, `RECEIVED`, `CANCELLED`                                                                                   |
| Tenant scope                | `purchase_tenant_id_fkey` and `purchase_line_tenant_id_fkey` — `RESTRICT` tenant FKs on delete and update                                      |
| Ownership is composite      | `purchase_tenant_id_id_key` and `purchase_line_tenant_id_id_key` unique on `(tenant_id, id)`                                                   |
| Same-tenant supplier        | `purchase_tenant_id_supplier_id_fkey` on `(tenant_id, supplier_id)` → `supplier(tenant_id, id)`, `RESTRICT`                                    |
| Same-tenant purchase        | `purchase_line_tenant_id_purchase_id_fkey` on `(tenant_id, purchase_id)` → `purchase(tenant_id, id)`, `RESTRICT`                               |
| Same-tenant catalog item    | `purchase_line_tenant_id_catalog_item_id_fkey` on `(tenant_id, catalog_item_id)` → `catalog_item(tenant_id, id)`, `RESTRICT`                   |
| One line per item per draft | `purchase_line_tenant_id_purchase_id_catalog_item_id_key` unique on `(tenant_id, purchase_id, catalog_item_id)`                                |
| List lookup                 | `purchase_tenant_id_status_idx` on `(tenant_id, status)`                                                                                       |
| Positive quantity           | `purchase_line_quantity_positive` `CHECK (quantity > 0)`                                                                                       |
| Non-negative cost           | `purchase_line_unit_cost_non_negative` `CHECK (unit_cost >= 0)`                                                                                |
| Conditional immutability    | `purchase_no_delete_when_received_or_cancelled_trigger` and `purchase_line_no_delete_when_received_or_cancelled_trigger` (`BEFORE DELETE ROW`) |

The two delete triggers are **conditional on status** ([[DEC-019]], refining
[[DEC-015]]): the `purchase` trigger raises `restrict_violation` only when
`OLD.status IN ('RECEIVED', 'CANCELLED')`, and the `purchase_line` trigger reads
the owning purchase's status and raises only when it is `RECEIVED` or
`CANCELLED`. A `DRAFT` therefore stays fully editable, including dropping a line
entered by mistake, while a confirmed or cancelled purchase and its lines stay
immutable and readable. This is deliberately **not** the unconditional trigger
shape the catalog, supplier and inventory tables use. The raised messages are
`a received or cancelled purchase cannot be deleted` and
`a line of a received or cancelled purchase cannot be deleted`.

## UI

- None. [[PUR-003 Staff purchases surface]] owns the draft pages.

## Implementation Summary

The `DRAFT` half of the lifecycle is implemented on branch
`feat/epic-11-purchase-draft` across three work units: `517ad69` ([[DEC-019]]
and the plan), `59031c3` (P1, the data foundation) and `43ac6dd` (P2, the API
surface).

**P1 — data foundation (`59031c3`).** Migration `20260926000002_purchases` adds
the `purchase_status` enum pinned to `DRAFT`, `RECEIVED` and `CANCELLED`, the
`purchase` and `purchase_line` tables, the composite tenant-ownership keys, the
`RESTRICT` tenant/supplier/purchase/catalog-item foreign keys, the
positive-quantity and non-negative-cost CHECKs, the
`(tenant_id, purchase_id, catalog_item_id)` unique, and the two conditional
`BEFORE DELETE` triggers ([[DEC-019]]). The four `purchases.*` permission keys
and their [[DEC-016]] role matrix ship with the seed, moving the seeded count 38
→ 42; `purchases.receive` arrives with [[PUR-002 Purchase receiving]] to
reach 43. The schema gate `schema-purchases.test.ts` fences the DDL.

**P2 — API surface (`43ac6dd`).** The `apps/api/src/purchases/` module ships the
five routes, strict Zod contracts, allowlisted INTERNAL DTOs, the tenant-safe
repository, the [[DEC-015]]/[[DEC-019]] `DRAFT`-only guard, the **line-set
reconciliation** that matches every submitted line to the stored draft by
`catalogItemId` (updating a matched line in place, inserting a new item and
deleting a stored line whose item is absent), and the [[DEC-017]] audit rows.
Every accepted mutation co-commits exactly one audit row inside the same
transaction — `purchase.created`, `purchase.updated` or `purchase.cancelled`,
`targetType` `purchase`, metadata `{ schemaVersion, changedFields }` — and reads
are never audited.

**Receiving is not implemented.** No route creates a `StockMovement`, touches a
`StockBalance`, writes cash or billing state, calls a fiscal provider or
allocates a number: receiving, its ledger integration and its
`purchases.receive` key belong to [[PUR-002 Purchase receiving]].

## Verification

```text
docker ps --format '{{.Names}}\t{{.Status}}' — newsaas-postgres Up (healthy),
  newsaas-redis Up (healthy).

set -a && . ./.env && set +a && export DATABASE_URL_TEST="$(sed -n 's/^DATABASE_URL=//p' .env | cut -d'?' -f1)" &&
  pnpm --filter @newsaas/api test:live-pg
  → 1 file / 65 tests passed, including the 7-case
    `EPIC-11 purchases application-path isolation` block (the suite held 58
    before this slice).

pnpm --filter @newsaas/api test
  → 72 files passed, 1 skipped (73); 886 tests passed, 65 skipped (951).

pnpm --filter @newsaas/database test → 15 files / 268 tests passed.

pnpm --filter @newsaas/api typecheck → clean.
pnpm --filter @newsaas/api lint → clean.
pnpm format-check → All matched files use Prettier code style!
git diff --check → clean.
```

The live block rejects every outcome with the database's own rejection and rolls
every raw-SQL probe back: it uses no injected Prisma error, no mock, no sleep
and no retry.

## Tests Added

- `packages/database/src/schema-purchases.test.ts` — **22 tests**: the additive
  migration's enum literal, the two tables, the columns, the composite ownership
  keys, the `RESTRICT` tenant/supplier/purchase/catalog-item foreign keys, the
  duplicate-line unique, the two CHECKs, the two conditional delete triggers
  (guarding against the unconditional sibling shape), the model mappings and the
  [[DEC-018]]/[[DEC-013]] absence of a number/total column.
- `apps/api/src/purchases/purchases.integration.test.ts` — **16 tests** over the
  real guard chain (Auth → Tenancy → RBAC) and the shared in-memory boundary:
  the read and write permission sweeps that persist nothing on denial; draft
  create, update, cancel and list; the DRAFT-only `409`; the invalid
  create/update sweeps; the line-set reconciliation (retain, update in place,
  insert, remove); the co-committed audit rows with field names only; the
  cross-tenant and foreign-reference `404`; and the proof that the draft path is
  inert (the only tables a draft touches are `purchases`, `purchaseLines` and
  `audits`, with zero stock movements and zero stock balances).
- `apps/api/src/rbac/route-contract.probe.test.ts` — the five purchase routes in
  the deny-by-default survival inventory and `PURCHASES_PERMISSION_BY_ROUTE`
  (the probe holds 18 routes).
- `apps/api/test/live-pg-isolation.e2e-spec.ts` — the
  `EPIC-11 purchases application-path isolation` block, **7 tests** against the
  booted AppModule and a disposable real PostgreSQL: the draft create that
  persists its lines and leaves the ledger untouched; the duplicate-line unique
  proven by catalog introspection plus a raw duplicate insert; [[DEC-019]]'s
  conditional immutability with the exact trigger messages; the line-set
  reconciliation over HTTP; the DRAFT-only `409` against a raw `RECEIVED`
  aggregate; the composite foreign keys and the byte-equivalent cross-tenant
  `404`; and the quantity/cost CHECKs.

## Known Limitations

- **A lines-only update does not bump the header `updatedAt`.** Prisma's
  `@updatedAt` fires on a header-row write, so when an update changes only the
  line set the DTO's `updatedAt` still reflects the last header write. This is
  documented behavior, not pinned by a test.
- **The in-memory boundary cannot enforce the schema keywords.** The shared fake
  does not implement the composite ownership foreign keys or the
  `(tenant_id, purchase_id, catalog_item_id)` unique, so
  `purchases.integration.test.ts` cannot prove them. The live block now proves
  both against real PostgreSQL: the duplicate unique by introspection and a raw
  duplicate insert, and the composite foreign keys by a raw cross-tenant
  supplier and catalog-item reference that the database rejects.
- **What the live block does not prove.** It does not exercise the receive
  command (that is [[PUR-002 Purchase receiving]]), it does not race two
  concurrent duplicate-line inserts, and it does not run a `migrate status`
  drift check. The migration is applied to a disposable database by `db:deploy`
  in the suite's setup, so application is proven, but a drift-free
  `migrate status` against a persistent database is still owed by the epic.
- **Carried, pre-existing drift.** The migration writes `updated_at` with a
  `DEFAULT CURRENT_TIMESTAMP`, following the closest sibling migrations, so
  `prisma migrate diff` lists a `DROP DEFAULT` for two more columns. That drift
  is repo-wide and pre-existing (22 tables before this slice, 24 now);
  `migrate status` is green and CI applies migrations rather than diffing.
- **No cash or invoice tables exist in the boundary fake**, so "no cash or
  invoice row" is proven by the exhaustive table diff rather than by
  interrogating those tables.
- **No staff UI and no web proxy.** The module is API-only in this slice;
  [[PUR-003 Staff purchases surface]] owns the browser surface.

## Technical Debt

**No debt record is created.** The draft slice shipped its schema gate, its
integration suite and its live-PostgreSQL block, so the two gaps that would
normally justify debt — the unproven composite foreign keys and the unproven
duplicate-line unique — are now proven at the real database boundary. What
remains is (a) documented behavior (`updatedAt` on a lines-only update), (b) the
repo-wide, pre-existing `updated_at` `DEFAULT` drift that this slice neither
introduced nor worsens, and (c) work already owned by an accepted Decision or a
planned Story: receiving and its ledger integration belong to
[[PUR-002 Purchase receiving]], and numbering is settled by [[DEC-018]]. None of
these is an unrecorded shortcut, so creating a debt record would duplicate a
Decision or a Story rather than surface new risk.

## Decisions / ADRs

- Accepted Decision records govern this Story (accepted 2026-09-26):
  - [[DEC-012]] — purchase aggregate shape and the draft-versus-receive
    validation gate: required `supplierId`, at least one line, strictly positive
    quantities and the moment catalog-item state is checked.
  - [[DEC-013]] — purchase line cost and tax structure: the line's single
    optional informational unit cost and the absence of a tax rate, a computed
    line total or a purchase total.
  - [[DEC-015]] — purchase cancellation and the correction boundary: `CANCELLED`
    is reachable only from `DRAFT` and a `RECEIVED` purchase is corrected only
    by a future reversal.
  - [[DEC-016]] — suppliers/purchases permission keys, role matrix and
    entitlement gating: the `purchases.*` keys, the roles that hold them and the
    absence of an entitlement gate.
  - [[DEC-017]] — suppliers/purchases audit scope: exactly one co-committed row
    per accepted purchase mutation.
  - [[DEC-018]] — purchase numbering: the aggregate carries no human-readable
    number.
  - [[DEC-019]] — purchase draft editability and status-conditional
    immutability: a `DRAFT` deletes while a `RECEIVED` or `CANCELLED` purchase
    and its lines do not.
- An ADR is not expected: the draft aggregate introduces no architecture change
  that the complexity budget gates.

## Resolved by Decision

- **Purchase numbering** — answered by [[DEC-018]]: the aggregate carries no
  human-readable number, so there is no number column, no sequence and no
  allocation step.
- **Required shape and optionality** — answered by [[DEC-012]]: `supplierId` is
  required, a saved draft has at least one line, and a line quantity is strictly
  positive.
- **Cost and tax** — answered by [[DEC-013]]: a line carries one optional
  informational unit cost and no tax rate, computed line total or purchase
  total.
- **Cancellation reachability** — answered by [[DEC-015]]: `CANCELLED` is
  reachable only from `DRAFT`, and a `RECEIVED` purchase is immutable and is
  corrected only by a future reversal.
- **Draft editability versus immutability** — answered by [[DEC-019]]: the
  delete ban is conditional on the purchase status, so a draft can drop a line
  while a confirmed or cancelled purchase cannot be deleted.
- **Permission keys and role matrix** — answered by [[DEC-016]]: the
  `purchases.*` keys exist with a fixed role matrix, and no entitlement gate
  applies.
- **Audit scope for draft changes** — answered by [[DEC-017]]: purchase create,
  update and cancel each write exactly one co-committed audit row per accepted
  mutation.

## Open implementation details (inside approved scope)

The single item below is an implementation choice inside approved scope, decided
during this Story's implementation using the sibling modules as precedent.

1. **Concurrency and immutability guard.** Draft edits use an optimistic
   last-write-wins update; the conditional triggers enforce the immutability
   boundary, and no row lock is taken. A `RECEIVED` or `CANCELLED` status can
   never be observed mid-edit because receiving belongs to
   [[PUR-002 Purchase receiving]].

## Files / Modules

- `packages/database/prisma/schema.prisma` — the `PurchaseStatus` enum and the
  `Purchase`/`PurchaseLine` models.
- `packages/database/prisma/migrations/20260926000002_purchases/migration.sql` —
  the additive migration.
- `packages/database/src/schema-purchases.test.ts` — the schema gates.
- `apps/api/src/purchases/` — permissions, DTOs, Zod contracts, repository,
  service, controller and module.
- `apps/api/src/app.module.ts` — the `PurchasesModule` registration.
- `apps/api/test/support/in-memory-database.ts` — the purchase tables in the
  shared in-memory boundary.
- `apps/api/src/rbac/route-contract.probe.test.ts` — the route and permission
  pins.
- `packages/database/src/reference-seed.ts` — the four `purchases.*` permission
  keys and the role matrix.
- `apps/api/test/live-pg-isolation.e2e-spec.ts` — the live-PostgreSQL block.
- `docs/05-modules/Purchases.md` — the module documentation.
- `docs/01-roadmap/EPIC-11-Suppliers-Purchases.md` — the epic record.

## Completion Notes

Done for **implementation, ordinary verification and live-evidence scope**: the
data foundation, the five draft routes, the line-set reconciliation, the
conditional immutability, the audit rows and the durable live-PostgreSQL block
are all in place, and the checks this environment can run are green. This is
**not** a production-readiness statement: the work units are not pushed or
merged, and [[EPIC-11]] remains open for [[PUR-002 Purchase receiving]] and
[[PUR-003 Staff purchases surface]].
