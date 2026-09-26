---
id: DEC-014
type: decision
title:
  Purchase receiving semantics — single-shot transition, all-or-nothing line
  gates and deterministic lock order (EPIC-11)
status: accepted
date: 2026-09-26
related_epics:
  - "EPIC-11"
related_decisions:
  - "DEC-012"
  - "DEC-015"
related_stories:
  - "PUR-002"
prd_change_required: false
---

# DEC-014 — Purchase receiving semantics — single-shot transition, all-or-nothing line gates and deterministic lock order (EPIC-11)

## Context

PRD §17 defines receiving as an explicit command whose steps are atomic:
validate the `DRAFT`, create the stock movements, update the balances, mark the
purchase `RECEIVED` and write audit. It defines **no replay behavior**, **no
line gate for inactive or non-tracking items**, and **no lock ordering**. PRD
§18 requires `CompleteSale` to be idempotent but says nothing about receiving,
so PRD §18's leniency is not transferable by assumption.

Verified current state in this repository (2026-09-26):

- `StockMovementType` is pinned to `ADJUSTMENT` only (`schema.prisma:1332`), and
  the comment at `schema.prisma:1329` reserves `PURCHASE` for the epic that owns
  the command. `PURCHASE` movements are positive inputs by the ledger's signed
  convention.
- The ledger's serialization protocol is binding: `lockItemStock` runs
  `SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))::text` with
  `lockKey = stockSerializationLockKey(tenantId, catalogItemId)`
  (`apps/api/src/inventory/inventory.repository.ts:181`,
  `inventory.repository.ts:313-317`). [[TD-016]] makes acquiring that lock
  before reading or writing `stock_balance` binding on EPIC-11 receiving and
  names it as the next stock writer; `docs/05-modules/Inventory.md` carries the
  same protocol.
- The adjustment path's item gates already exist as stable `409 CONFLICT`
  messages: `STOCK_ITEM_NOT_TRACKED_MESSAGE` and `STOCK_ITEM_INACTIVE_MESSAGE`
  (`apps/api/src/inventory/inventory.service.ts:135-139`), and inventory
  co-commits one audit row with the movement and the balance projection inside
  the open transaction (`inventory.service.ts:269`).
- [[DEC-012]] fixes the draft gate: catalog-item state is **not** checked when a
  draft is saved, and **is** checked at receive.

## Question

What does a receive command do on a replay, which lines may it accept, what does
it persist when any line is rejected, and in what order does it take the
ledger's per-`(tenant, item)` advisory locks?

## Options

### Option A — Single-shot transition, all-or-nothing line gates, ascending lock order (recommended)

Only a `DRAFT` purchase is receivable. A replay or any non-`DRAFT` purchase is
`409 CONFLICT` and persists nothing — a truthful answer to a replay, with no
state short-circuit that would pretend the command had not already run. Every
line must resolve in-tenant to an ACTIVE item with `tracksStock` true; otherwise
the whole command fails with the same stable `409` messages the adjustment path
uses and persists nothing. Every line is written in **one** transaction together
with the balance projections, the status change and **exactly one** audit row;
the movement type is positive `PURCHASE`. The per-`(tenant, item)` advisory
locks are acquired in **ascending `catalogItemId` order**.

Benefits: atomicity matches PRD §17 exactly, the item gates reuse messages
already shipped rather than inventing new ones, the single audit row keeps the
trail one row per command, and the deterministic lock order is what lets two
concurrent multi-line receives of the same two items in opposite line order
proceed without deadlocking.

Costs: a client that retries a receive after a timeout cannot distinguish
"already applied" from "never applied" without reading the purchase, so the
surface must present the `409` as a terminal outcome rather than a transient
error.

### Option B — Idempotent replay

A repeated receive returns the same received purchase with `200` and writes no
second movement, mirroring the leniency PRD §18 requires for `CompleteSale`.

Benefits: retries are safe by construction and the staff surface never has to
interpret a conflict.

