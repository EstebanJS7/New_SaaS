---
type: module
module: inventory
status: implemented
updated: 2026-09-26
---

# Module — Inventory

## Responsibility

A tenant-scoped, ledger-based stock system for the Core Business domain (PRD
§16): `StockMovement` is the auditable source of truth, `StockBalance` is a
transactional projection with exactly one row per `(tenant, item)`, quantities
are signed (a positive value is an input, a negative one an output), movements
are created confirmed and immutable, corrections are compensating movements, and
the negative-stock policy is a fixed `BLOCK`.

The module owns three HTTP routes: the signed adjustment command that writes the
ledger, and two tenant-scoped reads that expose the projection and the ledger.
It performs no purchase, sale, transfer, cash, invoice or fiscal operation, and
it owns no location dimension — stock is tenant-wide.

Every movement and balance is anchored to one tenant and one in-tenant
`CatalogItem`; nothing is read or written outside the server-side request
context. Data classification: stock quantities, adjustment reasons and item
identity are **INTERNAL**.

## Does Not Own

- **Purchases and receiving** — [[EPIC-11]] Suppliers/Purchases.
- **Sales/POS stock validation, cash movements and idempotent `CompleteSale`** —
  [[EPIC-12]] POS/Payments.
- **Transfers and any location, Branch or Warehouse surface.** Transfers stay
  deferred until Branch or Warehouse has a real surface; the seeded
  `inventory.stock.transfer` permission is not consumed by any route.
- **Low-stock thresholds and alerts** — [[EPIC-18]] Dashboards/Reports.
- **A tenant-configurable negative-stock policy.** The policy is a fixed
  `BLOCK`; there is no `inventory` tenant-settings namespace.
- **The reversal command.** `reversesMovementId` is reserved and always `null`.
- **Hard delete of any ledger row.** A `BEFORE DELETE` trigger rejects it.
- **Catalog administration.** `tracksStock` lives on `CatalogItem` and is owned
  by the Catalog module; Inventory only reads it as a write-path gate.
- **The catalog item's price, tax rate or currency.** No monetary value is read
  or projected here.

## Public Capabilities

- Apply one **signed** stock adjustment to an in-tenant, ACTIVE, stock-tracking
  item, with the movement insert, the balance upsert and exactly one audit row
  co-committed in a single transaction under the fixed `BLOCK` policy.
- Read the tenant's stock projection (`StockBalance`) with item identity.
- Read the tenant's immutable movement ledger, optionally narrowed to one item.
- An authenticated staff HTTP surface behind allowlisted INTERNAL DTOs, with
  per-route granular permissions and defense-in-depth service re-assertion.

## Main Entities

- `StockMovementType` — database enum `stock_movement_type`, pinned to
  `ADJUSTMENT` only. `PURCHASE`, `SALE`, `TRANSFER_*` and the `*_REVERSAL`
  compensations arrive additively with the epics that own their commands.
- `StockMovement` — the immutable ledger. `id`, `tenantId`, `catalogItemId`,
  `type` (`ADJUSTMENT`), `quantity` `DECIMAL(10,3)` **signed** with
  `CHECK (quantity <> 0)`, `reason` `TEXT NOT NULL`, nullable
  `reversesMovementId`, timestamps. `@@unique([tenantId, id])`, lookup indexes
  on `(tenantId, catalogItemId)` and `(tenantId, reversesMovementId)`.
- `StockBalance` — the transactional projection. `id`, `tenantId`,
  `catalogItemId`, `quantity` `DECIMAL(10,3)` with `CHECK (quantity >= 0)`,
  timestamps. `@@unique([tenantId, catalogItemId])`, so exactly one row per
  pair.
- `CatalogItem.tracksStock` — the stock dimension, owned by Catalog: non-null
  `Boolean @default(true)` mapped to `tracks_stock` (see "Stock tracking gate").

Physical guarantees (migration `20260925000003_inventory`):

