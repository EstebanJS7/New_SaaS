---
id: DEC-035
type: decision
title: Cash close serialization and session state (EPIC-13)
status: accepted
date: 2026-09-29
related_epics:
  - "EPIC-13"
related_decisions:
  - "DEC-020"
  - "DEC-031"
related_stories:
  - "CASH-001"
  - "CASH-003"
prd_change_required: false
---

# DEC-035 — Cash close serialization and session state (EPIC-13)

## Context

A cash movement must not be inserted into a `CLOSED` session, and a close must
not interleave with a sale completion or manual cash movement in a way that
computes an expected amount over a stale set of movements. EPIC-12 already made
one-open-session a database property and rejected edits/deletes of confirmed
cash rows.

## Question

How does close serialize with movement writers and make `CLOSED` terminal?

## Options

### Option A — Row lock, state gate, conditional close and database trigger (recommended)

The close command takes `SELECT ... FOR UPDATE` on the session, gates on `OPEN`,
computes expected from the opening amount plus movements by type, writes the
counted/difference amounts and performs a conditional `WHERE status = 'OPEN'`
update. A database trigger rejects inserting a movement into a `CLOSED` session.

Benefits: the close path is explicit and the closed-session rule is a database
property rather than a convention.

Costs: implementation must keep lock order consistent across sale completion,
manual movement creation and close.

### Option B — Service checks only

Check the session status in each writer and close without a database trigger.

Benefits: simpler migration.

Costs: a missed writer can insert into a closed session and corrupt the close
record.

## Recommendation

Option A. Close is a financial transition and should be protected by both
transactional locking and database invariants.

## Impact

### Product

Once a session is closed, no later cash movement can be attached to it.

### Architecture

No new architecture. The command follows the explicit-transition pattern used by
purchase receive and sale complete.

### Database/API

The migration adds an insert guard for movements targeting closed sessions. The
service closes under a session row lock and maps stale/closed races to stable
conflicts.

### Delivery

CASH-001 owns the trigger; CASH-003 owns lock ordering, close behavior and live
PostgreSQL race coverage.

## Decision

Accepted on 2026-09-29 by the maintainer. Option A is the decision: close uses a
session row lock, `OPEN` state gate, conditional write and audit, while a
database trigger rejects movement inserts into `CLOSED` sessions.

## PRD Update

No PRD change is required. PRD §20 already states confirmed movements are
immutable and close compares expected/counted amounts; this decision records the
concurrency and state enforcement.