Costs: PRD §18 requires idempotency for sales and PRD §17 states nothing for
purchases, so adopting it here imports a requirement the purchase lifecycle does
not carry. The command cannot honor it correctly today anyway: it has no stable
client-supplied request/idempotency signal, so a `200` replay would be
indistinguishable from a brand-new receive. It remains available later without a
schema change only if such a replay signal is introduced, which does not exist
now.

### Option C — Lenient receiving that skips unusable lines

Skip non-tracking or inactive lines and mark the purchase `RECEIVED` for the
rest.

Rejected: partial stock effects contradict PRD §17's atomic receiving steps and
the ledger's all-or-nothing transaction, and they leave a purchase marked
`RECEIVED` whose lines did not all reach the ledger — a state nothing can later
reconcile.

## Recommendation

Option A. It is the only option that is exactly PRD §17: atomic, truthful and
free of an idempotency promise the purchase lifecycle does not make. Option B is
rejected because PRD §18 grants idempotency to sales only and because the
command has no replay signal to honor it, and Option C because it contradicts
atomic receiving. The **ascending `catalogItemId` lock order is part of this
decision, not an implementation detail**: the serialization protocol names the
lock key but not the acquisition order, and with several lines per purchase the
order is the deadlock-avoidance mechanism without which two concurrent receives
of the same two items in opposite order can deadlock.

## Impact

### Product

Receiving a draft either applies everything or nothing, so staff never see a
partially received purchase. A second receive attempt is reported as a conflict
against the purchase's current state, which the surface renders as a terminal
outcome with no silent retry.

### Architecture

No new runtime, datastore, queue, dependency or API protocol. The command reuses
the EPIC-10 ledger seam, its advisory lock and the `(tenant, item)` projection;
the only new behavior is the receive-time item gate and the lock ordering.
[[TD-016]] stays a live constraint, and the receive slice must not silently
reintroduce the lost-update it documents.

### Database/API

The `stock_movement_type` enum gains `PURCHASE` additively; no existing
migration is rewritten and existing `ADJUSTMENT` rows are unchanged. The receive
route is an explicit command, never a generic `PATCH status` write, behind a
granular permission ([[DEC-016]]) and a strict allowlisted contract. A rejected
receive persists no movement, no balance change, no status change and no audit
row, and a cross-tenant purchase UUID is one byte-equivalent `404`.

### Delivery

[[PUR-002 Purchase receiving]] owns the enum migration, the transaction, the
item gate, the lock ordering and the live-PostgreSQL evidence covering
atomicity, immutability, cross-tenant isolation and the concurrent-receive
serialization race. [[DEC-015]] consumes this record's immutability outcome when
it fixes the correction boundary.

## Decision

Accepted on 2026-09-26 by the maintainer. Option A is the decision: only a
`DRAFT` purchase is receivable; a replay or any non-`DRAFT` purchase is
`409 CONFLICT` and persists nothing — a truthful answer to a replay, with no
state short-circuit that would pretend the command had not already run; every
line must resolve in-tenant to an ACTIVE item with `tracksStock` true, and
otherwise the whole command fails with the same stable `409` messages the
adjustment path uses and persists nothing; every line is written in **one**
transaction together with the balance projections, the status change and
**exactly one** audit row, with the movement type positive `PURCHASE`; and the
per-`(tenant, item)` advisory locks are acquired in **ascending `catalogItemId`
order**, which is part of this decision, not an implementation detail.

The other options stay recorded above as the alternatives that were considered;
acceptance selects Option A only.

[[PUR-002 Purchase receiving]] owns the implementation slice — the enum
migration, the transaction, the item gate, the lock ordering and the
live-PostgreSQL evidence covering atomicity, immutability, cross-tenant
isolation and the concurrent-receive serialization race — and [[DEC-015]]
consumes this record's immutability outcome when it fixes the correction
boundary.

## PRD Update

No PRD change is required. PRD §17 already requires atomic receiving and PRD §27
already requires the receive audit; PRD §18's idempotency is left where it was
written — on sales — rather than extended to purchases. This record fills gaps
PRD §17 leaves open and does not extend approved scope, so no PRD edit is
proposed.