| Guarantee              | Shape                                                                                                    |
| ---------------------- | -------------------------------------------------------------------------------------------------------- |
| Tenant scope           | `RESTRICT` tenant FK on both tables                                                                      |
| Ownership is composite | `(tenant_id, catalog_item_id) -> catalog_item(tenant_id, id)` `RESTRICT` on both tables                  |
| Compensating link      | `(tenant_id, reverses_movement_id) -> stock_movement(tenant_id, id)` `RESTRICT`, reserved and `null` now |
| Signed, non-zero       | `stock_movement_quantity_non_zero` `CHECK ("quantity" <> 0)`                                             |
| Never negative         | `stock_balance_quantity_non_negative` `CHECK ("quantity" >= 0)`                                          |
| Immutability           | `stock_movement_no_delete_trigger` (`BEFORE DELETE`) raises `restrict_violation`                         |

The trigger raises `stock movements are immutable and cannot be hard-deleted`.
There is deliberately **no** `UPDATE` trigger and no update semantics at all:
the application issues no update and a correction is a compensating movement,
never an edit.

## State Transitions

There are none. A movement is **created confirmed**: the ledger has no `status`,
draft or lifecycle column, so an unconfirmed movement is unrepresentable.

```text
(no state machine)
  StockMovement  --insert only-->  immutable forever
  StockBalance   --upsert in the same transaction as its movements-->
```

## Stock tracking gate (`tracksStock`)

`CatalogItem.tracksStock` (`tracks_stock`) states whether an item participates
in the ledger. Implemented behavior, stated precisely:

- Column: `BOOLEAN NOT NULL DEFAULT true` in the migration, with the schema
  default `Boolean @default(true)`.
- The migration **backfills pre-existing rows by kind**:
  `UPDATE "catalog_item" SET "tracks_stock" = ("kind" <> 'SERVICE')`, so
  `PRODUCT`/`MEDICATION`/`SUPPLY` become `true` and `SERVICE` becomes `false`.
- The inventory **write path gates on it**: an adjustment for an item whose
  `tracksStock` is `false` is `409 CONFLICT` with the stable message
  `"The catalog item does not track stock."`, and nothing is persisted. A
  deactivated item is the sibling `409 CONFLICT`
  `"The catalog item is inactive."`.
- The catalog **write path applies and exposes the by-kind rule** (catalog
  write-path follow-up to [[CAT-006]]): `POST /catalog` accepts an optional
  `tracksStock` and, when the caller omits it, stores the kind default —
  `SERVICE` → `false`, and `PRODUCT`/`MEDICATION`/`SUPPLY` → `true`. That is the
  same predicate as the migration backfill (`kind <> 'SERVICE'`), so a row
  created after the migration and a backfilled row agree. The database default
  `true` is never relied upon, because it would silently make a new `SERVICE` a
  tracking item.
- The flag is a **manual, staff-editable boolean**: `PUT /catalog/:id` accepts
  `tracksStock`, an omitted key leaves the stored value untouched, and a present
  boolean changes it in either direction (an explicitly tracked `SERVICE`, an
  explicitly untracked `PRODUCT`). It is part of the allowlisted item DTO, so a
  caller can read back exactly what the write path stored. The staff browser
  toggle that surfaces it is a separate follow-up; the API is the authority
  today.

Only an ACTIVE, `tracksStock === true` in-tenant item can receive movements. The
gate is application-level: the database keeps the item in-tenant through the
composite FK but does not enforce `tracks_stock` on insert.

## Permissions

Two keys are declared by this boundary and seeded by `PERMISSION_SEEDS`; the
role matrix is the W1 decision (2026-09-25):

| Role                | `inventory.stock.read` | `inventory.stock.adjust` |
| ------------------- | :--------------------: | :----------------------: |
| `OWNER`             |           ✓            |            ✓             |
| `ADMIN`             |           ✓            |            ✓             |
| `INVENTORY_MANAGER` |           ✓            |            ✓             |
| `VETERINARIAN`      |           ✓            |                          |
| `RECEPTIONIST`      |           ✓            |                          |
| `CASHIER`           |           ✓            |                          |

