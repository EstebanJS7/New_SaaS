---
id: TD-018
type: tech-debt
title: Sale reversal and payment refund are deferred out of EPIC-12
status: open
severity: medium
related_epics:
  - EPIC-12
  - EPIC-13
related_stories:
  - POS-003
created: 2026-09-27
updated: 2026-09-27
---

# TD-018 — Sale reversal and payment refund are deferred out of EPIC-12

## Context

PRD §40 names "Sale cancellation/reversal" and "Payment refund/reversal" among
the core correction cases and requires every financial or inventory reversal to
preserve the original record, create compensating records, link the original and
the reversal, require a reason, record the actor and time, be idempotent and be
audited.

[[DEC-023]] decides that [[EPIC-12]] ships exactly the two `DRAFT` transitions —
`DRAFT -> COMPLETED` and `DRAFT -> CANCELLED` — and that a `COMPLETED` sale is
immutable. Sale reversal with compensating stock and cash movements, and payment
refund, are deferred out of the epic and recorded here. The reserved command
conventions `POST /sales/:id/cancel` on a completed sale and
`POST /payments/:id/refund` are fixed by
`docs/03-architecture/REVERSALS-CORRECTIONS.md` and stay unimplemented.

The inventory and cash models already reserve the shapes a reversal needs:
`StockMovement.reversesMovementId` exists and is always `null`, and the
`*_REVERSAL` stock movement values are reserved in the schema comment for the
epic that owns their commands. The cash reversal movement kind is reserved with
the rest of the PRD §20 kinds by [[DEC-020]].

Verified current state in this repository (2026-09-27):

- No Sale or Payment model, route or service exists, so no sale has been
  completed or cancelled and no correction path can be observed.
- `docs/03-architecture/REVERSALS-CORRECTIONS.md` "API convention" fixes
  `POST /sales/:id/cancel` and `POST /payments/:id/refund` and states that only
  endpoints actually required by current scope are implemented; its
  "Idempotency" rule requires a sensitive reversal to accept and persist an
  `Idempotency-Key` and to return the prior result for a repeated identical
  request.
- `docs/05-modules/Inventory.md` "Does Not Own" states that the reversal command
  is not implemented and that `reversesMovementId` is reserved and always
  `null`.
- [[DEC-015]] applied the same boundary to a `RECEIVED` purchase, and
  [[DEC-023]] applies it to a `COMPLETED` sale.

## Debt

A completed sale is immutable and there is no in-product way to correct it until
the reversal slice lands. A mis-keyed counter sale — a wrong item, a wrong
quantity, a wrong price or a wrong payment method — therefore cannot be fixed
through the product: the stock has already moved, the cash movement has already
been written and the payment rows are immutable, and the only correction is
outside the application.

The gap is a scope decision, not an oversight, but it is a real capability gap
against PRD §40's case list, and it grows more expensive the longer it stays
open: the more sales a tenant completes, the more likely the first correction
request arrives with no supported path, and the reversal slice must then
implement the compensating movements, the original-to-reversal link, the reason
and actor, the idempotency key and the audit all at once against a populated
ledger.

## Why It Is Safe to Defer

- The forward path and the correction boundary are distinct operations, and
  shipping the forward path does not weaken any acceptance criterion: no EPIC-12
  criterion claims a correction capability, and [[DEC-023]] records the boundary
  explicitly rather than hiding it.
- A `COMPLETED` sale is immutable and readable, so nothing is lost or
  misrepresented: the original record, its lines, its payments and its ledger
  movements all survive intact and stay auditable.
- The compensating shapes are reserved and unused, so the reversal slice can
  extend the model additively rather than migrate it: `reversesMovementId`
  already exists, the `*_REVERSAL` stock values are reserved and the cash
  reversal kind is reserved with the remaining PRD §20 kinds.
- The correction semantics are already defined by PRD §40 and
  `docs/03-architecture/REVERSALS-CORRECTIONS.md`, so deferral loses no design
  work: the slice that owns it inherits a fixed contract.

## Risk

- A mis-keyed counter sale cannot be corrected in product. The honest cost is
  recorded here so the limitation is visible before a tenant hits it, rather
  than discovered as a bug.
- No schema guard records the intent: `POST /sales/:id/cancel` on a completed
  sale and `POST /payments/:id/refund` are conventions, not routes, and nothing
  in the codebase signals that they are reserved.
- Without a reversal, the stock ledger and the cash ledger accumulate the
  incorrect movement permanently, so a correction later needs both compensating
  movements and a clear link to the original, which is more work against a
  populated ledger than against an empty one.
- The deferral must not be silently converted into a "cancel a completed sale"
  shortcut later; PRD §40 and [[DEC-023]] reject the status-edit shape.

## Proposed Resolution

1. A slice that owns sale corrections implements `POST /sales/:id/cancel` on a
   completed sale as an explicit reversal command: signed compensating
   `SALE_REVERSAL` stock movements through the [[EPIC-10]] ledger under
   `stockSerializationLockKey(tenantId, catalogItemId)`, the compensating cash
   movement, a link from each compensating record to its original, a mandatory
   reason, the actor and time, an `Idempotency-Key` and an audit row — all in
   one transaction.
2. The slice implements `POST /payments/:id/refund` with the same shape and
   preserves the original payment record; a completed payment is never changed
   to a new amount.
3. The slice keeps a `COMPLETED` sale immutable: a reversal produces
   compensating records and a linked correction state, never an edit, a delete
   or a silent status flip.
4. The slice proves it live: the compensating movements, the
   original-to-reversal link, the idempotent replay, the cross-tenant `404` and
   the audit row.

## Trigger / Target

The epic that owns sale corrections, or the first live request to correct a
completed sale or refund a payment, whichever arrives first. The roadmap places
the cash-correction half with EPIC-13 and the invoice and fiscal halves with
EPIC-14 and later; the sale and payment reversal slice itself is unassigned and
must be decided before implementation.

## Verification After Resolution

- [ ] A completed sale can be reversed through an explicit command that creates
      the compensating stock movements, the compensating cash movement and the
      linked payment refund, and writes exactly one audit row.
- [ ] The original sale, its lines, its payments and its original ledger
      movements remain intact and readable.
- [ ] The reversal is idempotent: a repeated identical request returns the prior
      result and writes no second compensating record.
- [ ] The reversal requires a reason and records the actor and time, and a
      cross-tenant or unknown UUID is one byte-equivalent `404`.
- [ ] The compensating stock write acquires
      `stockSerializationLockKey(tenantId, catalogItemId)` before reading or
      writing `stock_balance` ([[TD-016]]).
- [ ] `docs/03-architecture/REVERSALS-CORRECTIONS.md` and the sales module
      documentation describe the implemented command rather than a reserved
      convention.
- [ ] This record is closed only when the command ships with its live-PostgreSQL
      evidence, not when it is merely scheduled.
