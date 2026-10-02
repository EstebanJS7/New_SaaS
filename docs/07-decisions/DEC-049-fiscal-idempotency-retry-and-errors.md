---
id: DEC-049
type: decision
title: Fiscal idempotency, retry and error classification
status: accepted
date: 2026-10-02
related_epics:
  - "EPIC-15"
related_decisions:
  - "DEC-024"
  - "DEC-041"
related_stories:
  - "FISC-002"
  - "FISC-004"
prd_change_required: false
---

# DEC-049 — Fiscal idempotency, retry and error classification

## Context

PRD §22 requires queued submission, idempotency, bounded exponential backoff for
transient errors, and no infinite retry for functional/schema/configuration
rejections. Existing idempotency precedents differ: sales use
`IdempotencyRecord`; cash uses deterministic primary keys; invoice confirmation
uses state replay.

## Question

How does EPIC-15 prevent duplicate fiscal issuance and classify retryable
errors?

## Options

### Option A — Fiscal-owned uniqueness plus queue job identity (recommended)

Use FiscalDocument uniqueness for the logical issuance request and deterministic
BullMQ job identity for submission. Retries update the same FiscalDocument and
attempt metadata. Error classification is normalized as transient retryable,
terminal provider rejection, terminal functional/schema rejection, and terminal
configuration error. Manual retry is a new explicit Fiscal operation.

Benefits: idempotency lives with the aggregate it protects and does not require
polymorphically expanding `IdempotencyRecord`.

Costs: must be proven with concurrency tests and careful transaction boundaries.

### Option B — Reuse/expand IdempotencyRecord for fiscal issue

Benefits: one idempotency table. Costs: the current table is sale-shaped and
would need a broader redesign for no clear advantage.

### Option C — Trust BullMQ deduplication only

Rejected: queue-level identity alone does not protect direct database races or
manual retries.

## Recommendation

Option A.

## Impact

### Product

Retries should not produce duplicate fiscal documents or double provider calls
for the same logical request.

### Architecture

The queue is a delivery mechanism, not the source of truth.

### Database/API

FISC-002/FISC-004 add constraints, attempt fields and tests.

### Delivery

Live-PostgreSQL forced overlap evidence is required.

## Decision

Accepted: EPIC-15 will enforce logical issuance uniqueness in FiscalDocument and
use deterministic BullMQ job identity; retries update the same document and
attempt metadata. Errors normalize to transient retryable, terminal provider
rejection, terminal functional/schema rejection, or terminal configuration
error. Manual retry is a new explicit Fiscal operation.

## PRD Update

No PRD change is required.
