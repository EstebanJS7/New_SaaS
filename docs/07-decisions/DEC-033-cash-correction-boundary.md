---
id: DEC-033
type: decision
title: Cash correction boundary for EPIC-13
status: accepted
date: 2026-09-29
related_epics:
  - "EPIC-13"
related_decisions:
  - "DEC-023"
related_stories:
  - "CASH-002"
prd_change_required: false
---

# DEC-033 — Cash correction boundary for EPIC-13

## Context

PRD §40 names cash compensating movements, sale cancellation/reversal and
payment refund/reversal as correction cases. EPIC-12 deferred sale reversal and
payment refund into [[TD-018]]. EPIC-13 must add the remaining cash movement
kinds, but it does not need to own sale/payment reversal orchestration to do so.

## Question

Does EPIC-13 take the sale reversal and payment refund scope, or only the cash
side movement commands?

## Options

### Option A — Cash-side movement commands only (recommended)

EPIC-13 adds commands that can emit the six remaining cash movement kinds with a
reason and an open session. They are unlinked to any sale or payment. Sale
reversal, stock compensation and `POST /payments/:id/refund` remain in
[[TD-018]].

Benefits: the epic stays bounded and still gives Cash a real compensating
movement emitter.

Costs: reversing a completed sale remains unavailable until [[TD-018]] lands.

### Option B — Include sale/payment reversal in EPIC-13

Build the sale reversal, stock compensation, payment refund and cash movement
chain together.

Benefits: full business reversal would land sooner.

Costs: it expands EPIC-13 across Sales, Payments, Inventory and Cash, making the
Cash close epic too large and mixing independent workflows.

## Recommendation

Option A. EPIC-13 should finish Cash's own ledger and close behavior; the
cross-domain sale/payment reversal deserves its own bounded slice.

## Impact

### Product

Staff can record standalone cash corrections and adjustments, but a completed
sale still cannot be reversed or a payment refunded through this epic.

### Architecture

Cash remains a Core module. No cross-domain reversal orchestrator is introduced
in this epic.

### Database/API

Movement commands accept type, amount, reason and an open session; they do not
link to a sale or payment in EPIC-13.

### Delivery

CASH-002 owns the standalone movement commands. [[TD-018]] remains open.

## Decision

Accepted on 2026-09-29 by the maintainer. Option A is the decision: EPIC-13 does
not take [[TD-018]]; it ships the six remaining cash movement kinds as cash
commands with reason, amount and open session, unlinked to sale or payment.

## PRD Update

No PRD change is required. The PRD already allows cash compensating movements;
this decision preserves the existing deferred sale/payment reversal boundary.
