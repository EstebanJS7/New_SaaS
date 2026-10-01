---
id: DEC-043
type: decision
title: Invoice cancellation boundary (EPIC-14)
status: proposed
date: 2026-10-01
related_epics:
  - "EPIC-14"
related_decisions:
  - "DEC-023"
  - "DEC-041"
  - "DEC-042"
related_stories:
  - "BILL-003"
prd_change_required: false
---

# DEC-043 — Invoice cancellation boundary (EPIC-14)

## Context

PRD §21 lists `CANCELLED` as one of the three invoice states, and
`docs/03-architecture/REVERSALS-CORRECTIONS.md` already documents
`POST /invoices/:id/cancel` as the explicit correction command, with fiscal
cancellation delegated to the Fiscal domain. PRD §21 also says an invoice is
"distinct from fiscal status", and PRD §19 says "Invoice and Payment are
separate concepts".

Verified current state in this repository (2026-10-01):

- No invoice model exists, so no cancellation behaviour exists either.
- [[DEC-023]] is the EPIC-12 precedent: the sale ships an explicit `cancel`
  command for its own states while sale **reversal** (stock compensation and
  refund) was deliberately deferred to [[TD-018]]. Cancelling a document that
  has not produced irreversible effects is in scope; undoing an irreversible
  effect is not.
- EPIC-13 followed the same shape: [[DEC-033]] kept sale reversal and payment
  refund in [[TD-018]] and gave Cash only standalone, non-linked movements.
- `docs/03-architecture/REVERSALS-CORRECTIONS.md` forbids editing or deleting
  confirmed financial records and requires compensating records with an audited
  reason and actor.
- The portal invoice surface is still deferred and no portal code reads invoices
  (see [[DEC-044]]).

## Question

Does EPIC-14 implement the `POST /invoices/:id/cancel` command, from which
states, and with what effects on numbering, payments and fiscal documents?

## Options

### Option A — Ship cancellation in EPIC-14 from `DRAFT` and `CONFIRMED` (recommended)

`POST /invoices/:id/cancel` requires a permission (`billing.cancel`), a reason
and an actor, and it is available from both `DRAFT` and `CONFIRMED`. It sets
`CANCELLED` and writes one audit row. A confirmed invoice **keeps** its
allocated number, and that number is never reused or reallocated, so a cancelled
confirmed invoice is a permanent, visible record rather than a deleted one.
`CANCELLED` is terminal. The command is replay-safe by its own state gate,
exactly like confirm ([[DEC-041]]). It performs no stock, cash, payment or
fiscal side effect.

Benefits: the epic that owns the aggregate owns its terminal states, matching
[[DEC-023]] and EPIC-12's shipped sale cancel; PRD §21's third state is
reachable; and the immutability rule is preserved because cancellation is a
transition, not an edit or a delete.

Costs: cancelling a confirmed invoice raises the question of what happens to
money already collected and to any fiscal document. Both answers are out of
scope and must be stated plainly: payments are not reversed ([[TD-018]]) and
fiscal documents are not cancelled by Billing ([[DEC-042]], [[EPIC-15]]).

### Option B — Cancel `DRAFT` invoices only

`CONFIRMED` invoices can never be cancelled in EPIC-14; the case becomes new
technical debt.

Benefits: nothing to explain about collected money or fiscal documents.

Costs: PRD §21's `CANCELLED` state would be only partially reachable and a real
operational mistake (an invoice confirmed with wrong data) would have no
in-product correction path, which is the opposite of the repository's
reversals-and-corrections policy.

### Option C — Defer cancellation entirely

No cancel command in EPIC-14.

Rejected: `REVERSALS-CORRECTIONS.md` already names the route, and deferring a
document lifecycle's own terminal state to an undefined later slice leaves the
aggregate half-built.

## Recommendation

Option A, with the effects stated as explicit non-effects: no payment reversal,
no fiscal cancellation, no number reuse, no deletion. The distinction to record
is the one [[DEC-023]] already drew — cancelling a document is in scope; undoing
money or stock is not.

## Impact

### Product

Staff can cancel a mistaken invoice while the audit trail and the allocated
number survive. Refunds and fiscal cancellation remain unavailable and must be
documented as such.

### Architecture

No compensating ledger, no payment integration and no fiscal call. Cancellation
stays inside the Billing transaction boundary.

### Database/API

`POST /invoices/:id/cancel` accepts a reason, gates on `DRAFT` or `CONFIRMED`,
writes `CANCELLED` plus a cancellation timestamp and one audit row, and returns
the invoice DTO. Repeating the call on a `CANCELLED` invoice returns `200` with
the same representation; cancelling from an invalid state returns the stable
conflict code. No row is deleted and no number is released.

### Delivery

BILL-003 owns the command, its audit assertion, its state-gate cases and its
tenant isolation. The limitation list in the story and in the epic must name
[[TD-018]] for refunds and [[EPIC-15]] for fiscal cancellation.

## Hand-off to EPIC-15

This record deliberately implements cancellation while no fiscal document
exists, so the following obligation must travel with the epic boundary rather
than being discovered later. Once [[EPIC-15]] introduces `FiscalDocument`,
cancelling a `CONFIRMED` invoice has to be revisited: either the Billing cancel
command requests fiscal cancellation through the Fiscal application interface in
the same orchestration, or the fiscal document carries its own cancellation that
references the invoice. PRD §22 and
`docs/03-architecture/REVERSALS-CORRECTIONS.md` delegate fiscal cancellation to
the Fiscal domain, so the flow must be orchestrated explicitly; [[EPIC-15]] must
either extend the cancel path or record why it does not.

The concrete risk if this is skipped: a `CANCELLED` invoice can then coexist
with an approved fiscal document, and the business document would claim a state
the fiscal record contradicts. [[EPIC-15]] must close that gap before enabling
fiscal issuance on invoices, and until then `CANCELLED` in Billing means only
that the business document was cancelled.

## Decision

_Pending. Proposed to the maintainer on 2026-10-01; Option A is recommended._

## PRD Update

No PRD change is required. PRD §21 already lists `CANCELLED`, PRD §22 already
delegates fiscal cancellation to the Fiscal domain, and
`REVERSALS-CORRECTIONS.md` already documents the correction policy this record
applies.
