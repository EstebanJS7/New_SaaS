---
id: PUR-002
type: story
title: Purchase receiving
epic: EPIC-11
status: done
priority: high
depends_on:
  - EPIC-10
  - SUP-001
  - PUR-001
prd_sections:
  - "7"
  - "9"
  - "16"
  - "17"
  - "27"
  - "28"
  - "29"
permissions:
  - purchases.receive
branch: feat/epic-11-purchase-receiving
created: 2026-09-26
updated: 2026-09-26
---

# PUR-002 — Purchase receiving

## Objective

Deliver PRD §17's receiving command: one explicit, tenant-scoped command that
atomically validates the purchase is `DRAFT`, creates the signed positive
`PURCHASE` stock movements through the [[EPIC-10]] ledger, updates the
`(tenant, item)` balances under the ledger's serialization protocol, marks the
purchase `RECEIVED` and writes audit — or persists nothing at all.

This is the only Story in [[EPIC-11]] with a stock effect, and it is the slice
that [[TD-016]] names as the next stock writer.

## Context

- PRD §17 states receiving is an explicit command and enumerates its atomic
  steps; it does not state whether a replayed command is a no-op or a conflict.
- PRD §27 lists "purchase receive" among the audited actions, so audit is
  required here even though supplier and draft administration may not be.
- The inventory ledger is binding: `StockMovement` is the auditable source of
  truth, quantities are signed (positive is an input), movements are created
  confirmed and immutable, and `StockBalance` is a transactional projection with
  one row per `(tenant, item)` and a `CHECK (quantity >= 0)`.
- The movement enum is pinned to `ADJUSTMENT` today. The schema comment states
  `PURCHASE` arrives additively with the epic that owns its command, so the enum
  extension belongs to this Story.
- `docs/05-modules/Inventory.md` and [[TD-016]] make the serialization protocol
  mandatory for every future stock writer: `InventoryRepository.lockItemStock` /
  `stockSerializationLockKey(tenantId, catalogItemId)` is acquired **before**
  reading or writing `stock_balance`.
- Purchases reference catalog items, so the same `tracksStock` and `isActive`
  gates the adjustment path applies may apply here; PRD §17 does not say.

## In Scope

- `packages/database/prisma/schema.prisma` — the additive `PURCHASE` value on
  the `stock_movement_type` enum. The purchase-side `purchase_status` column and
  models land in [[PUR-001 Purchase draft]].
- An additive migration extending the enum, plus the `schema-*.test.ts` gate
  update.
- `apps/api/src/purchases/` — the receiving command on the existing module:
  permission key, strict contract, transaction, DTO and controller.
- The ledger integration seam: signed positive movements via the [[EPIC-10]]
  repository, the per-`(tenant, item)` advisory lock, the balance projection
  update and the co-committed audit row, all in one transaction.
- `INVENTORY_PERMISSIONS` / movement-type consumption updates in the inventory
  module if the enum extension requires them.
- `apps/api/src/rbac/route-contract.probe.test.ts` — the receive route and its
  permission pin.
- `packages/database/src/reference-seed.ts` — the receive permission key and its
  role matrix, with the reconciled seed-count probe.
- Tenant isolation, atomicity, immutability and validation tests, plus
  live-PostgreSQL evidence for the receiving transaction.
- This Story and the epic record.

## Out of Scope

- **The draft lifecycle** — [[PUR-001 Purchase draft]]. This Story does not
  create or edit a draft; it consumes one.
- **Cash movements, cash sessions or cash close** — [[EPIC-13]]. Receiving
  writes no cash movement; EPIC-11 records no owed amount and no payment state.
- **Invoices, billing, fiscal documents and fiscal provider calls** —
  [[EPIC-14]], [[EPIC-15]] and [[EPIC-16]]. Receiving makes no external call and
  holds no database transaction open while waiting on one.
- **Purchase reversal or compensating movements** — PRD §40 names purchase
  reversal as a correction case, but this Story adds no reversal command.
  Accepted [[DEC-015]] states that a `RECEIVED` purchase is corrected only by a
  future reversal.
