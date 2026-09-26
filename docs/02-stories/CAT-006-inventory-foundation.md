---
id: CAT-006
type: story
title: Inventory foundation
epic: EPIC-10
status: in-progress
priority: high
depends_on:
  - EPIC-09
prd_sections:
  - "7"
  - "9"
  - "16"
  - "27"
  - "40"
  - "41"
permissions:
  - inventory.stock.read
  - inventory.stock.adjust
branch: main
created: 2026-09-25
updated: 2026-09-26
---

# CAT-006 — Inventory foundation

## Objective

Deliver the EPIC-10 **data foundation** (work unit W1) that PRD §16's stock
ledger stands on: the `tracksStock` catalog dimension, the immutable
tenant-scoped `StockMovement` ledger, the `StockBalance` transactional
projection, the additive migration that creates them, the textual schema gates
that pin the DDL, and the two `inventory.stock.*` permissions.

This Story is the persistence slice only. It adds no API route, controller, DTO,
service, module registration or UI — that is W2 — and it performs no stock
arithmetic beyond the database CHECKs. It deliberately adds no data seed: the
ledger is created empty.

## What shipped

| Layer       | Change                                                                                                                                                                                                                                                       |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Catalog     | `CatalogItem.tracksStock` — non-null `Boolean @default(true)`, mapped to `tracks_stock`. The one stock dimension on the catalog. The catalog create/update contracts accept it, the service defaults it by kind on create and the item DTO exposes it (W1b). |
| Enum        | `StockMovementType` with **only** `ADJUSTMENT`; `PURCHASE`/`SALE`/`TRANSFER_*`/`*_REVERSAL` are reserved for EPIC-11/EPIC-12.                                                                                                                                |
| Ledger      | `StockMovement` — tenant-scoped, signed `Decimal(10,3)` quantity with `CHECK (quantity <> 0)`, mandatory `reason`, nullable composite `reversesMovementId` self-FK, `@@unique([tenantId, id])`.                                                              |
| Projection  | `StockBalance` — one row per (tenant, item), `Decimal(10,3)` quantity with `CHECK (quantity >= 0)`.                                                                                                                                                          |
| Migration   | `20260925000003_inventory` — additive: one column + by-kind backfill, the enum, two tables, the CHECKs, the composite FKs, the indexes and the `BEFORE DELETE` trigger. No `INSERT`.                                                                         |
| Permissions | `inventory.stock.read` and `inventory.stock.adjust` seeded; matrix OWNER/ADMIN/INVENTORY_MANAGER hold both, VETERINARIAN/RECEPTIONIST/CASHIER hold only `read`.                                                                                              |
| Gates       | `schema-inventory.test.ts` (new EPIC-10 blocks) and the deliberately revised negative gates in `schema-catalog.test.ts`.                                                                                                                                     |

## In Scope

- `packages/database/prisma/schema.prisma` — `CatalogItem.tracksStock`, its
  ledger back-references, the `Tenant` back-references, the `StockMovementType`
  enum and the `StockMovement` / `StockBalance` models.
- `packages/database/prisma/migrations/20260925000003_inventory/migration.sql` —
  the additive migration.
- `packages/database/src/schema-inventory.test.ts` — the EPIC-10 textual gates
  (appended to the pre-existing EPIC-01 tenancy block; see "Known Limitations").
- `packages/database/src/schema-catalog.test.ts` — the two revised negative
  gates.
- `packages/database/src/reference-seed.ts` and `reference-seed.test.ts` — the
  two new permission keys, the matrix and the reconciled row-volume pin.
- `docs/01-roadmap/EPIC-10-Inventory.md`, the `ROADMAP.md` row, and this Story.

## Out of Scope

- **Every HTTP surface.** No route, controller, DTO, service, module
  registration, web proxy or UI. `POST /inventory/stock/adjustments` and the
  movement/balance reads are W2.
- **Stock arithmetic.** No balance update logic, no BLOCK enforcement, no
  negative-stock validation beyond the `CHECK (quantity >= 0)`.
- **Purchases, sales/POS, transfers, cash movements, locations/Branch/Warehouse,
  low-stock thresholds, a tenant-configurable negative-stock policy.** Later
  epics.
- **Data seeding of ledger rows.** The migration inserts no rows.
- **The catalog module's runtime code, the catalog migration and the appointment
  service link** — untouched.

## Acceptance Criteria

- [x] `CatalogItem.tracksStock` is a non-null boolean with a database default,
      mapping to `tracks_stock`, backfilled by kind in the migration
      (`PRODUCT`/`MEDICATION`/`SUPPLY` true, `SERVICE` false).
