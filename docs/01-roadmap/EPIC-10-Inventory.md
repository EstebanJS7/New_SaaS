---
id: EPIC-10
type: epic
title: Inventory
status: done
priority: high
depends_on:
  - EPIC-09
prd_sections:
  - "7"
  - "9"
  - "16"
  - "27"
  - "28"
  - "29"
  - "40"
  - "41"
created: 2026-09-25
updated: 2026-09-26
---

# EPIC-10 — Inventory

## Objective

Deliver PRD §16's stock ledger as a tenant-scoped, auditable Core domain:
`StockMovement` is the source of truth, `StockBalance` is a transactional
projection, inputs are positive and outputs negative, confirmed movements are
immutable, corrections are compensating movements, and the negative-stock policy
is a fixed `BLOCK`. This epic depends on [[EPIC-09]] Catalog/Taxes, because a
persisted, tenant-scoped item must exist before stock can hang off it, and it is
a prerequisite for [[EPIC-11]] Suppliers/Purchases and [[EPIC-12]] POS/Payments.

The first slice ships a standalone signed adjustment. Purchases, sales, cash,
locations and low-stock thresholds are explicitly later epics.

## Current state before implementation (verified 2026-09-25)

- No inventory code exists. `packages/database/prisma/schema.prisma` has no
  stock movement, balance or movement-type model; the only `stock` matches are
  the seeded `inventory.stock.transfer` permission and the `inventory` feature
  code.
- The composite tenant-ownership target already exists: `CatalogItem` exposes
  `@@unique([tenantId, id])`, the same key `Appointment.serviceId` already
  targets ([[CAT-005 Appointment service link]]).
- Money/quantity precision already has a convention: `Decimal` columns with
  explicit database precision (`ClinicalWeight.quantity @db.Decimal(10, 3)`).
- The ledger/immutability baseline is already policy: engineering rules require
  `StockMovement` to be the auditable source of truth, `StockBalance` to be a
  projection, and corrections to be compensating movements
  (`docs/99-governance/ENGINEERING-RULES.md`, "Ledgers"), matching
  `docs/03-architecture/REVERSALS-CORRECTIONS.md`.
- The catalog data foundation deliberately left the stock dimension out and said
  so in the schema: "There is no stock flag ... — EPIC-10 owns stock"
  (`packages/database/prisma/schema.prisma`, catalog section comment). That
  comment and the two `schema-catalog.test.ts` gates that forbade the column
  were revised in W1, visibly and in place.

**Since that observation (2026-09-25):** W1 (the data foundation) is implemented
and unit-verified. The migration `20260925000003_inventory` adds the
`tracks_stock` column with a by-kind backfill, the `stock_movement_type` enum,
the `stock_movement` ledger and the `stock_balance` projection, and the two
`inventory.stock.*` permissions are seeded. **W2 (the adjustment surface) is now
implemented as well**: `POST /inventory/stock/adjustments` writes the movement,
upserts the projection and appends exactly one audit row in a single transaction
under the fixed `BLOCK` policy, and `GET /inventory/stock` plus
`GET /inventory/stock/movements` expose the tenant's balance and ledger with
allowlisted projections. **W3 (the live-PostgreSQL closure) is done locally**:
the two catalog migrations plus `20260925000003_inventory` are applied to a
local PostgreSQL 16.13 database, `db:live-verify` passes, and the live suite
reports **52/52**, including the EPIC-10 block. That block first exposed a
**real lost update** on the `BLOCK` race — two concurrent outputs both returned
`201` and the projection ended at `3.000` against a ledger sum of `-4.000` —
which the per-`(tenant, item)` advisory lock fixed; the same case now admits
exactly one output and asserts the projection equals the ledger's signed sum.

The documentation closure (this record, [[Inventory]], [[TD-016]]) is delivered
in the same local pass. The work is **not committed, pushed or merged**, so this
record is `review`, not `done` — see "Exit Criteria".

## Scope

- A per-item `tracksStock` boolean on `CatalogItem`, `true` by database default
  and backfilled by kind in the migration, that states whether an item
  participates in the stock ledger. The catalog create path applies the same
  by-kind default and the update path changes it on request (W1b), so the flag
  is settable and readable through the catalog API rather than only by
  migration.
- An immutable, tenant-scoped `StockMovement` ledger: signed quantities, a
  mandatory reason, a movement-type enum that starts at `ADJUSTMENT` only, a
  reserved compensating self-reference, and a database `BEFORE DELETE` trigger.