- **Partial receiving, partially received state or back-order state** — PRD §17
  defines no partial state.
- **Transfers, locations, Branches and Warehouses.** Stock stays tenant-wide.
- **Low-stock thresholds and alerts** — [[EPIC-18]].
- **Staff UI** — [[PUR-003 Staff purchases surface]].
- **A Decision record in `docs/07-decisions/`** — a separate slice outside this
  Story's file surface.

## Acceptance Criteria

- [x] Receiving is one explicit command, never a generic `PATCH status` write,
      and the only status it produces is `RECEIVED`. It ships as
      `POST /purchases/:id/receive` behind `purchases.receive`; no `PATCH` and
      no `DELETE` route exists on the purchase surface.
- [x] The command validates the purchase is `DRAFT`; a purchase that is already
      `RECEIVED` or is `CANCELLED` is `409 CONFLICT` and persists nothing. A
      replay is the same `409` with no idempotent short-circuit ([[DEC-014]]).
- [x] The command is atomic: stock movements, balance updates, the status change
      and exactly one audit row are co-committed in one transaction, and any
      rejection persists nothing — no movement, no balance change, no status
      change, no audit row.
- [x] Each received line creates exactly one signed **positive** `PURCHASE`
      `StockMovement` through the [[EPIC-10]] ledger seam; no balance is mutated
      outside the ledger, and no movement is created unconfirmed.
- [x] Every receiving write acquires
      `stockSerializationLockKey(tenantId, catalogItemId)` **before** reading or
      writing `stock_balance` ([[TD-016]]), and the projection equals the
      ledger's signed sum after the command. The purchase header row lock is
      taken **first** and the item advisory locks follow in ascending
      `catalogItemId` order ([[DEC-014]]).
- [x] `stock_movement_type` gains `PURCHASE` additively; existing `ADJUSTMENT`
      rows and behavior are unchanged, and no existing migration is rewritten.
- [x] The receiving command is audited with the actor, the purchase id and
      stable field names only (PRD §27); no CONFIDENTIAL/RESTRICTED payload is
      logged.
- [x] The purchase is resolved in the caller's tenant: a cross-tenant or unknown
      purchase UUID is one byte-equivalent `404`, and a cross-tenant reference
      is rejected identically and persists nothing.
- [x] The route enforces authentication, server-side tenant context and a
      granular permission, re-asserted by the service before data access; a
      missing permission is `403` and persists nothing.
- [x] The request body is a strict allowlisted contract that rejects unknown
      keys; `tenantId` is never read from body, query or route; no Prisma model
      crosses the HTTP boundary.
- [x] Replay behavior, line gates for non-tracking and inactive items, and the
      immutability of a `RECEIVED` purchase are fixed by the accepted and
      binding Decision records [[DEC-014]], [[DEC-012]] and [[DEC-015]]
      (accepted 2026-09-26), and the implemented command follows them with no
      invented idempotency or gating semantics.
- [x] The new permission key and role matrix are seeded, and the seed-count
      probe is reconciled: the seeded permission count moved 42 → 43, the
      [[DEC-016]] total.
- [x] Tenant isolation tests exist for the receiving path, authorization and
      validation tests cover the route, and the live-PostgreSQL suite proves
      atomicity, immutability, cross-tenant isolation and the `(tenant, item)`
      serialization race.
- [x] Required lint/typecheck/test checks pass.

## Domain Invariants

- **Receiving is the purchase's only stock effect.** A `DRAFT` purchase changes
  nothing; receiving is the single transition that writes stock.
- **Stock changes only through the ledger.** A movement is inserted confirmed
  and immutable; the balance is a projection updated in the same transaction;
  the projection never goes negative under the fixed `BLOCK` policy.
- **One serialized read-modify-write per `(tenant, item)`.** Concurrent
  receivers touching the same item must not lose an update; the advisory lock is
  the mechanism the ledger's correctness rests on ([[TD-016]]).