- [x] `StockMovement` is tenant-scoped through a composite
      `(tenant_id, catalog_item_id) -> catalog_item(tenant_id, id)` FK with
      `ON DELETE/UPDATE RESTRICT`, and carries `@@unique([tenantId, id])` plus a
      `(tenant_id, catalog_item_id)` lookup index.
- [x] `StockMovementType` contains only `ADJUSTMENT`.
- [x] A movement quantity is a signed `Decimal(10,3)` with
      `CHECK (quantity <> 0)` and a mandatory `reason`.
- [x] `reversesMovementId` is a nullable composite self-FK with `RESTRICT`,
      reserved for later compensating reversals and never populated here.
- [x] Movements are immutable: a `BEFORE DELETE` trigger raises
      `restrict_violation`, and the schema declares no update semantics.
- [x] `StockBalance` has `@@unique([tenantId, catalogItemId])`, a composite
      `RESTRICT` item FK and `CHECK (quantity >= 0)`.
- [x] The migration is additive and seeds no rows.
- [x] `schema-inventory.test.ts` pins the enum, tenant scope, composite FK,
      signed-quantity CHECK, balance CHECK, delete trigger, compensating self-FK
      and the `RESTRICT` catalog links.
- [x] The two `schema-catalog.test.ts` negative gates are revised deliberately
      and visibly (the stock dimension is now pinned as present in the schema
      gate; the catalog migration stays stock-free), not loosened.
- [x] `inventory.stock.adjust` and `inventory.stock.read` seed with the decided
      matrix; `inventory.stock.transfer` keeps its EPIC-01 ownership; the
      permission row-volume pin moved 32 → 34.
- [x] The catalog write path applies the same by-kind rule instead of leaning on
      the column default: create accepts an optional `tracksStock` and stores
      the kind default when the caller omits it, an explicit value wins in
      either direction, update changes it when supplied and leaves it untouched
      when omitted, and the allowlisted item DTO exposes it (W1b, 2026-09-26).
      Evidence:
      `apps/api/src/catalog/{catalog.zod,catalog.service,catalog.repository,catalog.dto}.ts`
      and the focused catalog suites.
- [x] W2: adjustment surface and reads — delivered by [[CAT-007]] (W2), which
      owns those criteria.
- [x] W3: live-PostgreSQL isolation/concurrency closure — delivered locally by
      [[CAT-007 Inventory adjustment API]] (W3): the three migrations applied to
      a local PostgreSQL 16.13 database, `db:live-verify` passed and the live
      suite reported 52/52, including the EPIC-10 ledger block. No CI run
      exists; the work is uncommitted, so story closure still awaits delivery.

## Domain Invariants

- **The ledger is the source of truth.** `StockMovement` records every change;
  `StockBalance` is a projection that can always be rebuilt from it.
- **Movements are immutable.** There is no update path and DELETE raises; a
  correction is a compensating movement through `reversesMovementId`.
- **Quantity is signed, never zero.** Positive is an input, negative an output,
  and the database rejects zero.
- **Ownership is enforced twice.** The composite FK rejects a cross-tenant
  reference at the database; the W2 service re-asserts tenant context.
- **The balance never goes negative.** `CHECK (quantity >= 0)` is the last line
  of defence for the fixed `BLOCK` policy; the primary rule is W2's atomic
  command.
- **No location dimension.** Stock is tenant-wide until Branch or Warehouse has
  a real surface.

## Decided

- **`tracksStock` defaults by kind on the catalog write path.** The column
  defaults to `true` and the migration backfills the historical rows
  deterministically (`kind <> 'SERVICE'`), while the catalog create path now
  applies the same by-kind rule (`SERVICE` false, `PRODUCT`/`MEDICATION`/
  `SUPPLY` true) whenever the caller omits the flag, so the database default is
  never the rule that decides a new item's stock dimension. This is the
  maintainer's manual, staff-editable flag: an explicit create value wins in
  either direction, an update that omits the key leaves the stored value
  untouched, a present value changes it, and the allowlisted item DTO exposes
  it. The write-path follow-up (W1b, 2026-09-26) removed the earlier "by-kind
  rule applies to the migration backfill only" limitation; the inventory
  negative gates are untouched.
- **The movement-type enum ships only `ADJUSTMENT`.** Adding the reserved values
  before their commands exist would let the database represent states no
  application path can create or validate; they arrive additively with the epics
  that own them.
- **The compensating link is a composite self-FK, not a plain one.** A reversal
  must reference a movement of the SAME tenant, so the FK is
  `(tenant_id, reverses_movement_id) -> stock_movement(tenant_id, id)`, which is
  also why `@@unique([tenantId, id])` exists on the ledger.
