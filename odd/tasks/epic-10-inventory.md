# EPIC-10 Inventory — planned scope and tracking

## Objective

Deliver EPIC-10 Inventory as a tenant-scoped, ledger-based stock system per PRD
§16: `StockMovement` is the auditable source of truth, `StockBalance` is a
transactional projection, inputs are positive and outputs negative, confirmed
movements are immutable, corrections are compensating movements, and the
negative-stock policy is BLOCK. The first slice ships a standalone signed
adjustment without purchases, sales, locations or cash.

## Problem and why

EPIC-09 delivered the catalog, so a persisted item now exists to hang stock off;
but nothing creates, reads or blocks stock, and PRD §16's ledger invariants are
unmet. Purchases (EPIC-11) and POS (EPIC-12) both depend on this ledger, and
neither can start until movements and balances exist.

## Decided (maintainer, 2026-09-25)

- **Location**: tenant-wide. Transfers are deferred until Branch or Warehouse
  has a real surface.
- **tracksStock**: a manual boolean on `CatalogItem`, defaulting by kind
  (`PRODUCT`/`MEDICATION`/`SUPPLY` true, `SERVICE` false), staff-editable.
- **First slice**: a signed adjustment (opening/adjustment) command with
  co-committed audit and balance update.
- **Negative stock**: fixed BLOCK, no `inventory` settings namespace yet.

## Settled implementation choices

- Quantity `Decimal(10,3)` (fractional quantities, mirrors `ClinicalWeight`).
- Movement-type enum starts with `ADJUSTMENT` only;
  `PURCHASE`/`SALE`/`TRANSFER_*`/`*_REVERSAL` are reserved for EPIC-11/12.
- Movements are created confirmed (no draft, no edit/delete); reversal is a
  compensating movement, with a nullable `reversesMovementId` self-FK reserved
  in the schema now and the reversal command later.
- `StockBalance` is one row per (tenant, item), updated in the same transaction,
  `CHECK (quantity >= 0)`.
- Permissions `inventory.stock.adjust` (OWNER/ADMIN/INVENTORY_MANAGER) and
  `inventory.stock.read` (all six roles, mirroring catalog).

## Out of scope

Purchases (EPIC-11); sales/POS stock validation, cash movements and idempotent
`CompleteSale` (EPIC-12); transfers and any location/Branch/Warehouse surface;
low-stock thresholds (EPIC-18); a tenant-configurable negative-stock policy;
`SERVICE`↔Appointment linkage (already shipped in EPIC-09); hard delete.

## Tasks

- [x] W1: Data foundation — `CatalogItem.tracksStock` with the negative-gate
      revision, the `StockMovement` and `StockBalance` models, the additive
      migration (composite FK, CHECKs, no-delete trigger, compensating link),
      `schema-inventory.test.ts`, the two new permission keys and matrix, and
      the seed-count probe update.
- [x] W2: Adjustment surface — `POST /inventory/stock/adjustments` (signed,
      co-committed audit, balance update, BLOCK enforcement), the balance and
      movement reads, route pins, tenant-safe repository, HTTP integration and
      cross-tenant 404 evidence.
- [x] W3: Live-PostgreSQL isolation/concurrency evidence for the ledger
      (immutability trigger, balance atomicity, BLOCK race) and documentation
      closure.

## Acceptance criteria and checks

- `StockMovement` is tenant-scoped, auditable, signed (positive in / negative
  out), created confirmed, immutable, and protected by a no-delete trigger;
  corrections are compensating movements.
- `StockBalance` is a transactional projection, one row per (tenant, item), and
  never goes negative under the BLOCK policy.
- `tracksStock` is a per-item boolean defaulting by kind; a movement referencing
  a non-tracking or foreign item is rejected and persists nothing.
- The adjustment command enforces BLOCK (rejecting an output that would drive
  the balance negative) atomically with the balance update and one audit row.
- Cross-tenant item ids are a byte-equivalent 404 identical to an unknown id,
  with nothing persisted.
- The two catalog negative gates are revised deliberately, and the new
  `schema-inventory.test.ts` gates pass.
- Focused and root checks are reported with exact commands; anything needing a
  live database is reported as unexecuted, not assumed.

## Progress

- Exploration: complete. No inventory code exists; `catalog_item` already
  exposes the composite FK target; `inventory.stock.transfer` is already seeded.
  Scope decided by the maintainer on 2026-09-25.
- Verification: pending.
- W1: `CatalogItem.tracksStock` added (default true, backfilled by kind), the
  `StockMovement` ledger and `StockBalance` projection models landed with the
  additive migration `20260925000003_inventory`, the two catalog negative gates
  were revised deliberately, `schema-inventory.test.ts` gained the EPIC-10
  gates, and `inventory.stock.adjust`/`inventory.stock.read` were seeded with
  the decided matrix (permission pin 32 → 34). The schema-wide tenant-ownership
  count pin was reconciled (8 → 9) with maintainer authorization. Database suite
  green at 13 files / 229 tests.
- W2: the inventory module shipped the signed adjustment command
  (`POST /inventory/stock/adjustments`, BLOCK, one transaction: movement +
  balance + one audit row), the balance and movement reads, the route and
  permission pins, and the tenant-safe repository, plus CAT-007. The live-PG
  block exposed and then fixed a genuine lost-update: two concurrent overdrawing
  outputs both won (201/201, balance 3.000 vs ledger -4.000) until the
  adjustment took a transaction-scoped per-(tenant,item) advisory lock; the
  suite is now 52/52.
- W3: documentation closed — module doc, evidence-mapped epic record (status
  `review`), roadmap note, CI-EVIDENCE local section, CHANGELOG and TD-016. A
  follow-up fix wired `tracksStock` through the catalog write path (by-kind
  default on create, staff-editable override, exposed in the read DTO), closing
  the gap where a new SERVICE would have defaulted to tracking.
- Next: delivery — commit, push and PR (mirroring EPIC-09), then flip EPIC-10 to
  `done` after the merge.

## Verification evidence

- W1: `db:build`, `test` (13 files / 229 tests), `typecheck`, `db:deploy`
  (migration `20260925000003_inventory` applied), `db:seed` (both permission
  keys seeded) and `git diff --check` all green. A read-only live-DB inspection
  confirmed the enum, `tracks_stock`, both quantity CHECKs, both composite FKs,
  the compensating self-FK and the no-delete trigger. `db:deploy`/`db:seed`
  required `DATABASE_URL` exported from the root `.env` (Prisma does not
  auto-load it inside the package dir).
- W2/W3: API suite 70 files / 853 tests passed with 52 live-PG skipped in the
  in-memory run; live-PG suite 52/52 against PostgreSQL 16.13, including the
  EPIC-10 block and the fixed BLOCK race; root `pnpm lint`, `pnpm typecheck`,
  `pnpm test` (web 489, database 229, api 853+52 skipped, worker 37, ui 36,
  shared 16), `pnpm build` (9 tasks) and `pnpm format-check` all green.