- `inventory.stock.read` — `GET /inventory/stock`,
  `GET /inventory/stock/movements`.
- `inventory.stock.adjust` — `POST /inventory/stock/adjustments`.

Each route declares its single key with `@RequirePermissions` **and**
`InventoryService` re-asserts it before any data access, so a missing permission
is `403 FORBIDDEN` and persists nothing. Route-by-route pins live in
`apps/api/src/rbac/route-contract.probe.test.ts`
(`INVENTORY_PERMISSION_BY_ROUTE`). `inventory.stock.transfer` stays seeded with
its EPIC-01 ownership and is deliberately not declared by any route here.

## API

All three routes are unprefixed per [[DEC-002]] and return allowlisted INTERNAL
DTOs; no Prisma model crosses the HTTP boundary. The module is registered in
`apps/api/src/app.module.ts` (Portal stays last), imports Context, RBAC and
Audit, and has no entitlement gate — the stock ledger is a Core capability, not
a Veterinary feature.

| Route                               | Permission               | Contract                                                                                     |
| ----------------------------------- | ------------------------ | -------------------------------------------------------------------------------------------- |
| `GET /inventory/stock`              | `inventory.stock.read`   | The caller tenant's balances with the item's display identity.                               |
| `GET /inventory/stock/movements`    | `inventory.stock.read`   | The caller tenant's ledger; optional `catalogItemId` narrows it (resolved in-tenant).        |
| `POST /inventory/stock/adjustments` | `inventory.stock.adjust` | One signed adjustment (`201`); movement + balance + one audit row in one transaction; BLOCK. |

There is **no** update, `PATCH` or `DELETE` route anywhere on this surface. The
route-contract probe fences the absence explicitly.

### Response projections

`StockMovementResponse` (exactly these keys): `id`, `tenantId`, `catalogItemId`,
`type`, `quantity`, `reason`, `reversesMovementId`, `createdAt`, `updatedAt`.
`quantity` keeps its **sign**.

`StockBalanceResponse` (exactly these keys): `id`, `tenantId`, `catalogItemId`,
`item` (`{ name, kind }` only), `quantity`, `createdAt`, `updatedAt`. Items with
no balance row are absent from the list; a deactivated item with a balance keeps
rendering its identity, because the ledger is history rather than a live catalog
view.

### Read ordering and filters

- Balances are ordered by `catalogItemId` ascending; the item identity for every
  row is resolved from **one** tenant item read, never one query per row.
- Movements are ordered by `createdAt` then `id` ascending. The only accepted
  filter is `catalogItemId`; any other query key is `400 VALIDATION_FAILED`
  instead of being ignored.
- A supplied `catalogItemId` on the movement read is resolved in-tenant
  **first**, so an unknown or foreign UUID is the same byte-equivalent `404`
  rather than a silently empty list.

## Signed adjustment semantics

A positive quantity is an input, a negative one an output, and zero is not a
movement.

| Field           | Contract                                                                                                       |
| --------------- | -------------------------------------------------------------------------------------------------------------- |
| `catalogItemId` | Required UUID, resolved in the caller's tenant and gated on ACTIVE + `tracksStock`.                            |
| `quantity`      | Required exact **signed** decimal string, `^-?\d{1,7}(\.\d{1,3})?$`, never zero in any spelling (`0`, `-0.0`). |
| `reason`        | Required, 1..500 characters; a blank or whitespace-only reason is `400` before the transaction opens.          |
| Unknown keys    | Rejected (`400`, `.strict()`) — including `type` (fixed to `ADJUSTMENT`) and `tenantId` (server-resolved).     |

Rejection modes:

