---
id: PUR-002
type: story
title: Purchase receiving
epic: EPIC-11
status: planned
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

- [ ] Receiving is one explicit command, never a generic `PATCH status` write,
      and the only status it produces is `RECEIVED`.
- [ ] The command validates the purchase is `DRAFT`; a purchase that is already
      `RECEIVED` or is `CANCELLED` is `409 CONFLICT` and persists nothing.
- [ ] The command is atomic: stock movements, balance updates, the status change
      and exactly one audit row are co-committed in one transaction, and any
      rejection persists nothing — no movement, no balance change, no status
      change, no audit row.
- [ ] Each received line creates exactly one signed **positive** `PURCHASE`
      `StockMovement` through the [[EPIC-10]] ledger seam; no balance is mutated
      outside the ledger, and no movement is created unconfirmed.
- [ ] Every receiving write acquires
      `stockSerializationLockKey(tenantId, catalogItemId)` **before** reading or
      writing `stock_balance` ([[TD-016]]), and the projection equals the
      ledger's signed sum after the command.
- [ ] `stock_movement_type` gains `PURCHASE` additively; existing `ADJUSTMENT`
      rows and behavior are unchanged, and no existing migration is rewritten.
- [ ] The receiving command is audited with the actor, the purchase id and
      stable field names only (PRD §27); no CONFIDENTIAL/RESTRICTED payload is
      logged.
- [ ] The purchase is resolved in the caller's tenant: a cross-tenant or unknown
      purchase UUID is one byte-equivalent `404`, and a cross-tenant reference
      is rejected identically and persists nothing.
- [ ] The route enforces authentication, server-side tenant context and a
      granular permission, re-asserted by the service before data access; a
      missing permission is `403` and persists nothing.
- [ ] The request body is a strict allowlisted contract that rejects unknown
      keys; `tenantId` is never read from body, query or route; no Prisma model
      crosses the HTTP boundary.
- [x] Replay behavior, line gates for non-tracking and inactive items, and the
      immutability of a `RECEIVED` purchase are fixed by the accepted and
      binding Decision records [[DEC-014]], [[DEC-012]] and [[DEC-015]]
      (accepted 2026-09-26); the receive command itself is still not written,
      and no idempotency or gating semantics are invented.
- [ ] The new permission key and role matrix are seeded, and the seed-count
      probe is reconciled.
- [ ] Tenant isolation tests exist for the receiving path, authorization and
      validation tests cover the route, and the live-PostgreSQL suite proves
      atomicity, immutability, cross-tenant isolation and the `(tenant, item)`
      serialization race.
- [ ] Required lint/typecheck/test checks pass.

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
None yet. The route path and permission key are fixed by the accepted Decision
records and the implementation slice; no route is implemented yet.
```

### Changed

```text
None yet. The existing inventory adjustment route and its behavior are
unchanged; only the movement-type enum gains a value.
```

## Database

### Migration

```text
None yet. An additive enum extension is required; no destructive statement is
accepted and no existing migration is rewritten.
```

### Models/Tables

- `StockMovement.type` — gains `PURCHASE` (`stock_movement_type`). Quantity
  stays `DECIMAL(10, 3)`, signed, non-zero, immutable, with the no-delete
  trigger unchanged.
- `StockBalance` — consumed through the existing `(tenant, item)` projection; no
  schema change expected.
- The purchase tables are owned by [[PUR-001 Purchase draft]].

## UI

- None. [[PUR-003 Staff purchases surface]] owns the receive affordance.
- If UI is changed later, reusable components must use semantic branding tokens
  rather than project-specific literals.

## Implementation Summary

_Not implemented. All required Decision records are accepted as of 2026-09-26 —
[[DEC-012]] purchase aggregate shape and the draft-versus-receive validation
gate, [[DEC-013]] purchase line cost and tax structure, [[DEC-014]] purchase
receiving semantics — single-shot transition, all-or-nothing line gates and
deterministic lock order, [[DEC-015]] purchase cancellation and the correction
boundary for a received purchase, [[DEC-016]] suppliers/purchases permission
keys, role matrix and entitlement gating and [[DEC-017]] suppliers/purchases
audit scope — and the slice awaits implementation authorization._

## Verification

```text
Not run.
```

## Tests Added

- None yet. Planned: the schema gate for the extended enum; an HTTP integration
  suite over the real guard chain (receive from `DRAFT`, `409` from `RECEIVED`
  and from `CANCELLED`, cross-tenant `404`, strict DTO rejects, permission sweep
  with nothing persisted, and the atomicity assertion that a rejected receive
  wrote no movement, no balance change and no audit row); and live-PostgreSQL
  evidence covering atomicity, the immutability trigger, cross-tenant isolation
  and the concurrent-receive serialization race on the shared
  `stockSerializationLockKey`, with the projection asserted equal to the
  ledger's signed sum.

## Known Limitations

- None recorded; the Story is unimplemented.

## Technical Debt

- This Story is the trigger [[TD-016]] names. The receiving slice must satisfy
  the documented protocol or resolve that record; if it satisfies the protocol
  by convention only, TD-016 stays open and must be updated with the new call
  site rather than silently closed.

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
- `packages/database/prisma/migrations/<timestamp>_purchase_receiving/` — the
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

_Status must remain non-done until all required gates pass and the durable
live-PostgreSQL receiving evidence is recorded; the required Decisions are
accepted as of 2026-09-26._
