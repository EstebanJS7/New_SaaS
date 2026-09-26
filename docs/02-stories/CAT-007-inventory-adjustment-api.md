---
id: CAT-007
type: story
title: Inventory adjustment API
epic: EPIC-10
status: in-progress
priority: high
depends_on:
  - EPIC-09
  - CAT-006
prd_sections:
  - "16"
  - "18"
  - "28"
  - "29"
  - "40"
  - "41"
permissions:
  - inventory.stock.read
  - inventory.stock.adjust
branch: main
created: 2026-09-25
updated: 2026-09-25
---

# CAT-007 — Inventory adjustment API

## Objective

Deliver the EPIC-10 **adjustment surface** (work unit W2): the signed stock
adjustment command that turns W1's empty ledger into a working stock system, the
two tenant-scoped reads that expose it, and the tenant-safe repository seam the
later purchase/sale commands will reuse.

A positive quantity is an input and a negative one an output. The movement
insert, the balance upsert and exactly ONE audit row commit in a single
transaction, and the fixed `BLOCK` negative-stock policy is enforced before
anything is written. Movements are created confirmed and are immutable: this
Story adds no update, no patch and no delete route.

## What shipped

| Layer         | Change                                                                                                                                                                                                                                                                                 |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Command       | `POST /inventory/stock/adjustments` (`inventory.stock.adjust`) — signed adjustment: in-tenant item resolution, `tracksStock` + active gate, BLOCK, one transaction, one audit.                                                                                                         |
| Reads         | `GET /inventory/stock` and `GET /inventory/stock/movements` (`inventory.stock.read`) with allowlisted INTERNAL projections.                                                                                                                                                            |
| Repository    | `InventoryRepository` — tenant-safe seam over the ledger, the projection and the catalog-item identity; no update and no delete operation anywhere.                                                                                                                                    |
| Serialization | `InventoryRepository.lockItemStock` — the transaction-scoped `pg_advisory_xact_lock(hashtextextended(stockSerializationLockKey(tenantId, catalogItemId), 0))` taken BEFORE the projection read, serializing the `BLOCK` pre-check and the absolute balance write per `(tenant, item)`. |
| Module        | `InventoryModule` registered in `app.module.ts` (Portal stays last); Context + Rbac + Audit imported, no entitlement gate.                                                                                                                                                             |
| Pins          | The inventory routes and their per-route `inventory.stock.*` keys are pinned in the route-contract probe (exact inventory set equality).                                                                                                                                               |
| Test double   | `stockMovement` / `stockBalance` delegates, the `tracksStock` catalog column and the two new tables in the shared in-memory boundary.                                                                                                                                                  |
| Tests         | `inventory.integration.test.ts` — ten HTTP cases over the REAL guard chain (happy path, BLOCK, cross-tenant 404 on both write and read, non-tracking/inactive, permissions, read allowlists, invalid bodies, immutability).                                                            |

## In Scope

- `apps/api/src/inventory/` — permissions, DTOs, Zod contracts, repository,
  service, controller and module.
- `apps/api/src/app.module.ts` — the `InventoryModule` registration.
- `apps/api/src/rbac/route-contract.probe.test.ts` — the route inventory and the
  per-route permission pin.
- `apps/api/test/support/in-memory-database.ts` — the two stock delegates, the
  catalog `tracksStock` dimension and the ledger/projection tables.
- This Story and the epic record.

## Out of Scope

- **Purchases and receiving** (EPIC-11), **sales/POS stock validation, cash
  movements and idempotent `CompleteSale`** (EPIC-12).
- **Transfers and any location/Branch/Warehouse surface.**
  `inventory.stock.transfer` stays seeded but unconsumed.
- **The reversal command.** `reversesMovementId` stays nullable and unpopulated;
  a correction is a later compensating movement though the same seam.
- **Low-stock thresholds** (EPIC-18) and **a tenant-configurable negative-stock
  policy** — the policy is a fixed `BLOCK` with no `inventory` settings
  namespace.
- **Staff UI and the web proxy** — a later slice.
- **`StockMovement` history editing, hard delete, and any `PATCH status=`
  route.**
- The Prisma schema, the W1 migration and the seed — untouched by this slice.

## Acceptance Criteria

- [x] `POST /inventory/stock/adjustments` requires `inventory.stock.adjust` and
      re-asserts it as defense in depth.
- [x] A positive quantity is an input and a negative one an output; the stored
      quantity is a signed exact `Decimal(10,3)` and never zero.
- [x] The item is resolved in the caller's tenant and must be an ACTIVE,
      `tracksStock === true` item.
