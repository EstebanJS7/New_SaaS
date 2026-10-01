---
id: DEC-036
type: decision
title: Cash session closure terminal state (EPIC-13)
status: accepted
date: 2026-09-29
related_epics:
  - "EPIC-13"
related_decisions:
  - "DEC-031"
  - "DEC-035"
related_stories:
  - "CASH-003"
prd_change_required: false
---

# DEC-036 — Cash session closure terminal state (EPIC-13)

## Context

PRD §20 requires only one `OPEN` session per register and defines close, but it
does not say whether a session with zero movements may close or whether a closed
session can be reopened. EPIC-12 already stores `opening_amount`, allows `0.00`
and uses `OPEN`/`CLOSED` as the session statuses.

## Question

Can an empty session be closed, and can a closed session be reopened?

## Options

### Option A — Empty sessions may close; CLOSED is terminal (recommended)

A session may close with zero movements. Once closed, it is never reopened; a
new session is opened instead.

Benefits: a quiet shift is still auditable, and session state remains a simple
one-way transition.

Costs: a mistakenly closed session requires opening a new session and recording
any correction explicitly.

### Option B — Require at least one movement to close

Reject close when no movement exists.

Costs: blocks valid quiet shifts and encourages artificial movements.

### Option C — Allow reopening

Permit `CLOSED -> OPEN`.

Costs: weakens close as an accounting boundary and complicates one-open-session
and audit behavior.

## Recommendation

Option A. Close should be a terminal accounting event, and a zero-movement shift
is valid business history.

## Impact

### Product

A no-activity drawer can still be closed and audited. Reopening is not a
feature; staff open a new session.

### Architecture

No new architecture.

### Database/API

Close accepts sessions with zero movements and rejects attempts to close a
session that is not `OPEN`. No reopen endpoint exists.

### Delivery

CASH-003 owns the close behavior and tests.

## Decision

Accepted on 2026-09-29 by the maintainer. Option A is the decision: a session
may close with zero movements, and `CLOSED` is terminal.

## PRD Update

No PRD change is required. The PRD does not require a movement before close and
already frames close as a financial comparison event.
