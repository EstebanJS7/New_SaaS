---
id: DEC-020
type: decision
title: CompleteSale cash boundary and the minimal Cash foundation (EPIC-12)
status: accepted
date: 2026-09-27
related_epics:
  - "EPIC-12"
related_stories:
  - "POS-002"
  - "POS-003"
prd_change_required: false
---

# DEC-020 — CompleteSale cash boundary and the minimal Cash foundation (EPIC-12)

## Context

PRD §18's atomic Complete Sale step list includes "creates cash movements for
CASH payments", and PRD §20 defines `CashRegister`, `CashSession` and
`CashMovement` with the rule "only one OPEN session per register". Cash is
EPIC-13, and the roadmap lists EPIC-13 as depending on EPIC-12, so a CASH sale
cannot satisfy PRD §18 if the minimum Cash foundation ships only in the later
epic. POS-002 and POS-003 record the boundary as an open question.

Verified current state in this repository (2026-09-27):

- `docs/01-roadmap/ROADMAP.md:23-25` lists EPIC-12 POS/Payments as `planned`
  depending on EPIC-09 and EPIC-10 (both `done`) and EPIC-13 Cash as `planned`
  depending on EPIC-12, so Cash is genuinely downstream of the sale command.
- No Sale, Payment, `CashRegister`, `CashSession` or `CashMovement` model
  exists. `packages/database/prisma/schema.prisma:1341` pins
  `enum StockMovementType { ADJUSTMENT PURCHASE }`, and its comment
  (`schema.prisma:1336-1340`) states that `SALE`, `TRANSFER_*` and the
  `*_REVERSAL` compensations "belong to EPIC-12 and later and are added
  additively then".
- The `cash` feature code is one of the twelve `FEATURE_CODE_SEEDS`, and
  `cash.session.close` is already seeded
  (`packages/database/src/reference-seed.ts:87`) while being consumed by no
  route.
- No sales or cash module exists under `apps/api/src/`.
- `docs/05-modules/Inventory.md` "Does Not Own" assigns sales/POS stock
  validation, cash movements and the idempotent `CompleteSale` to EPIC-12, and
  the serialization protocol binds every stock writer to
  `stockSerializationLockKey(tenantId, catalogItemId)` ([[TD-016]]).

## Question

Does EPIC-12 own any part of Cash, or does it leave PRD §18's "creates cash
movements for CASH payments" step unsatisfiable until EPIC-13 lands?

## Options

### Option A — Minimal Cash foundation inside EPIC-12 (recommended)

EPIC-12 owns the least Cash that makes PRD §18 satisfiable: tenant-scoped
`CashRegister`, `CashSession` and `CashMovement`; `CashMovementType` extended
additively with `SALE` only, leaving `REFUND`, `INCOME`, `EXPENSE`,
`WITHDRAWAL`, `DEPOSIT` and `ADJUSTMENT` reserved for EPIC-13 under the same
additive discipline `StockMovementType` documents; "only one OPEN session per
register" enforced in the database by a partial unique index rather than by
application convention; a CASH payment requiring an OPEN session resolved
server-side in the same transaction as CompleteSale and never from the request
body; the movement amount equal to the CASH payment amount of that sale; a
minimal session-open command; EPIC-13 keeping session close with the
expected/counted difference, the other six movement kinds, cash reversals and
refunds and the full cash UI; and no Branch dimension, consistent with the
tenant-wide stock decision.

Benefits: it makes the epic's central command actually complete by PRD §18, it
reuses the additive-enum discipline the ledger already established, and it makes
the register/session invariant a database property that no future writer can
bypass.

Costs: EPIC-12 now carries part of PRD §20's data model, a partial unique index
and a session-open command that is otherwise EPIC-13 surface, so the boundary
must be defended deliberately or EPIC-13 inherits two competing cash models.

### Option B — No Cash in EPIC-12; a CASH payment is recorded as payment data only

Ship the Sale and Payment aggregates and defer every cash movement to EPIC-13.

Benefits: EPIC-12 stays inside the POS/Payment aggregate, and one epic (EPIC-13)
owns the whole Cash model in a single slice.

Costs: PRD §18's Complete Sale step list explicitly includes the cash movement,
so a CASH sale would either skip an approved step or fake it; a completed CASH
sale would leave no register effect, and EPIC-13 would then have to reconcile
sales that already happened rather than record them.

### Option C — Ship the full PRD §20 Cash model inside EPIC-12

Implement all seven movement kinds, session close with the expected/counted
difference and the cash UI inside EPIC-12.

Benefits: the cash domain lands once, with no split between two epics.

Costs: it absorbs EPIC-13's entire scope into a POS epic, inflating the review
surface and pre-empting the epic that owns cash corrections and reconciliation.
This is scope inflation, not a smaller change.

## Recommendation

