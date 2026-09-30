---
id: DEC-034
type: decision
title: Cash permissions and role matrix (EPIC-13)
status: accepted
date: 2026-09-29
related_epics:
  - "EPIC-13"
related_decisions:
  - "DEC-026"
related_stories:
  - "CASH-002"
  - "CASH-003"
prd_change_required: false
---

# DEC-034 — Cash permissions and role matrix (EPIC-13)

## Context

EPIC-12 already seeded `cash.read`, `cash.register.create` and
`cash.session.open`, and `cash.session.close` has existed since EPIC-01 while no
route consumes it. EPIC-13 adds cash close and manual movement creation.

## Question

Which permission keys does EPIC-13 add or consume, and which roles receive them?

## Options

### Option A — One movement-create key plus the reserved close key (recommended)

Consume the existing `cash.session.close` key for close, and add one new
`cash.movement.create` key for the six non-sale movement commands. Grant both to
`OWNER`, `ADMIN` and `CASHIER`, matching the existing cash write keys.

Benefits: keeps permission semantics understandable and avoids one permission
key per movement kind before product needs different delegation.

Costs: a tenant cannot allow expenses but disallow withdrawals at permission-key
granularity in this MVP slice.

### Option B — One key per movement kind

Add separate keys such as `cash.expense.create` and `cash.withdrawal.create`.

Benefits: more granular authorization.

Costs: expands the seed catalog and role matrix without a product requirement
for per-kind delegation.

## Recommendation

Option A. EPIC-13 needs two write capabilities: create a movement and close a
session. The reserved close key already exists.

## Impact

### Product

OWNER, ADMIN and CASHIER can close sessions and create manual cash movements;
other roles keep read-only or no write access according to the existing matrix.

### Architecture

No new authorization model.

### Database/API

The seeded catalog moves from 51 to 52 permissions when `cash.movement.create`
is added. `cash.session.close` is consumed but not newly counted.

### Delivery

CASH-002 owns `cash.movement.create`; CASH-003 consumes `cash.session.close`.
Seed-count tests must be reconciled in the same implementation slices.

## Decision

Accepted on 2026-09-29 by the maintainer. Option A is the decision: EPIC-13 uses
`cash.session.close` and adds `cash.movement.create`; all cash write keys stay
on `OWNER`, `ADMIN` and `CASHIER`, and the seeded catalog moves 51 → 52.

## PRD Update

No PRD change is required. PRD §9 defines role/permission behavior at a high
level; this decision records the implementation keys.