- **`RECEIVED` is immutable.** No edit, delete or cancel path returns a received
  purchase to `DRAFT`, and no purchase, line or movement is hard-deleted.
- **Every write belongs to exactly one tenant.** Tenant identity comes only from
  the server-side request context; a cross-tenant UUID is a `404`.
- **Atomicity is all-or-nothing.** A failed receive leaves no partial stock, no
  orphan movement and no audit row.

## API

### Added

```text
POST /purchases/:id/receive   →   purchases.receive
```

One explicit transition command on the existing `apps/api/src/purchases/`
module. It is the only new route: no `PATCH`, no `DELETE` and no generic status
write exist anywhere on the surface. The request body is a strict empty contract
— an absent or empty body is accepted, and any supplied key (including
`tenantId` or `status`) is rejected as `400 VALIDATION_FAILED`. A successful
receive returns the received `PurchaseResponse` (`201`); a non-`DRAFT` purchase
is the stable `409 CONFLICT`.

### Changed

```text
POST /inventory/stock/adjustments — unchanged.
stock_movement_type               — gains the additive PURCHASE value.
```

The existing inventory adjustment route and its behavior are unchanged; only the
movement-type enum gains a value.

## Database

### Migration

`20260926000003_purchase_receiving` — strictly additive: one
`ALTER TYPE "stock_movement_type" ADD VALUE 'PURCHASE'`. It alters no table, no
column and no existing row, rewrites no existing migration, and `ADJUSTMENT`
keeps its position and behavior. PostgreSQL 12+ permits `ALTER TYPE … ADD VALUE`
inside the migration transaction as long as the new value is not used in the
same transaction; the statement only adds it, so the plain single-statement form
applies cleanly on the supported PostgreSQL 16.

### Models/Tables

- `StockMovement.type` — gains `PURCHASE` (`stock_movement_type`). Quantity
  stays `DECIMAL(10, 3)`, signed, non-zero, immutable, with the no-delete
  trigger unchanged. A receive writes one positive `PURCHASE` movement per line.
- `StockBalance` — consumed through the existing `(tenant, item)` projection; no
  schema change. The receive updates it through the ledger seam only.
- The purchase tables are owned by [[PUR-001 Purchase draft]].

## UI

- None. [[PUR-003 Staff purchases surface]] owns the receive affordance.
- If UI is changed later, reusable components must use semantic branding tokens
  rather than project-specific literals.

## Implementation Summary

The explicit receiving command is implemented on branch
`feat/epic-11-purchase-receiving`.

**Data and seed.** Migration `20260926000003_purchase_receiving` appends
`PURCHASE` to `stock_movement_type` additively, and the `purchases.receive` key
joins `PERMISSION_SEEDS` with the [[DEC-016]] matrix (all six roles read;
`OWNER`, `ADMIN` and `INVENTORY_MANAGER` receive), moving the seeded permission
count 42 → 43. `packages/database/src/schema-inventory.test.ts` now pins the
effective enum literal set `{ADJUSTMENT, PURCHASE}` derived from the creating
migration plus the additive one, and the schema document.

**Command.** `POST /purchases/:id/receive` behind
`@RequirePermissions(PURCHASES_PERMISSIONS.receive)`, with the permission
re-asserted in the service. `PurchasesService.receive` runs one transaction:

1. it row-locks the purchase HEADER for the caller's tenant
   (`SELECT … FOR UPDATE`) and reads the status AFTER the lock, so a concurrent
   second receive of the SAME purchase parks on that row and is rejected;
2. it resolves and gates EVERY line in-tenant (ACTIVE and `tracksStock`),
   reusing the EPIC-10 `409` messages, before any stock work;
3. it acquires the ledger's per-`(tenant, item)` advisory locks in ascending
   `catalogItemId` order through the EPIC-10 seam;
4. it writes one positive `PURCHASE` movement and one balance projection per
   line through `createMovement` / `upsertBalance` (never directly), flips the
   status with a conditional `DRAFT`-only write as a backstop, and appends
   exactly one `purchase.received` audit row.