- A `StockBalance` transactional projection, one row per (tenant, item), that
  never goes negative.
- An adjustment command that writes the movement, updates the projection and
  appends one audit row in a single transaction, enforcing `BLOCK` atomically
  (W2).
- Tenant-safe reads of movements and balances with granular permissions (W2).
- Live-PostgreSQL isolation, immutability and concurrency evidence (W3).

## Out of Scope

- **Purchases and receiving** ([[EPIC-11]]).
- **Sales/POS stock validation, cash movements and idempotent `CompleteSale`**
  ([[EPIC-12]]).
- **Transfers and any location, Branch or Warehouse surface.** Transfers stay
  deferred until Branch or Warehouse has a real surface;
  `inventory.stock.transfer` stays seeded but is not consumed.
- **Low-stock thresholds and alerts** ([[EPIC-18]]).
- **A tenant-configurable negative-stock policy.** The policy is fixed `BLOCK`
  with no `inventory` settings namespace yet.
- **`SERVICE` ↔ Appointment linkage** — already shipped in [[EPIC-09]].
- **Hard delete of any ledger row.**

## Tasks

- [x] W1: Data foundation — `CatalogItem.tracksStock` with the negative-gate
      revision, the `StockMovement` and `StockBalance` models, the additive
      migration (composite FK, CHECKs, no-delete trigger, compensating link),
      `schema-inventory.test.ts`, the two new permission keys and matrix, and
      the seed-count probe update.
- [x] W1b (2026-09-26): Catalog write path — `tracksStock` accepted by the
      create and update contracts, defaulted by kind on create (`SERVICE` false,
      the physical kinds true), honored when supplied, changed on update, and
      exposed in the allowlisted item DTO, with focused catalog coverage.
      Removes the "backfill only" limitation recorded by W1.
- [x] W2: Adjustment surface — `POST /inventory/stock/adjustments` (signed,
      co-committed audit, balance update, BLOCK enforcement), the balance and
      movement reads, route pins, tenant-safe repository, HTTP integration and
      cross-tenant 404 evidence.
- [x] W3: Live-PostgreSQL isolation/concurrency evidence for the ledger
      (immutability trigger, balance atomicity, BLOCK race) and documentation
      closure. Evidence: the `EPIC-10 inventory application-path isolation`
      block in `apps/api/test/live-pg-isolation.e2e-spec.ts` (five cases, inside
      the 52/52 local live suite), plus [[Inventory]] and [[TD-016]]. Delivery
      is still open: the work is uncommitted.

## Acceptance Criteria

- [x] `CatalogItem` carries a non-null `tracksStock` boolean mapping to
      `tracks_stock`, with a database default and a by-kind backfill
      (`PRODUCT`/`MEDICATION`/`SUPPLY` true, `SERVICE` false). Evidence:
      `packages/database/prisma/schema.prisma` (`model CatalogItem`),
      `packages/database/prisma/migrations/20260925000003_inventory/migration.sql`,
      `packages/database/src/schema-inventory.test.ts` and the revised gates in
      `packages/database/src/schema-catalog.test.ts`.
- [x] `StockMovement` is tenant-scoped, auditable, signed (positive in /
      negative out), created confirmed, immutable, and protected by a no-delete
      trigger; corrections are compensating movements. Evidence: the
      `stock_movement` DDL (composite `RESTRICT` item FK,
      `CHECK (quantity <> 0)`, `BEFORE DELETE` trigger raising
      `restrict_violation`) and the schema/model gates in
      `schema-inventory.test.ts`.
- [x] `StockBalance` is a transactional projection, one row per (tenant, item),
      and can never go negative. Evidence: the `stock_balance` DDL
      (`@@unique([tenantId, catalogItemId])`, composite `RESTRICT` item FK,
      `CHECK (quantity >= 0)`).
- [x] The movement-type enum contains only `ADJUSTMENT`; purchases, sales,
      transfers and reversals are reserved and not representable yet. Evidence:
      the pinned `CREATE TYPE "stock_movement_type" AS ENUM ('ADJUSTMENT')`
      assertion.
- [x] `inventory.stock.adjust` and `inventory.stock.read` are seeded with the
      decided matrix: OWNER/ADMIN/INVENTORY_MANAGER hold both, while
      VETERINARIAN/RECEPTIONIST/CASHIER hold only `inventory.stock.read`;
      `inventory.stock.transfer` keeps its EPIC-01 ownership. Evidence:
      `packages/database/src/reference-seed.ts` and its reconciled suite
      (permission row-volume pin 32 → 34).
