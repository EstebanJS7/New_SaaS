---
id: DEC-041
type: decision
title:
  Invoice confirmation effects, idempotency and the event boundary (EPIC-14)
status: accepted
date: 2026-10-01
related_epics:
  - "EPIC-14"
related_decisions:
  - "DEC-023"
  - "DEC-024"
  - "DEC-035"
  - "DEC-042"
related_stories:
  - "BILL-003"
prd_change_required: false
---

# DEC-041 — Invoice confirmation effects, idempotency and the event boundary (EPIC-14)

## Context

PRD §21 defines the `CONFIRMED` state but not what confirming does. PRD §27
requires audit of "invoice confirm/cancel". The engineering rules require
explicit command endpoints (`POST /invoices/:id/confirm`) and list
`InvoiceConfirmed` among the internal application events, while ADR-003 and
`docs/03-architecture/INTERNAL-EVENTS.md` restrict events to decoupled
post-commit reactions that a real consumer needs.

Verified current state in this repository (2026-10-01):

- `apps/api/src/sales/sales.service.ts` implements `CompleteSale` with a locked
  read, a conditional transition and an `IdempotencyRecord` row
  (`schema.prisma:1911`), while the EPIC-13 cash movement command chose a
  different mechanism: a deterministic id derived from `(tenant, key)` guarded
  by the PRIMARY KEY. Both are accepted precedents; they differ because the sale
  command carries a payload and the movement command must not double-count
  money.
- `IdempotencyRecord.resultSaleId` is `NOT NULL` with a composite FK to `sale`
  (`schema.prisma:1923,1929`), so the table cannot store an invoice result
  without an additive schema change.
- `packages/shared/src/events/dispatcher.ts` exports `createEventDispatcher()`
  and `envelope.ts` declares the event types, but **no code under `apps/`**
  references the dispatcher or subscribes to any event; `InvoiceConfirmed`
  appears only in `packages/shared/src/events/dispatcher.test.ts`.
- EPIC-13's native review rejected a cash command that had no idempotency,
  because a retry could double-count money. The correction made the route
  require `Idempotency-Key`. That precedent is about a payload-carrying money
  writer, and it must be distinguished from a payload-free state transition
  rather than copied mechanically.
- `docs/03-architecture/REVERSALS-CORRECTIONS.md` already states that fiscal
  cancellation/event behaviour is delegated to the Fiscal domain, so EPIC-14
  confirmation must not call a fiscal provider (see [[DEC-042]]).

## Question

What exactly does the `confirm` command do — is it idempotent by key or by
state, does it emit `InvoiceConfirmed`, and does it trigger anything outside the
invoice transaction?

## Options

### Option A — Payload-free, state-guarded confirm; no event yet (recommended)

`confirm` is a single transaction: lock the invoice row, gate on `DRAFT`,
allocate the number from the tenant sequence, set `CONFIRMED`, and write exactly
one audit row. It requires **no** `Idempotency-Key`, because the command carries
no request payload and the transition is guarded by a conditional write, so a
retried call on an already-`CONFIRMED` invoice is a pure no-op that returns the
same representation instead of consuming a second number or writing a second
audit row. No `InvoiceConfirmed` event is emitted, because no consumer exists
and ADR-003 forbids speculative event wiring; the event is introduced by
[[EPIC-15]] together with the fiscal submission queue that consumes it.

Benefits: no `IdempotencyRecord` schema change, no unused event plumbing, one
number per invoice under concurrency, and a clear rule for why this command
differs from `CompleteSale` and the cash movement command.

Costs: the flow is not uniform with the payload-carrying commands, so the
justification must live in the story and in this record; and a later
crash-after- commit replay relies on the state gate rather than on a stored
idempotency row.

### Option B — Require `Idempotency-Key` and store an invoice result

Make `IdempotencyRecord` polymorphic (nullable `result_sale_id`, nullable
`result_invoice_id`, a CHECK that exactly one is set) and require the header on
confirm.

Benefits: uniform with `CompleteSale` and with the corrected cash command.

Costs: an additive schema change whose second case is not needed by a
payload-free transition, plus an extra write on every confirm. It also invites
the reading that the state gate is insufficient, which it is not for a body-less
command.

### Option C — Confirm also emits `InvoiceConfirmed` and enqueues fiscal submission

Wire the dispatcher and enqueue work as part of confirmation.

Rejected: no worker job processor, queue producer or outbox table exists in
`apps/`, PRD §22 assigns fiscal submission to the Fiscal boundary, and queueing
fiscal work from Billing would import fiscal concerns into the Billing domain.
[[DEC-042]] resolves that boundary.

## Recommendation

Option A. The distinguishing rule to record is: an idempotency key is required
when a retry could apply a second effect that the current state cannot prove was
already applied (a money writer with a payload). A payload-free, conditionally
guarded transition is replay-safe by its own state machine, so a key would add a
schema change and a write without adding a guarantee. If the native review
disagrees during BILL-003, the correction is a bounded one: either add the
required header with an additive `IdempotencyRecord` change, or prove the state
gate covers the replay.

## Impact

### Product

Confirming is a one-way transition with an audited actor and an allocated
number; cancelled or abandoned drafts never consume numbers.

### Architecture

No event dispatcher wiring, no queue producer, no Fiscal import into Billing.
The transaction stays inside one database boundary, honoring the rule that
external or slow work never runs inside it.

### Database/API

`POST /invoices/:id/confirm` returns the invoice DTO with `number`, `series`,
`status: CONFIRMED` and the confirmation timestamp. A second call on an already
`CONFIRMED` invoice returns `200` with the same representation; a call on a
`CANCELLED` invoice returns the stable conflict code. No `IdempotencyRecord`
change is needed under Option A.

### Delivery

BILL-003 owns the command, its concurrency case and its audit assertion. If the
maintainer chooses Option B, BILL-003 also owns the additive `IdempotencyRecord`
migration and its schema test.

## Decision

Accepted on 2026-10-01 by the maintainer. Option A is the decision: `confirm` is
a single transaction that locks the invoice row, gates on `DRAFT`, allocates the
number from the tenant sequence, sets `CONFIRMED` and writes exactly one audit
row. It requires no `Idempotency-Key`, needs no `IdempotencyRecord` change, and
emits no `InvoiceConfirmed` event in EPIC-14.

The other options stay recorded above as what was considered; acceptance selects
Option A only.

The binding rule is that an idempotency key is required when a retry could apply
a second effect that the current state cannot prove was already applied — a
money writer carrying a payload. A payload-free, conditionally guarded
transition is replay-safe by its own state machine, so a key would add a schema
change and a write without adding a guarantee. If the native review of BILL-003
disagrees, the bounded correction is either to require the header with an
additive `IdempotencyRecord` change or to prove the state gate covers the
replay.

## PRD Update

No PRD change is required. PRD §21 defines the state and PRD §22 assigns fiscal
submission to the Fiscal boundary; this record only fixes the effects of the
state transition and defers the event to the epic that consumes it.