The global lock order is header first, then items ascending, for every receive,
so receives that share items cannot deadlock. A rejection — a replay, a
non-`DRAFT` purchase, a non-stockable line or a foreign/unknown id — rolls the
whole transaction back and persists nothing. The command reuses the EPIC-10
ledger seam and writes no cash, billing, fiscal or payment state.

**Defects found during the slice and fixed.** Two real defects were caught
before the slice merged, which is why the receiving path is trustworthy:

- **Double-receive race.** The `DRAFT` gate was read before any lock and the
  status write was unconditional, so two concurrent receives of the same
  purchase could apply a second movement set. The command now takes the purchase
  header row lock first and re-reads the status after the lock, so the loser is
  the stable `409` and persists nothing.
- **Broken row lock.** The live-PostgreSQL block caught a defect the
  single-threaded in-memory boundary could not mask: `lockById` compared the
  `uuid` columns against Prisma-bound `text` parameters, so PostgreSQL rejected
  the statement with `42883: operator does not exist: uuid = text` and every
  receive returned HTTP `500`. The statement now casts each bound value
  explicitly (`${tenantId}::uuid`, `${id}::uuid`), following the clinical and
  `manage-holdership` row-lock precedent, and the live receiving cases pass. The
  in-memory double masked it; the live suite caught it.

## Verification

```text
set -a && . ./.env && set +a && export DATABASE_URL_TEST="$(sed -n 's/^DATABASE_URL=//p' .env | cut -d'?' -f1)" &&
  pnpm --filter @newsaas/api test:live-pg
  → 1 file / 71 tests passed, including the 6-case
    `EPIC-11 purchase receiving application-path isolation` block (the suite
    held 65 before this slice).

pnpm --filter @newsaas/api test
  → 72 files passed, 1 skipped (73); 895 tests passed, 71 skipped (966).

pnpm --filter @newsaas/database test → 15 files / 268 tests passed.

pnpm --filter @newsaas/api typecheck → clean.
pnpm --filter @newsaas/api lint → clean.
pnpm format-check → All matched files use Prettier code style!
git diff --check → clean.

set -a && . ./.env && set +a && pnpm --filter @newsaas/database db:deploy
  → `20260926000003_purchase_receiving` applied; a re-run reports no pending
    migrations.
pnpm --filter @newsaas/database db:seed && node scripts/ci-seed-counts.mjs
  → permissions: 43.
```

The live block provisions a fresh disposable database, applies the migration and
the reference seed itself, uses no injected Prisma error, no mock, no sleep and
no retry, and rolls every raw-SQL probe back.

**Delivery (merged).** The work units are merged into `main` through pull
request #71 (`feat(EPIC-11): implement purchase receiving (PUR-002)`) as merge
commit `8862050` (`8862050c74f4dafa3518d4029c8becb778895979`), merged
`2026-09-27T04:16:17Z`. The required CI checks are green on the evaluated head
commit `edfa66c` (`edfa66cbcfbf514f97ed2a0fa657c04b0091ab1e`): run `36293559990`
concluded `success`, with `Database migrations` and
`Lint, Typecheck, Test, Build` both `SUCCESS`. This satisfies the Story's
delivery expectations: the work units are committed, pushed and merged with the
required checks green, and the merged CI receipt is recorded in
`docs/10-qa/CI-EVIDENCE.md`.

## Tests Added

- `packages/database/src/schema-inventory.test.ts` — the enum gate now pins the
  effective additive literal set `{ADJUSTMENT, PURCHASE}` (creating migration +
  additive migration) and the schema enum block, without weakening any other
  assertion in the file.