- [x] A foreign or unknown item id is a byte-equivalent `404 NOT_FOUND`
      identical to an absent id, with nothing persisted.
- [x] A non-tracking item is
      `409 CONFLICT ("The catalog item does not track     stock.")` and an
      inactive item `409 CONFLICT ("The catalog item is     inactive.")`; both
      persist nothing.
- [x] The fixed `BLOCK` policy rejects an output that would drive the balance
      below zero with `409 CONFLICT` and persists nothing.
- [x] The movement insert, the balance upsert and exactly ONE audit row commit
      in the same transaction (or not at all).
- [x] The audit row carries stable ids and field NAMES only — the adjustment
      reason VALUE never reaches the trail.
- [x] The created movement is confirmed and immutable: no update, patch or
      delete route exists on the surface.
- [x] `GET /inventory/stock` and `GET /inventory/stock/movements` require
      `inventory.stock.read`; both project allowlisted INTERNAL DTOs with no
      Prisma model crossing the boundary.
- [x] The movement read narrows by item and resolves a supplied item id
      in-tenant, so a foreign id is the same byte-equivalent `404`.
- [x] No event is emitted: the ledger is correct without one.
- [x] The two route-level permission pins and the full route inventory are
      updated and green.
- [x] Concurrent outputs against ONE item cannot both commit: the `BLOCK`
      pre-check and the absolute balance write are one read-modify-write
      serialized per `(tenant, item)` by a transaction-scoped advisory lock, so
      exactly one output is admitted and the projection stays equal to the
      ledger's signed sum. Evidence: the lock/order pin in
      `inventory.integration.test.ts` and the live-PG race case (added
      2026-09-25 after the live suite first exposed the lost update).

## Domain Invariants

- **The ledger is the source of truth.** `StockMovement` records every change;
  the balance is a projection that can always be rebuilt from it.
- **Movements are immutable.** There is no update path and DELETE raises at the
  database; a correction is a future compensating movement.
- **Quantity is signed, never zero.** Positive is an input, negative an output;
  the contract and the database CHECK both reject zero.
- **Ownership is enforced twice.** The composite FK rejects a cross-tenant
  reference at the database; the service resolves the item through the
  tenant-safe repository, which renders one shared `404` for foreign and
  unknown.
- **The balance never goes negative.** The service's BLOCK pre-check is the rule
  and `CHECK (quantity >= 0)` is the last line of defence. The pre-check and the
  absolute balance write are ONE read-modify-write serialized per
  `(tenant, item)` by a transaction-scoped advisory lock, so under concurrency
  exactly one output is admitted and the projection always equals the ledger's
  signed sum.
- **One balance row per (tenant, item).** The upsert is keyed by the database's
  compound unique.
- **No location dimension.** Stock is tenant-wide until Branch or Warehouse has
  a real surface.

## Decided

- **Non-tracking and inactive items are `409 CONFLICT`, not `404` and not
  `400`.** The item EXISTS in the caller's tenant and the request is well
  formed; its own state forbids the command. A `404` would wrongly mask a real
  item and a `400` would misdescribe a state conflict, so this mirrors the
  scheduling/appointment illegal-state convention with two distinct stable
  messages.
- **BLOCK is `409 CONFLICT` with its own stable message.** Insufficient stock is
  a state conflict, not malformed input. The rule is evaluated on exact
  `Decimal` arithmetic INSIDE the transaction, so a rejection rolls back and
  leaves the ledger and the projection untouched.
- **The item-filtered read resolves the item in-tenant.**
  `GET /inventory/stock/movements?catalogItemId=` shares the command's
  resolution seam, so an unknown or FOREIGN item id is the SAME byte-equivalent
  `404` rather than a silently empty list. This is the read half of the
  cross-tenant-item-id contract; a filter value is a reference, and a reference
  that does not resolve in the tenant is not a "no results" case.
- **Quantities are projected as fixed-scale (3 decimals) strings.** The column
  scale is PINNED rather than derived from the value's text, because a real
  `DECIMAL` read trims trailing zeros while the test double returns the literal;
  padding both gives ONE canonical API spelling without ever rounding a digit
  (the catalog reference-price precedent).
- **The adjustment reason is stored on the immutable movement and named in
  audit.** The row is the durable record; the audit row carries
  `changedFields: ["quantity", "reason"]` and never the reason text or the
  quantity value (stable ids and field names only).
- **A blank reason is `400 VALIDATION_FAILED` before the transaction opens.**
  The column is `NOT NULL`, but an empty string would still be a missing reason,
  so the service rejects whitespace the way the clinical amendment does.
