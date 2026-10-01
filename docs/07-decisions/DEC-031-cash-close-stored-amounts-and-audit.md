---
id: DEC-031
type: decision
title: Cash close stored amounts and audit (EPIC-13)
status: accepted
date: 2026-09-29
related_epics:
  - "EPIC-13"
related_decisions:
  - "DEC-020"
related_stories:
  - "CASH-001"
  - "CASH-003"
prd_change_required: false
---

# DEC-031 — Cash close stored amounts and audit (EPIC-13)

## Context

PRD §20 says cash close computes the expected amount on the server, compares it
with the counted amount and that the difference is "stored/audited". EPIC-12
already stores the session `opening_amount`, but it has no close command and no
columns for the close result.

## Question

Does close store the expected, counted and difference amounts on the session, or
only write an audit record?

## Options

### Option A — Store the three amounts and audit (recommended)

`cash_session` gains `expected_amount`, `counted_amount` and
`difference_amount`, written only by the close command, and the command also
writes one audit row.

Benefits: the closed session explains itself without replaying audit logs, while
the audit trail still records who closed it and when.

Costs: three columns are added to the session table and must remain immutable
after close.

### Option B — Audit only

Write the computed values only inside the audit payload.

Benefits: fewer session columns.

Costs: the operational close result becomes log-dependent and harder to list,
filter or report without reading audit payloads.

## Recommendation

Option A. PRD §20's "stored/audited" is read as both storage and audit, not as
an either/or, because a closed cash session is an accounting record.

## Impact

### Product

Staff can see the expected amount, counted amount and difference directly on the
closed session.

### Architecture

No new architecture. Cash close remains an explicit command inside the Cash
module.

### Database/API

The close migration adds nullable close-result columns that are populated when a
session moves to `CLOSED`; the close response returns those values without
exposing Prisma models directly.

### Delivery

CASH-001 owns the schema shape and CASH-003 owns the command and audit.

## Decision

Accepted on 2026-09-29 by the maintainer. Option A is the decision: close stores
`expected_amount`, `counted_amount` and `difference_amount` on `cash_session`
and also writes an audit row.

## PRD Update

No PRD change is required. The decision clarifies how the existing PRD phrase
"stored/audited" is implemented.