| Condition                                   | Result                                                                        |
| ------------------------------------------- | ----------------------------------------------------------------------------- |
| Foreign or unknown `catalogItemId`          | `404 NOT_FOUND`, `"Inventory item was not found."`, nothing persisted         |
| Item does not track stock                   | `409 CONFLICT`, `"The catalog item does not track stock."`, nothing persisted |
| Item is deactivated                         | `409 CONFLICT`, `"The catalog item is inactive."`, nothing persisted          |
| Output would drive the balance below zero   | `409 CONFLICT`, `"The adjustment would drive the stock balance below zero."`  |
| Malformed body, zero quantity, blank reason | `400 VALIDATION_FAILED`, nothing persisted                                    |

Non-tracking and inactive are `409 CONFLICT`, not `404` and not `400`: the item
exists in the caller's tenant and the request is well formed, but its own state
forbids the command. A `404` would wrongly mask a real item and a `400` would
misdescribe a state conflict.

## Negative-stock policy (fixed `BLOCK`)

- The rule is a deterministic pre-check on the running projection, evaluated
  with exact `Prisma.Decimal` arithmetic **inside** the transaction; the
  database's `CHECK (quantity >= 0)` is the last line of defence, not the
  primary rule.
- An output that lands **exactly on zero** is accepted, and the projection row
  survives at `0.000`. Only a negative result is rejected.
- A rejection rolls the whole transaction back: no movement, no balance change
  and no audit row.
- The policy is fixed. There is no `inventory` tenant-settings namespace and no
  tenant-configurable alternative.

## Concurrency and the serialization protocol

The invariant that needs serialization is a read-modify-write on the projection:
the `BLOCK` pre-check reads the running balance, and the balance is then written
as an **absolute** value. Under `READ COMMITTED` two concurrent outputs would
both read the pre-commit balance, both pass the pre-check and both write their
own projected value — admitting an overdraw **and** leaving the projection
different from the ledger's signed sum (a lost update).

The protocol implemented by `InventoryService.adjust` is:

1. Resolve the item in-tenant and assert ACTIVE + `tracksStock`.
2. Acquire the transaction-scoped advisory lock for the `(tenant, item)` scope
   **before** reading the projection:
   `SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))::text`, where
   `lockKey = stockSerializationLockKey(tenantId, catalogItemId)` =
   `"<tenantId>:<catalogItemId>"`
   (`apps/api/src/inventory/inventory.repository.ts`).
3. Read the balance, compute the projected sum with exact `Decimal` arithmetic
   and apply the fixed `BLOCK` policy.
4. Insert the movement, upsert the absolute balance and append exactly one audit
   row — all in the same transaction.

PostgreSQL arbitrates the order: the loser parks on the lock, and once the
winner commits the loser re-reads the **committed** balance in its own next
statement and is rejected by `BLOCK` before writing anything. The lock is
released automatically at transaction end, so a rolled-back adjustment leaves
nothing locked. Key scope is `(tenant, item)`: two tenants never contend and
unrelated items stay fully concurrent.

**Protocol contract (binding on later slices).** This is the ledger's
serialization protocol, not an optimization. Every future stock writer —
[[EPIC-11]] purchases/receiving and [[EPIC-12]] POS/sales — **MUST** acquire the
same `stockSerializationLockKey(tenantId, catalogItemId)` before reading or
writing `stock_balance`. A writer that skips it reintroduces the lost update.
The stronger long-term shape (a self-enforcing row-level guard such as
`SELECT … FOR UPDATE` or an atomic guarded `updateMany`) requires extending the
shared in-memory boundary and is recorded as [[TD-016]].

The shared in-memory test boundary models `pg_advisory_xact_lock` as a no-op
because a synchronous map cannot interleave, so the real serialization proof is
live-PostgreSQL-owned. The HTTP integration suite pins the lock's existence, its
exact key and its order relative to the projection read.

## Canonical decimal representation

Every decimal this boundary projects is an exact **fixed-scale three-decimal
string**, produced by the single `decimalToFixedScaleString` helper
(`apps/api/src/inventory/inventory.service.ts`).

- Both columns are `DECIMAL(10,3)` and the write contract caps a submitted
  quantity at three decimals, so the projection **pads but never rounds** a
  stored digit.