Option A. PRD §18 requires the cash movement as part of Complete Sale, and
EPIC-13 cannot deliver it because EPIC-13 depends on EPIC-12, so the minimum
Cash is a prerequisite of the epic's central command rather than optional scope.
Option C is rejected as scope inflation, and Option B is deferred rather than
rejected: the remaining EPIC-13 surface can be added additively exactly as each
new movement type was reserved. The UI gate stays UX only — the backend
permission and tenancy checks remain mandatory.

## Impact

### Product

A CASH sale increases the register's expected cash from the moment the sale
completes, and EPIC-13 later reconciles it at close. Non-cash sales never touch
cash, so the cash surface stays small until its owning epic expands it.

### Architecture

No new runtime, datastore, queue, dependency or API protocol. Three
tenant-scoped aggregates join the modular monolith, and the one-OPEN-session
rule becomes a database invariant through a partial unique index instead of an
application convention that a second writer could forget.

### Database/API

An additive migration adds the three tables, the `cash_movement_type` enum with
`SALE` only, the tenant composite ownership keys, and a partial unique index on
`(tenant, register) WHERE status = 'OPEN'`. CompleteSale resolves the session
server-side and writes the movement inside its transaction. The `cash.read` and
`cash.session.open` permissions and the session-open command are seeded and
wired; no `PATCH` or `DELETE` route exists on cash records.

### Delivery

POS-002 owns the Cash foundation, the partial unique index and the session-open
command; POS-003 owns the CompleteSale integration that resolves the OPEN
session and writes the `SALE` movement. EPIC-13 owns close, the six remaining
movement kinds, cash reversals and refunds and the full cash UI.

## Decision

Accepted on 2026-09-27 by the maintainer. Option A is the decision: EPIC-12 owns
the minimum Cash needed to satisfy PRD §18 instead of leaving it to EPIC-13 —
tenant-scoped `CashRegister`, `CashSession` and `CashMovement`;
`CashMovementType` extended additively with `SALE` only, with `REFUND`,
`INCOME`, `EXPENSE`, `WITHDRAWAL`, `DEPOSIT` and `ADJUSTMENT` reserved for
EPIC-13 under the same additive discipline as `StockMovementType`; "only one
OPEN session per register" enforced in the database by a partial unique index
rather than by application convention; a CASH payment requires an OPEN session
resolved server-side in the same transaction as CompleteSale and never from the
request body; the movement amount equals the CASH payment amount of that sale; a
minimal session-open command exists because EPIC-13 depends on EPIC-12 and a
CASH sale would otherwise be impossible; EPIC-13 keeps session close with the
expected/counted difference, the other six movement kinds, cash reversals and
refunds and the full cash UI; and there is no Branch dimension, consistent with
the tenant-wide stock decision.

The other options stay recorded above as what was considered; acceptance selects
Option A only.

POS-002 owns the Cash foundation and the session-open command, POS-003 owns the
CompleteSale cash integration, and EPIC-13 owns the remainder.

## PRD Update

No PRD change is required. PRD §18 already requires Complete Sale to create cash
movements for CASH payments and PRD §20 already defines the three Cash entities
and the one-OPEN-session rule; this record sequences the minimum share of that
approved model into EPIC-12 because EPIC-13 depends on it and leaves the rest to
EPIC-13. None of the options extends approved product scope, and the engineering
rules forbid editing the PRD to normalize an implementation detail, so no PRD
edit is proposed here.

## Subsequent scope note

**2026-09-29, after this record's acceptance.** The maintainer clarified three
points of the slice that implements this decision. They are a later
clarification that does not retroactively change the accepted text above and do
not amend this record's scope or approval; the accepted `## Decision` text
stands as written.

- **The session records a required opening float.** `openingAmount` is
  `DECIMAL(14,2) NOT NULL` on `POST /cash/sessions`, and `0.00` is allowed
  because a register may open with an empty drawer. This decision requires a
  CASH sale to increase the register's expected cash, and PRD §20 defines close
  as the server-computed expected amount compared against the counted amount;
  without an opening baseline that expectation cannot represent the cash already
  in the drawer, so the baseline is part of the minimum foundation rather than
  EPIC-13 surface.
- **`opened_by` references the tenant membership.** The session stores
  `opened_by_membership_id`, a composite `RESTRICT` foreign key to
  `tenant_membership(tenant_id, id)` (that unique key already exists in
  `packages/database/prisma/schema.prisma`). This decision requires every cash
  record to belong to exactly one tenant; a global `user_profile` reference
  could not guarantee that the opener belongs to the session's tenant, while the
  composite foreign key makes it a database property.
- **The minimal `POST /cash/registers` belongs to the slice.** This decision's
  POS-002 share names a session-open command, but the story as originally
  written exposed only `GET /cash/registers`, `GET /cash/sessions` and
  `POST /cash/sessions`, so no route could create a `CashRegister`. The chain
  this decision requires — an `OPEN` session reachable before a CASH sale — was
  therefore broken for every tenant. A minimal register create, behind the new
  `cash.register.create` key, is added to the same slice; the resulting
  permission-key and seeded-count change is recorded in the [[DEC-026]]
  subsequent-scope note of the same date.
