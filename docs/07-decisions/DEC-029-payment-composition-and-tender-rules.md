---
id: DEC-029
type: decision
title: Payment composition and tender rules (EPIC-12)
status: accepted
date: 2026-09-27
related_epics:
  - "EPIC-12"
related_decisions:
  - "DEC-023"
related_stories:
  - "POS-003"
prd_change_required: false
---

# DEC-029 — Payment composition and tender rules (EPIC-12)

## Context

PRD §19 supports multiple payments per sale across the six methods `CASH`,
`CARD`, `BANK_TRANSFER`, `QR`, `CHECK` and `OTHER`, and states that Invoice and
Payment are separate concepts. PRD §18 requires Complete Sale to validate
payments, and the typed `sales` namespace already owns the sale currency. The
PRD does not state whether a tendered amount and computed change exist, whether
overpayment is possible, or whether a payment can be written independently of
the sale. [[DEC-023]] defers payment refund to a later slice. POS-003 records
the payment composition as an open question.

Verified current state in this repository (2026-09-27):

- PRD §19 lists the six payment methods and states Invoice and Payment are
  separate; PRD §18 lists "validates payments" as a Complete Sale step; PRD §20
  defines the cash movement kinds and only one OPEN session per register.
- [[DEC-023]] defers payment refund and `POST /payments/:id/refund` to a later
  slice and records it as Tech Debt.
- No Payment model, enum or route exists yet.
- No customer credit, accounts-receivable, change or tendered-amount concept
  exists anywhere in the schema.

## Question

How are payments composed onto a sale, must they sum to the sale total, and are
change, overpayment or customer credit modelled?

## Options

### Option A — Multiple payments on CompleteSale, summing exactly, no change or credit (recommended)

A sale may carry several payments across the six PRD §19 methods. Payments exist
only on the CompleteSale command and a `DRAFT` carries none, so there is a
single write path. The sum of the payments must equal the sale total exactly,
with no change or tendered amount modelled (the operator enters the exact amount
that enters the register) and no customer credit or overpayment balance. Each
payment records its method and amount and is immutable once the sale is
completed. Refunds are deferred with [[DEC-023]].

Benefits: it satisfies PRD §19's multiple-payments-per-sale statement and PRD
§18's payment validation in one transactional path, and it avoids modelling a
second money quantity (tendered) and its derived change, so the recorded amounts
are exactly the money movements that occurred.

Costs: the cashier must enter the exact amount received rather than the note
handed over, so a physical change calculation happens outside the system, and a
customer cannot carry a credit or overpay into a future sale.

### Option B — Model a tendered amount and computed change

Record the amount tendered per payment and compute the change returned.

Benefits: a cashier can enter the note handed over and the system displays the
change, which matches a cash-drawer workflow.

Costs: it adds a second money quantity per payment, a change derivation and its
rounding, and a discrepancy surface between tendered, applied and changed; PRD
§18's validation is about payments equalling the total, and the accepted tender
rule keeps the operator entering the exact applied amount instead.

### Option C — Allow overpayment as customer credit or a running balance

Model overpayment as a customer credit balance applied to future sales.

Costs: it invents an accounts-receivable style ledger and a customer credit
balance that the PRD does not define, couples POS to Billing (EPIC-14), and
requires its own idempotency, audit and reversal semantics. It is a later
capability, not part of the epic that first writes a payment.

## Recommendation

Option A. PRD §19 already permits several payments across the six methods and
PRD §18 requires the payments to be validated, so the smallest correct model is
payments that sum exactly to the total with one transactional write path. Option
B is rejected because the exact-amount tender rule already makes change
unnecessary, and Option C is deferred: a customer credit ledger is a Billing
capability with no defined PRD scope.

## Impact

### Product

A sale can be paid with one or several methods, and the payments always equal
the total exactly. No change or credit is shown or stored, so the record
reflects only the money that was actually taken.

### Architecture

No new runtime, datastore, queue, dependency or API protocol. The payment rows
are written inside the CompleteSale transaction beside the stock and cash
effects, so there is no independent payment write path and no partial payment
state to reconcile.

### Database/API

Payments are child rows of the sale with a method enum mapped to the six PRD §19
values and a `Decimal(14, 2)` amount, written only by the CompleteSale command.
CompleteSale rejects a payment set whose sum differs from the sale total and
rejects any attempt to write a payment against a `DRAFT` or a completed sale.
Completed payments are immutable; refunds belong to the deferred slice.

### Delivery

POS-003 owns the payment rows, the method enum, the sum-equals-total validation
and the immutability of a completed payment. The deferred refund slice owns
`POST /payments/:id/refund` and its compensating records ([[DEC-023]]).

## Decision

Accepted on 2026-09-27 by the maintainer. Option A is the decision: a sale may
carry several payments across the six PRD §19 methods; payments exist only on
the CompleteSale command and a `DRAFT` carries none, so there is a single write
path; the sum of the payments must equal the sale total exactly, with no change
or tendered amount modelled (the operator enters the exact amount that enters
the register) and no customer credit or overpayment balance; each payment
records its method and amount and is immutable once the sale is completed; and
refunds are deferred with [[DEC-023]].

The other options stay recorded above as what was considered; acceptance selects
Option A only.

POS-003 owns the payment composition and its validation, and the deferred refund
slice owns `POST /payments/:id/refund`.

## PRD Update

No PRD change is required. PRD §19 already permits multiple payments per sale
across the six listed methods and PRD §18 already requires payment validation as
part of Complete Sale; this record fixes the exact-sum rule and declines to
model change, overpayment or credit that the PRD never defines. It introduces no
approved scope, and the engineering rules forbid editing the PRD to normalize an
implementation detail, so no PRD edit is proposed here.
