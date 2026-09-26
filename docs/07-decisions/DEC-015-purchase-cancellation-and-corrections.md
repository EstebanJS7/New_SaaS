---
id: DEC-015
type: decision
title:
  Purchase cancellation and the correction boundary for a received purchase
  (EPIC-11)
status: accepted
date: 2026-09-26
related_epics:
  - "EPIC-11"
related_decisions:
  - "DEC-014"
related_stories:
  - "PUR-001"
  - "PUR-002"
prd_change_required: false
---

# DEC-015 — Purchase cancellation and the correction boundary for a received purchase (EPIC-11)

## Context

PRD §17 defines the `CANCELLED` state but **not which states reach it**. PRD §40
lists "Purchase reversal" among the correction cases and requires confirmed
inventory corrections to be explicit, idempotent, reasoned and audited. The
[[EPIC-11]] epic keeps the reversal command itself out of scope and defers it to
a future dependency, so this record must decide the boundary without implementing
the reversal.

Verified current state in this repository (2026-09-26):

- The ledger is immutable by construction: movements are created confirmed, the
  schema comment states the immutability rule, and a `BEFORE DELETE` trigger
  rejects deletion. `StockMovement.reversesMovementId` is a reserved nullable
  self-reference a compensating movement uses, and the enum comment reserves the
  `*_REVERSAL` values for the epics that own those commands
  (`schema.prisma:1329`).
- Correction precedent for confirmed documents: reversals create compensating
  records that preserve the link to the original operation, are idempotent, and
  audit the reason and the actor (`docs/03-architecture/REVERSALS-CORRECTIONS.md`
  and the engineering rules "Reversals and corrections").
- [[DEC-014]] fixes receiving as a single-shot transition whose only produced
  state is `RECEIVED` and whose re-attempt is a `409 CONFLICT`.
- No purchase model exists yet, so no purchase has been cancelled or received and
  no path can be observed today.

## Question

Is `CANCELLED` reachable from a received purchase, and how is a received purchase
corrected — by editing it, by cancelling it, or by a separate reversal command
that does not exist yet?

## Options

### Option A — `CANCELLED` only from `DRAFT`; received purchases are corrected only by a future reversal (recommended)

`CANCELLED` is reachable **only** from `DRAFT`. A `RECEIVED` purchase is
immutable: no edit, no cancel and no delete, matching the inventory ledger's
immutability. A received purchase is corrected only by a future explicit reversal
command that writes compensating `PURCHASE_REVERSAL` movements with a reason, an
actor and audit, as PRD §40 requires. EPIC-11 records that intent and implements
no reversal; no purchase, line or movement is hard-deleted.

Benefits: it keeps cancel and reversal as the distinct operations PRD §40
describes, keeps a confirmed inventory fact immutable, and leaves the reversal
command to the slice that can write and test it instead of smuggling it into a
cancel route.

Costs: until the reversal command exists, a mis-received purchase has no in-product
correction path, so the boundary must be documented as a known limitation rather
than presented as a complete correction story.

### Option B — Cancelling a received purchase writes the compensating movements

`CANCELLED` is reachable from `RECEIVED`, and the cancel command immediately
writes the compensating movements, making cancel and reversal the same operation.

Benefits: one operation covers both the draft and the received case, so a
mis-received purchase has an immediate path.

Costs: it merges two operations PRD §40 names separately, forces a `CANCELLED`
terminal state onto a purchase whose stock effect was already real, and requires
the full reversal semantics — reason, idempotency, compensating link, audit — to
exist inside the cancel route. It is a legitimate future capability **once the
reversal command exists**, but not a substitute for it.

### Option C — Allow editing a `RECEIVED` purchase's lines

Permit a received purchase's lines to be changed.

Rejected: it mutates a confirmed inventory fact, breaks the movement-to-line
correspondence receiving established, and violates PRD §40 and the ledger's
immutability. A correction is a new compensating operation, never an edit of a
confirmed record.

## Recommendation

Option A. PRD §40 names "Purchase reversal" as its own correction case, which
implies reversal and cancel are distinct operations, and the ledger's
immutability makes editing or silently cancelling a received purchase
incorrect rather than merely inconvenient. Option C is rejected on correctness
and Option B is deferred rather than rejected: it becomes legitimate once an
explicit reversal command exists, which [[EPIC-11]] deliberately does not build.

## Impact

### Product

A draft can be cancelled and disappears from the receiving path without touching
stock; a received purchase stays as the historical record it became. The absence
of an in-product correction for a received purchase is an explicit, recorded
limitation, not a surprise.

### Architecture

No new runtime, datastore, queue, dependency or API protocol. Cancel is a
`DRAFT`-only command; the reserved `reversesMovementId` link and the reserved
`*_REVERSAL` movement types are left for the future command, and this record adds
no reversal logic.

### Database/API

`CANCELLED` is produced only by an explicit cancel command guarded on `DRAFT`; a
cancel attempt against a `RECEIVED` purchase is `409 CONFLICT` and persists
nothing. There is no `DELETE` route and no generic `PATCH status` write, and a
cancelled purchase and its lines remain readable.

### Delivery

[[PUR-001 Purchase draft]] owns the cancel command and its `DRAFT`-only guard;
[[PUR-002 Purchase receiving]] records that a received purchase is corrected only
by the future reversal. The future reversal slice is a separate decision and a
separate story.

## Decision

Accepted on 2026-09-26 by the maintainer. Option A is the decision: `CANCELLED`
is reachable **only** from `DRAFT`; a `RECEIVED` purchase is immutable — no edit,
no cancel and no delete, matching the inventory ledger's immutability; a received
purchase is corrected only by a future explicit reversal command that writes
compensating `PURCHASE_REVERSAL` movements with a reason, an actor and audit, as
PRD §40 requires; and EPIC-11 records that intent and implements no reversal,
with no purchase, line or movement hard-deleted.

The other options stay recorded above as what was considered; acceptance selects
Option A only.

[[PUR-001 Purchase draft]] owns the implementation slice — the cancel command and
its `DRAFT`-only guard — and [[PUR-002 Purchase receiving]] records that a
received purchase is corrected only by the future reversal, which remains a
separate decision and a separate story.

## PRD Update

No PRD change is required. PRD §17 already fixes the `CANCELLED` state and PRD
§40 already names purchase reversal as the correction case for a confirmed
inventory operation; this record applies that existing intent and does not extend
approved scope. The engineering rules forbid editing the PRD to normalize an
implementation detail, so no PRD edit is proposed here.