- **Immutability is enforced by trigger, not by convention.** The
  `catalog_item_no_delete` precedent is mirrored exactly: a `BEFORE DELETE`
  trigger raises `restrict_violation`, and no `UPDATE` trigger is declared
  because the ledger has no update semantics at all.
- **No data seed.** The migration is pure DDL plus the required column backfill;
  a seeded movement would be a second, silently diverging source of truth.
- **The catalog gates are revised in place.** The schema gate now pins
  `tracksStock` as present instead of forbidding `tracks_stock`, while the
  catalog migration gate keeps forbidding it (that migration is historical) and
  `tracks_inventory` stays rejected as a non-existent alias.
- **The `inventory.stock.*` permissions are seeded before their routes.** They
  mirror how the catalog keys were seeded ahead of their HTTP surface; the
  adjustment route lands in W2.
- **`StockBalance` is keyed by `(tenant, item)` with no surrogate natural key.**
  The projection is an upsert target, so a single row per pair is the invariant.

## Database

`20260925000003_inventory` adds, on `catalog_item`:

```sql
ALTER TABLE "catalog_item" ADD COLUMN "tracks_stock" BOOLEAN NOT NULL DEFAULT true;
UPDATE "catalog_item" SET "tracks_stock" = ("kind" <> 'SERVICE');
```

and creates:

```sql
CREATE TYPE "stock_movement_type" AS ENUM ('ADJUSTMENT');

CREATE TABLE "stock_movement" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "catalog_item_id" UUID NOT NULL,
  "type" "stock_movement_type" NOT NULL,
  "quantity" DECIMAL(10,3) NOT NULL,
  "reason" TEXT NOT NULL,
  "reverses_movement_id" UUID,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "stock_movement_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "stock_movement_quantity_non_zero" CHECK ("quantity" <> 0)
);

CREATE TABLE "stock_balance" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "catalog_item_id" UUID NOT NULL,
  "quantity" DECIMAL(10,3) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "stock_balance_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "stock_balance_quantity_non_negative" CHECK ("quantity" >= 0)
);
```

with `(tenant_id, id)` and `(tenant_id, catalog_item_id)` unique indexes, the
`RESTRICT` tenant and composite item FKs on both tables, the composite
`RESTRICT` compensating self-FK on `stock_movement`, and the
`stock_movement_no_delete` `BEFORE DELETE` trigger.

## Tests Added

- `packages/database/src/schema-inventory.test.ts` — twelve migration gates
  (tables and enum, the exact `ADJUSTMENT` enum literal, the `tracks_stock`
  column and its by-kind backfill, additive-only `ALTER TABLE` targets and no
  `INSERT`, the tenant FKs, the composite catalog FKs, the signed-quantity and
  reason columns, the compensating self-FK, the non-negative balance and its
  unique key, the immutability trigger with no update trigger, and the absence
  of location/float dimensions) plus six schema gates (the models, enum and
  mappings; `CatalogItem.tracksStock` and its back-references; the
  `StockMovement` scope, composite item FK and reserved self-FK; the
  `StockBalance` projection; the `Tenant` back-references; and the INTERNAL
  classification).
- `packages/database/src/schema-catalog.test.ts` — the two revised negative
  gates and their intentional comment.
- `packages/database/src/reference-seed.test.ts` — the inventory permission
  matrix assertion and the 32 → 34 row-volume pin, plus the updated VETERINARIAN
  exact array.

## Verification

```text
pnpm --filter @newsaas/database build ..... exit 0 (Prisma Client generated from the
                                           current schema, tsc clean, client copied)
pnpm --filter @newsaas/database test ...... 13 files; 229 passed (229) — the
                                           tenant-ownership count pin was
                                           reconciled (8 → 9) with maintainer
                                           authorization
pnpm --filter @newsaas/database typecheck . clean (exit 0)
pnpm --filter @newsaas/database db:deploy . applied `20260925000003_inventory`
                                           (19 migrations found, all applied)
pnpm --filter @newsaas/database db:seed ... exit 0
pnpm exec prettier --check <touched> ...... all matched files use Prettier code style
git diff --check .......................... clean (exit 0)
```

The bare `db:deploy`/`db:seed` invocations fail with
`Environment variable not found: DATABASE_URL` because Prisma does not auto-load
the repo-root `.env` when pnpm runs the script inside `packages/database`; CI
passes `DATABASE_URL` as an env var instead. Exported from the root `.env`, both
commands ran and the migration applied. A read-only query then confirmed the
live database: `stock_movement_type` is exactly `ADJUSTMENT`,
`catalog_item.tracks_stock` is `boolean NOT NULL DEFAULT true`, both quantity
CHECKs, both composite item FKs, the compensating self-FK and the
`stock_movement_no_delete_trigger` all exist, and the seeded matrix is
`inventory.stock.adjust -> ADMIN, INVENTORY_MANAGER, OWNER` and
`inventory.stock.read -> ADMIN, CASHIER, INVENTORY_MANAGER, OWNER, RECEPTIONIST, VETERINARIAN`.

