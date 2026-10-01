---
id: DEC-030
type: decision
title: Cash movement sign convention (EPIC-13)
status: accepted
date: 2026-09-29
related_epics:
  - "EPIC-13"
related_decisions:
  - "DEC-020"
  - "DEC-029"
related_stories:
  - "CASH-001"
  - "CASH-002"
prd_change_required: false
---

# DEC-030 — Cash movement sign convention (EPIC-13)

## Context

PRD §20 defines `SALE`, `REFUND`, `INCOME`, `EXPENSE`, `WITHDRAWAL`, `DEPOSIT`
and `ADJUSTMENT` as cash movement kinds, but it does not state whether the sign
lives in the stored amount or in the movement type. EPIC-12 already shipped the
minimal Cash foundation and POS-003 writes `SALE` movements for CASH payments
with a positive `amount` under `CHECK (amount <> 0)`.

## Question

How does EPIC-13 compute the expected drawer amount from movement rows without
rewriting the already-confirmed `SALE` convention?

## Options

### Option A — Type-owned sign with positive amounts (recommended)

Keep movement amounts positive. `SALE`, `INCOME` and `DEPOSIT` add to the
expected amount; `REFUND`, `EXPENSE` and `WITHDRAWAL` subtract; `ADJUSTMENT`
carries an explicit sign selected by the command. The expected amount is:

```text
opening_amount + SALE + INCOME + DEPOSIT - REFUND - EXPENSE - WITHDRAWAL ± ADJUSTMENT
```

Benefits: preserves EPIC-12's confirmed positive `SALE` rows and keeps the
amount field as the absolute money quantity handled by the operator.

Costs: every query that computes expectation must use the type-owned sign map,
and `ADJUSTMENT` needs one explicit direction field or equivalent contract.

### Option B — Store signed amounts directly

Allow positive and negative movement amounts and sum the column directly.

Benefits: expectation is a simple sum.

Costs: it conflicts with the already-shipped positive `SALE` rows and would
require a migration or special case over confirmed financial records.

## Recommendation

Option A. Confirmed EPIC-12 `SALE` movements already use positive amounts, and a
cash ledger should not change the meaning of confirmed rows to make a later
query shorter.

## Impact

### Product

Operators enter the amount of money moved. The system owns whether the movement
increases or decreases expected cash.

### Architecture

No new architecture. This is a Cash-domain calculation rule.

### Database/API

The database keeps `amount <> 0`; movement commands validate the type and, for
`ADJUSTMENT`, the direction. The close command computes expectation with the
same map.

### Delivery

CASH-001 owns the data-contract shape and CASH-002/CASH-003 own command and
close calculations.

## Decision

Accepted on 2026-09-29 by the maintainer. Option A is the decision: the movement
type owns the sign, amounts stay positive, and `ADJUSTMENT` carries an explicit
sign/direction.

## PRD Update

No PRD change is required. PRD §20 names the movement kinds and the server-side
expected amount; this decision fixes the implementation convention needed to
compute it without changing product scope.