- `apps/api/src/purchases/purchases.integration.test.ts` — **25 tests** over the
  real guard chain, including the receive cases: permission denial persists
  nothing; a successful receive returns the received purchase with one positive
  `PURCHASE` movement and projection per line, the projected balance and exactly
  one `purchase.received` audit row; a replay, a `CANCELLED` and an
  already-`RECEIVED` purchase each return the stable `409` and persist nothing;
  an unknown or foreign id is the shared `404`; an inactive and a non-tracking
  line each return the reused `409` with nothing persisted (including the good
  line in a mixed draft); the strict body rejects unknown, `tenantId` and
  `status` keys; the header row lock is taken before any item lock; the
  header-race loser returns `409` with no second movement or audit row; and no
  `PATCH`/`DELETE` route exists.
- `apps/api/src/rbac/route-contract.probe.test.ts` — the receive route joins the
  exact survival inventory and `PURCHASES_PERMISSION_BY_ROUTE` with its
  `purchases.receive` pin.
- `apps/api/test/live-pg-isolation.e2e-spec.ts` — the
  `EPIC-11 purchase receiving application-path isolation` block, **6 tests**
  against the booted AppModule and a disposable real PostgreSQL: atomic receive
  with the projection equal to the ledger's signed sum and one audit row; the
  replay `409`; two concurrent receives of the SAME purchase under a PROVEN
  header-row-lock overlap admitting exactly one; the byte-equivalent
  cross-tenant and unknown `404`; the all-or-nothing line gate with the reused
  messages; and the applied additive enum plus the no-delete trigger rejecting a
  raw delete of a `PURCHASE` movement.

## Known Limitations

- **The in-memory suite cannot prove the concurrent interleaving.** The shared
  boundary is single-threaded, so the HTTP suite pins the header-lock ordering
  and the loser's observable outcome; the true race is proven by the
  live-PostgreSQL block, which holds the purchase header row lock in a dedicated
  transaction and asserts exactly one `201`, one `409`, one movement per line
  and exactly one `purchase.received` audit row across both attempts.
- **The movement `reason` is a fixed literal.** The ledger column is
  `TEXT NOT NULL` and the command takes no caller reason, so every `PURCHASE`
  movement records `"Purchase received"`. The ledger row carries no purchase
  identifier; the co-committed audit row identifies the purchase.
- **No partial receiving.** PRD §17 defines no partial state, so a receive
  applies every line or none.
- **Carried, pre-existing drift.** The purchase migration writes `updated_at`
  with a `DEFAULT CURRENT_TIMESTAMP`, so `prisma migrate diff` lists a
  `DROP DEFAULT` for two columns; that drift is repo-wide and pre-existing,
  `migrate status` is green and CI applies migrations rather than diffing.
- **No staff UI.** The receive affordance belongs to [[PUR-003]].
- **Two defects were found and fixed inside this slice; they are recorded as
  fixed, not as open problems.** A double-receive race (the `DRAFT` gate read
  before any lock, with an unconditional status write) was closed by the header
  row lock and the post-lock status re-read, and a `uuid`-versus-`text`
  comparison in `lockById` returned HTTP `500` on every receive until the
  explicit `::uuid` casts were added. The in-memory double masked the second
  defect; the live suite caught it. See the implementation summary above.

## Technical Debt

- **[[TD-016]] stays open.** The receiving writer now complies with the
  serialization protocol — it acquires
  `stockSerializationLockKey(tenantId, catalogItemId)` through the EPIC-10 seam
  before reading or writing `stock_balance` — but the debt is about the protocol
  being a convention rather than a database-enforced guarantee, and that is
  unchanged. The record is updated with this call site rather than silently
  closed.
- No new debt record is created: the live block now proves the concurrency,
  atomicity and immutability this Story owns.

## Decisions / ADRs