- [x] `tracksStock` is enforced on the write path: a movement referencing a
      non-tracking or foreign item is rejected and persists nothing (W2).
      Evidence: the ACTIVE/`tracksStock` gate and the shared `404` in
      `apps/api/src/inventory/inventory.service.ts`, plus the HTTP cases in
      `inventory.integration.test.ts`.
- [x] The adjustment command enforces `BLOCK` atomically with the balance update
      and one audit row (W2). Evidence: the single `$transaction` in
      `InventoryService.adjust` and the balance/audit assertions in
      `inventory.integration.test.ts`. The read-modify-write is serialized per
      `(tenant, item)` by
      `pg_advisory_xact_lock(hashtextextended(stockSerializationLockKey(tenantId, itemId), 0))`,
      taken BEFORE the projection read: the HTTP suite pins the key and its
      order, and the live-PG race case proves the interleaving (exactly one
      `201`, one `409`, and a projection equal to the ledger's signed sum).
- [x] Cross-tenant item ids are a byte-equivalent `404` identical to an unknown
      id, with nothing persisted (W2). Evidence: `expectCrossTenant404` on both
      the adjustment command and the item-filtered movement read, plus the
      live-PG case "masks another tenant's item id as a byte-equivalent 404 on
      write and read, leaving the owner's ledger untouched".
- [x] Live-PostgreSQL isolation/concurrency evidence (W3), observed **locally**
      on 2026-09-25. Evidence: the
      `EPIC-10 inventory application-path     isolation` block in
      `apps/api/test/live-pg-isolation.e2e-spec.ts` inside the 52/52 live suite
      — signed adjustment co-commit, the fixed `BLOCK` rejection and the
      exactly-zero acceptance, the concurrent-overdraw race under a proven
      transaction-scoped overlap, raw-SQL rejection at the `BEFORE DELETE`
      trigger / the `CHECK`s / the composite FK, and the byte-equivalent
      cross-tenant `404`. Local, not CI: no run exists on a pushed commit. See
      `docs/10-qa/CI-EVIDENCE.md`, "EPIC-10 Local Closure Evidence
      (2026-09-25)".

## Decided

Maintainer decisions of 2026-09-25, unchanged by the implementation slices.

- **Stock is tenant-wide.** There is no location, Branch or Warehouse dimension;
  transfers are deferred until one of those has a real surface.
  `inventory.stock.transfer` stays seeded (EPIC-01 ownership) and is consumed by
  no route.
- **`tracksStock` is a manual, staff-editable boolean on `CatalogItem`.** The
  column defaults to `true` at the database, the migration backfills historical
  rows by kind (`PRODUCT`/`MEDICATION`/`SUPPLY` true, `SERVICE` false), and the
  inventory write path gates on it. Since W1b (2026-09-26) the catalog write
  path applies the same rule instead of relying on the column default: a create
  that omits the flag stores the kind default, an explicit create value wins in
  either direction, an update that omits the key leaves the stored value
  untouched, and a present update value changes it. The allowlisted item DTO
  exposes the flag, so the earlier "the catalog HTTP contract does not expose
  the column" limitation no longer holds.
- **The first slice is a signed standalone adjustment** (opening/adjustment),
  with the movement, the balance and exactly one audit row co-committed. No
  purchases, sales, locations or cash.
- **The negative-stock policy is a fixed `BLOCK`.** There is no `inventory`
  tenant-settings namespace and no tenant-configurable alternative.
- **Quantity is `Decimal(10,3)`** (fractional quantities, mirroring
  `ClinicalWeight.quantity`), signed, and never zero.
- **The movement-type enum starts at `ADJUSTMENT` only.**
  `PURCHASE`/`SALE`/`TRANSFER_*`/`*_REVERSAL` are reserved for
  [[EPIC-11]]/[[EPIC-12]] and added additively then.
- **Movements are created confirmed and immutable**, with a database
  `BEFORE DELETE` trigger and no update semantics; a correction is a
  compensating movement through the reserved nullable `reversesMovementId`
  self-FK, which this slice never populates.
- **`StockBalance` is one row per `(tenant, item)`**, updated in the same
  transaction, with `CHECK (quantity >= 0)`.
- **Permissions** `inventory.stock.adjust` (OWNER/ADMIN/INVENTORY_MANAGER) and
  `inventory.stock.read` (all six roles), mirroring the catalog shape.
- **Stock mutations serialize per `(tenant, item)` through a transaction-scoped
  advisory lock**, and every future stock writer MUST acquire
  `stockSerializationLockKey(tenantId, catalogItemId)` before touching
  `stock_balance`. The binding protocol and the stronger-shape debt are recorded
  in [[Inventory]] and [[TD-016]].

## Exit Criteria

- [x] The implementation work units are committed, pushed and merged with a CI
      run green on both required checks. Merged as PR #66
      (`feat/epic-10-inventory` → `main`, merge commit `ee558a7`) with CI run
      36249268114 green on both "Database migrations" and "Lint, Typecheck,
      Test, Build".
- [x] The durable live-PostgreSQL isolation/concurrency evidence for the ledger
      passed **locally**. Evidence: the local run of 2026-09-25 —
      `pnpm --filter @newsaas/api test:live-pg` reported 1 file / **52 tests
      passed** against a disposable PostgreSQL 16.13 database, including the
      `EPIC-10 inventory application-path isolation` block and the
      concurrent-overdraw race that first exposed the lost update and now proves
      the fix. The same suite passed in CI run 36249268114 after the merge.
- [x] The root and focused quality gates are green at the epic level. Evidence:
      `pnpm --filter @newsaas/database build|test|typecheck`,
      `pnpm --filter @newsaas/api test|typecheck|lint`,
      `pnpm exec prettier --check` and `git diff --check` — local runs (see
      [[CAT-006]] and [[CAT-007]]); `pnpm format-check` clean.
- [x] Documentation is current: this epic, the inventory module documentation,
      the module index entry, the changelog, the CI-evidence section and the
      roadmap note. Evidence: [[Inventory]], `docs/05-modules/README.md`,
      `docs/09-releases/CHANGELOG.md`, `docs/10-qa/CI-EVIDENCE.md` and
      `docs/01-roadmap/ROADMAP.md`.
- [x] Decisions and debt are recorded: the "Decided" section above and
      [[TD-016 Inventory stock serialization protocol]].

`status: done` means epic implementation closure only: the work units are merged
as PR #66, the required CI checks are green, and the live-PostgreSQL evidence is
recorded. It is **not** a production-readiness statement — [[EPIC-20]]
Production Hardening and the open Tech Debt items ([[TD-016]], [[TD-007]])
remain.

## Technical Debt

- [[TD-016 Inventory stock serialization protocol]] — the ledger's correctness
  now depends on every future stock writer ([[EPIC-11]] purchases, [[EPIC-12]]
  POS) acquiring `stockSerializationLockKey` before touching `stock_balance`; a
  self-enforcing row-level guard is the stronger long-term shape and requires
  extending the shared in-memory boundary.

## Stories

- [[CAT-006 Inventory foundation]] — W1, the data foundation slice.
- [[CAT-007 Inventory adjustment API]] — W2, the adjustment command and the
  balance/movement reads.

## Verification evidence

- W1: `pnpm --filter @newsaas/database build`, `test`, `typecheck`, `db:deploy`,
  `db:seed`, `pnpm exec prettier --check` and `git diff --check` — see
  [[CAT-006 Inventory foundation]] for the observed results.
- W1b (local, 2026-09-26): `pnpm --filter @newsaas/database build`,
  `pnpm --filter @newsaas/api test`, `typecheck`, `lint`,
  `pnpm --filter @newsaas/database test`, `pnpm exec prettier --check` and
  `git diff --check` — see [[CAT-006 Inventory foundation]] for the observed
  results.
- W2: `pnpm --filter @newsaas/database build`,
  `pnpm --filter @newsaas/api test`, `typecheck`, `lint`,
  `pnpm --filter @newsaas/database test`, `pnpm exec prettier --check` and
  `git diff --check` — see [[CAT-007 Inventory adjustment API]] for the observed
  results.
- W3 (local, 2026-09-25): the two catalog migrations plus
  `20260925000003_inventory` applied to the local PostgreSQL 16.13 database; the
  reference seed idempotent; `db:live-verify` passed; the live-PostgreSQL suite
  reported **52/52 passed**, including the
  `EPIC-10 inventory application-path isolation` block and the
  concurrent-overdraw race that first exposed the lost update and now proves the
  advisory-lock fix. See `docs/10-qa/CI-EVIDENCE.md`, "EPIC-10 Local Closure
  Evidence (2026-09-25)". No CI run exists: the work is uncommitted.