- **`InventoryModule` imports no other domain module.** It reads the catalog
  item identity it needs through its own tenant-safe delegate seam, so Core
  inventory never imports the Veterinary vertical or the catalog HTTP surface.
- **No event is emitted.** Nothing reacts post-commit in this slice, so an event
  would add coupling with no consumer (PRD §39: events only for decoupled
  post-commit reactions).
- **Stock commands serialize per `(tenant, item)` through a transaction-scoped
  advisory lock, taken BEFORE the projection is read.** The live-PostgreSQL race
  case proved that without it two concurrent outputs both read the pre-commit
  balance, both pass the pre-check and both write — admitting an overdraw AND
  leaving the projection different from the ledger's signed sum (the lost update
  recorded below). The lock is released automatically at transaction end, so a
  rolled-back adjustment leaves nothing locked, and the key scope keeps two
  tenants and unrelated items fully concurrent. This is the ledger's
  serialization protocol: every future stock writer ([[EPIC-11]] purchases,
  [[EPIC-12]] POS) MUST acquire
  `stockSerializationLockKey(tenantId, catalogItemId)` before touching
  `stock_balance` — recorded as [[TD-016]].

## API surface

| Method | Path                           | Permission               | Behavior                                                                          |
| ------ | ------------------------------ | ------------------------ | --------------------------------------------------------------------------------- |
| POST   | `/inventory/stock/adjustments` | `inventory.stock.adjust` | Signed adjustment; movement + balance + one audit row in one transaction; BLOCK.  |
| GET    | `/inventory/stock`             | `inventory.stock.read`   | The tenant's balances with item identity.                                         |
| GET    | `/inventory/stock/movements`   | `inventory.stock.read`   | The tenant's ledger, optionally narrowed by `catalogItemId` (resolved in-tenant). |

Routes are unprefixed (DEC-002). There is no update, patch or delete route
anywhere on this surface.

## Database

No schema, migration or seed change. This slice writes the W1 tables through
Prisma:

- `stock_movement` — one signed, non-zero `DECIMAL(10,3)` row per adjustment
  with a mandatory reason and a NULL `reverses_movement_id`.
- `stock_balance` — the `(tenant, item)` projection, upserted to the exact
  projected sum.

## Lost update found and fixed (2026-09-25)

W3's live-PostgreSQL `BLOCK` race case did not pass on first run: it exposed a
**real lost update** that the in-memory boundary could not represent.

|                                                            | Observed before the fix    | Observed after the fix                |
| ---------------------------------------------------------- | -------------------------- | ------------------------------------- |
| Two concurrent `-7.000` outputs against a `10.000` balance | both returned `201`        | exactly one `201`, one `409 CONFLICT` |
| `stock_balance.quantity`                                   | `3.000` (last write won)   | `3.000` (one committed output)        |
| Raw signed ledger sum                                      | `-4.000`                   | `3.000`                               |
| Movements / audit rows for the pair                        | two each (one per request) | one each                              |

Root cause: the `BLOCK` pre-check read the running balance and the balance was
then written as an **absolute** value. Under `READ COMMITTED` both requests read
the pre-commit balance and both wrote their own projected value, so the
projection stopped being the ledger's signed sum and the overdraw was admitted
while the projection still looked non-negative.

Fix: `InventoryService.adjust` now acquires
`pg_advisory_xact_lock(hashtextextended(stockSerializationLockKey(tenantId, itemId), 0))`
**before** reading the projection, so the pre-check and the write are one
serialized read-modify-write; the loser re-reads the committed balance and is
rejected by `BLOCK` before writing anything. The same case now asserts one
`201`, one `409`, one movement, one audit row, the projection equal to the
ledger's signed sum, and no negative balance. The local live suite is **52/52
green** as a result; see `docs/10-qa/CI-EVIDENCE.md`, "EPIC-10 Local Closure
Evidence (2026-09-25)".

## Tests Added

- `apps/api/src/inventory/inventory.integration.test.ts` — eleven HTTP cases:
  permission denial on every route with nothing persisted; the signed happy path
  (input then output, one projection row, one audit row per command, reason
  value absent from the trail); the BLOCK rejection from an empty balance and
  from a funded balance, plus the exactly-zero acceptance; the non-tracking and
  inactive `409` rejections; the byte-equivalent cross-tenant `404` on the
  command and on the item-filtered read; the balance read allowlist and item
  identity; the movement read allowlist, sign preservation and item narrowing
  with unknown-query rejection; eighteen invalid bodies with nothing persisted;
  the absent update/patch/delete routes; and the advisory-lock case that pins
  the exact `stockSerializationLockKey` and its order BEFORE the projection read
  (added with the 2026-09-25 fix).