- Accepted Decision records govern this Story (accepted 2026-09-26):
  - [[DEC-012]] — purchase aggregate shape and the draft-versus-receive
    validation gate, which fixes the aggregate the receive command consumes and
    gates catalog-item state at receive rather than at draft save.
  - [[DEC-013]] — purchase line cost and tax structure, which fixes the
    informational unit cost, and the ledger receives no amount.
  - [[DEC-014]] — purchase receiving semantics — single-shot transition,
    all-or-nothing line gates and deterministic lock order, which fixes the
    replay as `409 CONFLICT`, the all-or-nothing line gates, the single
    transaction with exactly one audit row, and the ascending `catalogItemId`
    lock order.
  - [[DEC-015]] — purchase cancellation and the correction boundary for a
    received purchase, which fixes that a `RECEIVED` purchase is immutable and
    is corrected only by a future reversal rather than an edit.
  - [[DEC-016]] — suppliers/purchases permission keys, role matrix and
    entitlement gating, which fixes `purchases.receive`, the roles that hold it
    and the absence of an entitlement gate.
  - [[DEC-017]] — suppliers/purchases audit scope, which fixes the receive audit
    as exactly one co-committed row per accepted mutation.
- An ADR is not expected: the command preserves the ledger, the transaction
  model and the approved stack.

## Resolved by Decision

- **Replay and idempotency** — answered by [[DEC-014]]: a replayed receive is
  `409 CONFLICT` and persists nothing, with no idempotent short-circuit.
- **Line gates** — answered by [[DEC-014]]: every line must resolve in-tenant to
  an ACTIVE item with `tracksStock` true, otherwise the whole command fails with
  the same stable `409` messages the adjustment path uses; [[DEC-012]] fixes
  that this gate runs at receive, not at draft save.
- **Zero or negative line quantities** — answered by [[DEC-012]]: a line
  quantity is strictly positive and validated as an exact `Decimal(10, 3)`
  decimal string, so a zero or negative quantity is invalid rather than skipped.
- **Empty purchase** — answered by [[DEC-012]]: a saved draft has at least one
  line, so an empty purchase is not a receivable state.
- **Failure ordering and partial lines** — answered by [[DEC-014]]: the whole
  command fails with the rejected line's stable `409` message and persists no
  partial effect.
- **Audit shape** — answered by [[DEC-017]] and [[DEC-014]]: exactly one row per
  receive, carrying `action`, `targetType`, `targetId` and
  `metadata { schemaVersion, changedFields }` with stable ids and field names
  only, and no per-line rows.
- **Permission key and role matrix** — answered by [[DEC-016]]:
  `purchases.receive` is held by `OWNER`, `ADMIN` and `INVENTORY_MANAGER`, and
  no entitlement gate applies.
- **Lock scope per request** — answered by [[DEC-014]]: the per-`(tenant, item)`
  advisory locks are acquired in ascending `catalogItemId` order, which is part
  of the decision rather than an implementation detail.

## Files / Modules

- `packages/database/prisma/schema.prisma` — the extended `stock_movement_type`
  enum.
- `packages/database/prisma/migrations/20260926000003_purchase_receiving/` — the
  additive enum migration.
- `packages/database/src/schema-inventory.test.ts` — the enum gate.
- `apps/api/src/purchases/` — the receiving contract, service transaction,
  controller and DTO.
- `apps/api/src/inventory/inventory.repository.ts` — the reused `lockItemStock`
  / `stockSerializationLockKey` seam.
- `apps/api/src/rbac/route-contract.probe.test.ts` — the route and permission
  pin.
- `packages/database/src/reference-seed.ts` — the permission seed and matrix.
- `apps/api/test/live-pg-isolation.e2e-spec.ts` — the durable receiving
  evidence.
- `docs/01-roadmap/EPIC-11-Suppliers-Purchases.md` — the epic record.

## Completion Notes

Done for **implementation, ordinary verification and live-evidence scope**: the
additive enum migration, the `purchases.receive` seed, the explicit receive
command, the header-first lock order, the all-or-nothing line gate, the single
co-committed audit row and the 6-case live-PostgreSQL block are all in place,
and the checks this environment can run are green. The work units are merged
into `main` through pull request #71 as merge commit `8862050`, with the
required CI checks green on head `edfa66c` (run `36293559990`;
`Database migrations` and `Lint, Typecheck, Test, Build` both `SUCCESS`), which
satisfies the Story's delivery expectations. This is **not** a
production-readiness statement: [[EPIC-11]] remains open for [[PUR-003]].
