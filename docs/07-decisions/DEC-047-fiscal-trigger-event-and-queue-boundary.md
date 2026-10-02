---
id: DEC-047
type: decision
title: Fiscal trigger model, event and queue boundary
status: accepted
date: 2026-10-02
related_epics:
  - "EPIC-15"
related_decisions:
  - "DEC-041"
  - "DEC-042"
related_stories:
  - "FISC-004"
prd_change_required: false
---

# DEC-047 — Fiscal trigger model, event and queue boundary

## Context

PRD §22 says fiscal submission is queued. [[DEC-041]] deferred
`InvoiceConfirmed` until a concrete consumer exists. ADR-003 allows in-process
post-commit events and BullMQ only when a reaction needs durable retryable work.
The repository already has a BullMQ worker precedent for branding cleanup.

## Question

Does fiscal submission start automatically after invoice confirmation or through
an explicit staff issue command, and where does the queue boundary live?

## Options

### Option A — Explicit issue command enqueues Fiscal work (recommended)

Expose a Fiscal-owned command gated by `fiscal.invoice.issue` and the `fiscal`
feature. The command verifies the invoice is confirmed, creates/locates the
FiscalDocument idempotently and enqueues the BullMQ submission job. Billing does
not enqueue directly. `InvoiceConfirmed` can be introduced later only when an
automatic policy exists.

Benefits: matches the existing `fiscal.invoice.issue` permission, gives staff
control, keeps Billing free of fiscal orchestration and avoids creating an event
before product policy says issuance is automatic.

Costs: the PRD §36 journey requires an explicit operational action before
"fiscal submission queued".

### Option B — Post-commit `InvoiceConfirmed` automatically enqueues Fiscal work

Billing emits a post-commit event consumed by Fiscal, which enqueues a job.

Benefits: the MVP journey advances automatically after confirmation.

Costs: introduces policy that every confirmed invoice is issued fiscally, before
`fiscal-ui` settings and provider readiness are decided.

### Option C — Synchronous fake provider call from Billing confirm

Rejected: PRD §22 says submission is queued and Billing must not call a concrete
provider.

## Recommendation

Option A unless the maintainer explicitly wants automatic issuance. The first
EPIC-15 slice should prove the Fiscal boundary through a command route, not a
speculative automatic policy.

## Impact

### Product

Users issue fiscal documents deliberately after confirming invoices.

### Architecture

Fiscal owns the queue producer and worker; Billing remains a source aggregate.

### Database/API

A Fiscal route is pinned in the route-contract probe with
`fiscal.invoice.issue`.

### Delivery

FISC-004 owns the command, queue and worker.

## Decision

Accepted: Fiscal submission will begin through an explicit Fiscal-owned issue
command gated by `fiscal.invoice.issue` and the `fiscal` feature. The command
verifies invoice confirmation, idempotently creates or locates the
`FiscalDocument`, and enqueues BullMQ submission work. Billing will not enqueue
directly; `InvoiceConfirmed` may be introduced later only if an automatic
issuance policy is adopted.

## PRD Update

No PRD change is expected unless the maintainer decides the MVP must auto-issue
immediately after confirmation.
