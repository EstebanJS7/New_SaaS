---
id: DEC-032
type: decision
title: Cash movement reason requirement (EPIC-13)
status: accepted
date: 2026-09-29
related_epics:
  - "EPIC-13"
related_decisions:
  - "DEC-020"
related_stories:
  - "CASH-001"
  - "CASH-002"
prd_change_required: false
---

# DEC-032 — Cash movement reason requirement (EPIC-13)

## Context

EPIC-12 kept `cash_movement.reason` nullable because only `SALE` existed and
POS-003 writes sale-generated cash movements without operator text. EPIC-13 adds
manual and corrective movement kinds where an unexplained drawer change is not
auditable enough.

## Question

Which movement kinds require a reason, and where is that rule enforced?

## Options

### Option A — Conditional database CHECK plus service validation (recommended)

Require a non-empty reason for `REFUND`, `EXPENSE`, `WITHDRAWAL`, `DEPOSIT` and
`ADJUSTMENT`; keep it optional for `SALE`. Enforce the invariant with a database
`CHECK` and mirror it in the API contract for good error messages.

Benefits: a second writer cannot bypass the auditability rule, and the API still
returns a stable validation error.

Costs: the migration must add a conditional constraint over the enum and reason
column.

### Option B — Service-only validation

Reject missing reasons in the Cash service.

Benefits: simpler migration.

Costs: the invariant becomes a convention and is easy to bypass from another
writer.

## Recommendation

Option A. Cash movement auditability is a financial invariant and belongs in the
schema, not only in service good will.

## Impact

### Product

Manual and corrective cash movements explain why money moved. Sale-generated
movements stay machine-generated and do not force a synthetic reason.

### Architecture

No new architecture.

### Database/API

A conditional `CHECK` rejects missing or blank reasons for the listed types. The
API normalizes and validates reason text before insert.

### Delivery

CASH-001 owns the constraint; CASH-002 owns API behavior and tests.

## Decision

Accepted on 2026-09-29 by the maintainer. Option A is the decision: reason is
mandatory for `REFUND`, `EXPENSE`, `WITHDRAWAL`, `DEPOSIT` and `ADJUSTMENT`,
optional for `SALE`, and enforced by a conditional database `CHECK` with service
validation.

## PRD Update

No PRD change is required. PRD §20 defines immutable cash movements; this record
adds the implementation-level auditability rule for manual kinds.