- The scale is pinned rather than taken from each value's own text because the
  two persistence paths disagree about padding for the same stored value: a real
  `DECIMAL` read arrives through Prisma's `Decimal`, which trims trailing zeros
  (`"10.000"` → `"10"`), while the in-memory boundary returns the literal
  verbatim. Pinning gives clients ONE canonical spelling in both environments.
- The forward scale is mirrored by the sign: an input projects as `"10.000"` and
  an output as `"-4.000"`.

## Audit

Every accepted adjustment appends **exactly one** audit row through
`AuditWriter` **inside the same transaction** as the movement and the balance,
carrying stable ids and field **names** only:

| Action                   | `targetType`     | Metadata                                                      |
| ------------------------ | ---------------- | ------------------------------------------------------------- |
| `stock_movement.created` | `stock_movement` | `{ schemaVersion: 1, changedFields: ["quantity", "reason"] }` |

The adjustment reason **value** and the quantity value never reach the trail —
the reason is stored on the immutable movement, which is the durable record. The
read operations append nothing.

## Events / Jobs

- **None.** No inventory event, job or queue message is emitted, and the public
  schema carries no event/outbox/queue/job table — the live evidence asserts
  this. The ledger is correct without a post-commit reaction (PRD §39: events
  only for decoupled post-commit reactions).

## Invariants

- **The ledger is the source of truth.** `StockMovement` records every change;
  `StockBalance` is a projection that can always be rebuilt from it. Every
  acceptance in the live suite compares the projection with the raw signed sum
  of its movements.
- **Movements are immutable.** There is no update path, no delete route, and
  `DELETE` raises at the database. A correction is a compensating movement
  through the reserved `reversesMovementId`.
- **Quantity is signed and never zero.** Positive is an input, negative an
  output; the contract and the database `CHECK` both reject zero.
- **The balance never goes negative.** The serialized `BLOCK` pre-check is the
  rule and `CHECK (quantity >= 0)` is the last line of defence.
- **One balance row per (tenant, item).** The upsert is keyed by the database's
  compound unique, so a balance is replaced, never accumulated.
- **Ownership is enforced twice.** The composite `(tenant_id, catalog_item_id)`
  FK rejects a cross-tenant reference at the database; the service resolves the
  item through the tenant-safe repository, which renders one shared `404` for a
  foreign and an unknown id.
- **The movement, the projection and the audit row are one atomic unit.** No
  reader may observe a movement without its co-committed balance and trail row.
- **No location dimension.** Stock is tenant-wide.

## Security / tenant rules

- Tenant identity comes only from the server-side `RequestContextService`; a
  route-, query- or body-supplied `tenantId` is never trusted and is rejected as
  an unknown key.
- The repository resolves the tenant via `requireTenantId()` (which fails closed
  with `FORBIDDEN` when no tenant authority was resolved) and places it in the
  payload **last**, so a rogue runtime property cannot re-scope a row. The
  balance upsert uses the compound unique key, so it can never address another
  tenant's row.
- A foreign **or** unknown item UUID is one shared message behind a
  byte-equivalent `404`, on the command and on the item-filtered read alike,
  with nothing persisted.
- Permission checks are enforced by the route guard and re-asserted by the
  service; a missing permission is `403` and reaches no data access.
- No CONFIDENTIAL or RESTRICTED payload is read, written, projected or logged.

## Known Limitations / Residual Risks

- **Every future stock writer must take the lock by convention.** The
  `(tenant, item)` advisory lock is only as strong as the writers that acquire
  it; nothing in the schema forces a writer to take it. Recorded as [[TD-016]].
- **`tracksStock` is not enforced by the database.** The write-path gate is
  application-level: a raw SQL insert could reference a non-tracking item. The
  composite FK still keeps the item in-tenant.
- **No reversal command.** `reversesMovementId` is reserved and always `NULL`; a
  wrong adjustment cannot yet be compensated through the API.
- **The adjustment reason is unbounded in the database.** `reason` is `TEXT`;
  the 500-character bound lives in the API contract only.