- `apps/api/src/rbac/route-contract.probe.test.ts` — the three new routes in the
  exact-survival inventory and the per-route `inventory.stock.*` pin.
- `apps/api/test/live-pg-isolation.e2e-spec.ts` — the
  `EPIC-10 inventory application-path isolation` block (five cases), added by
  W3; the race case is the regression guard for the lost update.

## Verification

```text
pnpm --filter @newsaas/database build ... Prisma Client regenerated, tsc clean, client copied
pnpm --filter @newsaas/api test ........ all files; inventory.integration.test.ts 11 passed
pnpm --filter @newsaas/api typecheck ... clean (exit 0)
pnpm --filter @newsaas/api lint ........ clean (exit 0)
pnpm --filter @newsaas/database test ... green (13 files / 229 tests)
pnpm exec prettier --check <touched> ... all matched files use Prettier code style
git diff --check ....................... clean (exit 0)
```

The inventory HTTP tests run against the shared in-memory boundary, which
snapshots and restores its tables on a thrown transaction — so "nothing
persisted" is proven by observed table sizes, not assumed. The in-memory
boundary models `pg_advisory_xact_lock` as a no-op (a synchronous map cannot
interleave), so W3's live-PostgreSQL gate owns the real interleaving proof.

W3 local live evidence (2026-09-25): the three migrations applied to the local
PostgreSQL 16.13 database, the reference seed idempotent, `db:live-verify`
passed, and `pnpm --filter @newsaas/api test:live-pg` reported **52/52 passed**,
including the EPIC-10 block and the race case that exposed the lost update and
now proves the fix. See `docs/10-qa/CI-EVIDENCE.md`, "EPIC-10 Local Closure
Evidence (2026-09-25)". **No CI run exists**: the slice is uncommitted.

## Known Limitations

- **The live-PostgreSQL evidence is local and the fix is a convention.** W3's
  live-PG gate proved the delete trigger, the transactional atomicity and the
  `BLOCK` race on a local PostgreSQL 16.13 database, and it found and confirmed
  the advisory-lock fix — but no CI run exercises it, and the lock is only as
  strong as the writers that acquire it: nothing in the schema forces a future
  stock writer to take it. Recorded as [[TD-016]].
- **`tracksStock` is not enforced by the database.** The write-path gate is
  application-level: a raw SQL insert could reference a non-tracking item. The
  composite FK still keeps the item in-tenant.
- **The in-memory boundary cannot represent row locks or `CHECK` enforcement.**
  It models the advisory lock as a no-op, so the application-path suite pins the
  lock's existence, key and order only; the real serialization proof is
  live-PostgreSQL-owned.
- **No reversal command.** `reversesMovementId` is reserved and always NULL; a
  wrong adjustment cannot yet be compensated through the API.
- **The work is not committed, pushed or merged.** This slice awaits the parent
  transaction's review and commit decision.

## Next Step

W3 is delivered locally: the live-PostgreSQL ledger block (the `BEFORE DELETE`
trigger, balance atomicity, the `BLOCK` race) is green inside the 52/52 suite
and the epic documentation ([[Inventory]], the epic record, [[TD-016]]) is
written. The only open item is delivery: this slice is **not committed, pushed
or merged**, so the parent transaction owns the commit decision and CI remains
the durable form of this evidence once pushed.

## Files / Modules

- `apps/api/src/inventory/inventory.permissions.ts` — the `inventory.stock.*`
  contract.
- `apps/api/src/inventory/inventory.dto.ts` — the allowlisted projections.
- `apps/api/src/inventory/inventory.zod.ts` — the strict body/query contracts.
- `apps/api/src/inventory/inventory.repository.ts` — the tenant-safe seam.
- `apps/api/src/inventory/inventory.service.ts` — the reads and the adjustment.
- `apps/api/src/inventory/inventory.controller.ts` — the three routes.
- `apps/api/src/inventory/inventory.module.ts` — the module.
- `apps/api/src/inventory/inventory.integration.test.ts` — the HTTP cases.
- `apps/api/src/app.module.ts` — the registration.
- `apps/api/src/rbac/route-contract.probe.test.ts` — the route/permission pins.
- `apps/api/test/support/in-memory-database.ts` — the shared test double.
- `docs/01-roadmap/EPIC-10-Inventory.md` — the epic record.