These numbers remain the current pin after W2 and W3: neither slice added a case
to the `@newsaas/database` suite, so it is still **13 files / 229 tests** (the
229 cases counted in the 13 `packages/database/src/*.test.ts` files). W3's new
cases live in `apps/api/test/live-pg-isolation.e2e-spec.ts`, whose local run is
recorded in `docs/10-qa/CI-EVIDENCE.md`, "EPIC-10 Local Closure Evidence
(2026-09-25)".

W1b (2026-09-26, **local**, not CI) — the catalog write path:

```text
pnpm --filter @newsaas/database build ...... exit 0 (Prisma Client generated, tsc clean,
                                           client copied)
pnpm --filter @newsaas/api test ........... 70 files passed | 1 skipped (71);
                                           853 tests passed | 52 skipped (905), exit 0
pnpm --filter @newsaas/api typecheck ...... clean (exit 0)
pnpm --filter @newsaas/api lint ........... clean (exit 0)
pnpm --filter @newsaas/database test ...... 13 files; 229 passed (229), exit 0
pnpm exec prettier --check <touched> ...... all matched files use Prettier code style
git diff --check .......................... clean (exit 0)
```

The focused catalog suites were run first:
`apps/api/src/catalog/catalog.integration.test.ts` (20 cases, 18 → 20) and
`apps/api/src/catalog/catalog.repository.test.ts` (12 cases, 11 → 12) pass
32/32. A mutation probe — the by-kind default forced to `true` and the
repository's `tracksStock` forwarding removed — failed exactly the three new
assertions (`3 failed | 29 passed`) before the restore, so the new cases are not
vacuous. No schema, migration, seed, route, permission or web file was touched,
and no live-PostgreSQL change was required.

## Known Limitations

- **The schema-wide tenant-ownership count pin was reconciled with
  authorization.** `packages/database/src/schema-clinical.test.ts:189` pinned
  the count of `@@unique([tenantId, id])` keys to 8; `StockMovement` is the 9th,
  so the maintainer authorized the one-file edit and the pin now reads 9. The
  suite is green at 13 files / 229 tests.
- **`schema-inventory.test.ts` keeps its pre-existing EPIC-01 tenancy block.**
  The filename is a historical misnomer: the file already existed and contained
  the "migration 002 · tenancy core surface" gates, contrary to the slice
  assumption that it did not exist yet. The EPIC-10 gates were appended instead
  of overwriting that coverage.
- **The migration is proven applied and inspected on local PostgreSQL only.** No
  CI run, no commit, no push and no merge.

## Next Step

W2 and W3 are delivered (W3 locally): the adjustment command and the reads are
implemented, and the live-PostgreSQL ledger block is green inside the 52/52
suite — see [[CAT-007 Inventory adjustment API]]. This Story is the data
foundation slice and is complete for its own scope; it is **not committed,
pushed or merged**, so the parent transaction owns the commit decision.

## Files / Modules

- `packages/database/prisma/schema.prisma` — `CatalogItem.tracksStock`, the
  `StockMovementType` enum, `StockMovement`, `StockBalance` and the Tenant /
  CatalogItem back-references.
- `packages/database/prisma/migrations/20260925000003_inventory/migration.sql` —
  the additive migration.
- `packages/database/src/schema-inventory.test.ts` — the EPIC-10 gates.
- `packages/database/src/schema-catalog.test.ts` — the revised negative gates.
- `packages/database/src/reference-seed.ts` — the two new permission keys and
  the matrix.
- `packages/database/src/reference-seed.test.ts` — the matrix assertion and the
  row-volume pin.
- `docs/01-roadmap/EPIC-10-Inventory.md` — the epic record.
- `docs/01-roadmap/ROADMAP.md` — the EPIC-10 status row.
- W1b (2026-09-26): `apps/api/src/catalog/catalog.zod.ts`,
  `apps/api/src/catalog/catalog.service.ts`,
  `apps/api/src/catalog/catalog.repository.ts`,
  `apps/api/src/catalog/catalog.dto.ts`,
  `apps/api/src/catalog/catalog.repository.test.ts`,
  `apps/api/src/catalog/catalog.integration.test.ts` plus the reconciled
  [[Inventory]] and [[Catalog and Taxes]] sections and this Story's "Decided"
  record.