- **The serialization lock is not proven by the in-memory boundary.** The shared
  test double models the advisory lock as a no-op, so the application-level
  suite pins the lock's existence, key and order only; the real interleaving
  proof is the live-PostgreSQL block (see "Verification").
- **No staff UI and no web proxy.** The module is API-only in this slice.
- **The item read loads all tenant items** for the balance identity map (one
  query, no per-row join); it is not paginated. Acceptable at MVP tenant scale,
  and a pagination decision belongs to its own slice.
- **The migration is proven applied and inspected on local PostgreSQL only.** No
  CI run exists for this work: nothing is committed, pushed or merged.

## Verification

- `packages/database/src/schema-inventory.test.ts` — the EPIC-10 textual gates:
  the tables and enum, the exact `ADJUSTMENT` enum literal, the `tracks_stock`
  column and its by-kind backfill, additive-only migration statements with no
  `INSERT`, the tenant and composite item FKs, the signed-quantity and reason
  columns, the reserved compensating self-FK, the non-negative balance with its
  unique key, the delete-rejecting trigger with no update trigger, the absence
  of location/float dimensions, and the INTERNAL classification.
- `apps/api/src/inventory/inventory.integration.test.ts` — 11 HTTP cases over
  the real guard chain: the permission sweep with nothing persisted, the signed
  happy path (movement + one projection row + one audit row per command, reason
  value absent from the trail), the fixed `BLOCK` rejection from an empty and
  from a funded balance plus the exactly-zero acceptance, the non-tracking and
  inactive `409` rejections, the byte-equivalent cross-tenant `404` on the
  command and on the item-filtered read, the balance and movement read
  allowlists with sign preservation and item narrowing, the invalid-body sweep,
  the absent update/patch/delete routes, and the advisory-lock key/order pin.
- `apps/api/src/rbac/route-contract.probe.test.ts` — the three routes in the
  exact survival inventory and `INVENTORY_PERMISSION_BY_ROUTE`.
- `apps/api/test/live-pg-isolation.e2e-spec.ts` → "EPIC-10 inventory
  application-path isolation" (five cases inside the 52-case live suite): a
  signed adjustment co-committing one immutable movement, the exact projection
  and exactly one audit row; the `BLOCK` policy persisting nothing on rejection
  and accepting an output that lands exactly on zero; the concurrent-overdraw
  race admitting exactly one output under a proven transaction-scoped overlap;
  raw-SQL rejection at the immutability trigger, the non-negative balance CHECK,
  the non-zero quantity CHECK and the composite tenant-ownership FK; and another
  tenant's item id as a byte-equivalent `404` with the owner's ledger untouched.
- Local closure run (2026-09-25, **local**, not CI): the two catalog migrations
  plus `20260925000003_inventory` applied; the reference seed idempotent;
  `db:live-verify` passed; the live-PostgreSQL suite reported **52/52 passed**.
  See `docs/10-qa/CI-EVIDENCE.md`, "EPIC-10 Local Closure Evidence
  (2026-09-25)".

The live race case first exposed a **real lost update** — two concurrent outputs
both returned `201` and the projection ended at `3.000` while the ledger sum was
`-4.000` — and the per-`(tenant, item)` advisory lock is what fixed it. The same
case now asserts exactly one `201`, one `409`, a projection equal to the
ledger's signed sum, one movement and one audit row; see [[CAT-007]].

## Related Stories

- [[CAT-006 Inventory foundation]] — W1: the `tracksStock` column, the ledger
  and projection models, the additive migration and the two permission keys.
- [[CAT-007 Inventory adjustment API]] — W2: the adjustment command, the reads,
  the tenant-safe repository and the serialization fix.

## Related ADRs

- [[ADR-001 Modular Monolith]]

## Related Decisions

- [[DEC-002]] — unprefixed route paths.
- No dedicated Decision record exists for the fixed `BLOCK` policy or the
  tenant-wide (location-free) scope: both were maintainer decisions of
  2026-09-25 recorded in [[EPIC-10]] Inventory under "Decided".
