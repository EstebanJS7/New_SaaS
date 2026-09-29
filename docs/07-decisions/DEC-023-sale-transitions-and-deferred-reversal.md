---
id: DEC-023
type: decision
title: Sale status transitions and the deferred reversal boundary (EPIC-12)
status: accepted
date: 2026-09-27
related_epics:
  - "EPIC-12"
related_decisions:
  - "DEC-015"
related_stories:
  - "POS-001"
  - "POS-003"
prd_change_required: false
---

# DEC-023 — Sale status transitions and the deferred reversal boundary (EPIC-12)

## Context

PRD §18 defines the three sale states `DRAFT`, `COMPLETED` and `CANCELLED` but
does not say which states reach which. PRD §40 lists "Sale
cancellation/reversal" and "Payment refund/reversal" among the core correction
cases and requires confirmed financial/inventory reversals to preserve the
original record, create compensating records, link original and reversal,
require a reason, record the actor and time, be idempotent and be audited.
`docs/03-architecture/REVERSALS-CORRECTIONS.md` already fixes the command
convention (`POST /sales/:id/cancel`, `POST /payments/:id/refund`) and the
`Idempotency-Key` rule for sensitive reversal commands. [[DEC-015]] is the
EPIC-11 precedent for the same boundary on a received purchase. The open
question is whether sale reversal and payment refund are EPIC-12 scope. POS-001
and POS-003 record it.

Verified current state in this repository (2026-09-27):

- No Sale or Payment model, route or service exists, so no sale has been
  completed or cancelled and no correction path can be observed today.
- `docs/03-architecture/REVERSALS-CORRECTIONS.md` "API convention" fixes
  `POST /sales/:id/cancel` and `POST /payments/:id/refund` and states that only
  endpoints actually required by current scope are implemented; its
  "Idempotency" rule requires sensitive reversal commands to accept and persist
  an `Idempotency-Key` and to return the prior result for a repeated identical
  request.
- [[DEC-015]] decided the same boundary for a `RECEIVED` purchase: `CANCELLED`
  is reachable only from `DRAFT`, a confirmed record is immutable, and its
  reversal is a separate future command; the accepted record required no PRD
  edit.
- `docs/05-modules/Inventory.md` "Does Not Own" assigns sales/POS stock
  validation and the idempotent `CompleteSale` to EPIC-12 but names no sale
  reversal.

## Question

Which sale status transitions does EPIC-12 implement, and are sale reversal and
payment refund part of this epic or deferred?

## Options

### Option A — Exactly the two `DRAFT` transitions; reversal and refund deferred (recommended)

Exactly `DRAFT -> COMPLETED` (CompleteSale) and `DRAFT -> CANCELLED` (cancel,
with no stock, cash or payment effect). A `COMPLETED` sale is immutable, with no
`PATCH` and no `DELETE` route and a database delete rejection. Sale reversal
with compensating stock and cash movements, and payment refund, are out of scope
for EPIC-12 and recorded as [[TD-018]], with the PRD §40 case list and the
`POST /sales/:id/cancel` / `POST /payments/:id/refund` conventions left reserved
for that later work.

Benefits: it keeps cancel and reversal as the distinct operations PRD §40
describes, keeps a confirmed sale immutable, and leaves the reversal command to
the slice that can write and test its compensating movements, reason,
idempotency and audit.

Costs: until the reversal command exists, a mis-keyed counter sale cannot be
corrected in product, so the boundary is a documented limitation rather than a
complete correction story.

### Option B — Ship sale reversal and payment refund in EPIC-12

Implement `POST /sales/:id/cancel` on a completed sale with compensating
`SALE_REVERSAL` stock movements and cash, plus `POST /payments/:id/refund`.

Benefits: a completed sale has an immediate, PRD §40-aligned correction path.

Costs: it forces the full reversal semantics — reason, idempotency, compensating
link, audit, payment lifecycle and refund state — into the same epic as the
forward path, roughly doubling the schema and review surface. It is a legitimate
future capability, not a substitute for scope control.

### Option C — Allow editing or deleting a `COMPLETED` sale

Permit a completed sale's lines or status to be changed, or the sale deleted.

Rejected: it mutates a confirmed financial fact, breaks the sale-to-stock and
sale-to-cash correspondence, and violates PRD §40 and the immutability rule. A
correction is a new compensating operation, never an edit or a delete.

## Recommendation

Option A. PRD §40 names sale reversal and payment refund as their own correction
cases, which implies they are distinct operations rather than a status edit, and
[[DEC-015]] already applied exactly this boundary to a confirmed purchase
without a PRD edit. Option C is rejected on correctness, and Option B is
deferred rather than rejected: it becomes legitimate once the reversal slice can
own its compensating movements and refund lifecycle.

## Impact

### Product

A draft can be cancelled and disappears from the completing path without
touching stock, cash or payments; a completed sale stays as the historical
record it became. The absence of an in-product correction for a completed sale
is an explicit, recorded limitation, not a surprise.

### Architecture

No new runtime, datastore, queue, dependency or API protocol. Cancel is a
`DRAFT`-only command; the reserved compensating-movement types and the
`POST /sales/:id/cancel` and `POST /payments/:id/refund` conventions are left
for the future command, and this record adds no reversal logic.

### Database/API

`CANCELLED` is produced only by an explicit cancel command guarded on `DRAFT`,
and a cancel attempt against a `COMPLETED` sale is a stable `409` that persists
nothing. There is no `PATCH` or generic status write and no `DELETE` route; a
completed sale and its lines remain readable, and a delete is rejected at the
database level.

### Delivery

POS-001 owns the `DRAFT -> CANCELLED` command; POS-003 owns `DRAFT -> COMPLETED`
and its immutability. The future reversal slice is a separate decision and a
separate story, and its debt record is [[TD-018]] rather than implemented here.

## Decision

Accepted on 2026-09-27 by the maintainer. Option A is the decision: exactly
`DRAFT -> COMPLETED` (CompleteSale) and `DRAFT -> CANCELLED` (cancel, with no
stock, cash or payment effect); a `COMPLETED` sale is immutable, with no `PATCH`
and no `DELETE` route and a database delete rejection; sale reversal with
compensating stock and cash movements, and payment refund, are out of scope for
EPIC-12 and recorded as [[TD-018]], with the PRD §40 case list and the
`POST /sales/:id/cancel` / `POST /payments/:id/refund` conventions left reserved
for that later work; the reason is scope control with the [[DEC-015]] precedent,
and the honest cost is that a mis-keyed counter sale cannot be corrected until
then.

The other options stay recorded above as what was considered; acceptance selects
Option A only.

POS-001 owns the cancel command, POS-003 owns completion and immutability, and
the deferred reversal slice remains a separate decision and story.

## PRD Update

No PRD change is required. PRD §40 already names sale cancellation/reversal and
payment refund as correction cases and [[DEC-015]] established on 2026-09-26
that sequencing a PRD-named correction case into a later slice does not require
a PRD edit; this record applies that precedent to the sale and payment cases and
does not remove or alter approved scope. The engineering rules forbid editing
the PRD to normalize an implementation detail, so no PRD edit is proposed here.
