---
id: FISC-004
type: story
title: Queued fiscal submission
epic: EPIC-15
status: planned
priority: high
depends_on:
  - FISC-003
prd_sections:
  - "22"
  - "36"
  - "39"
permissions:
  - fiscal.invoice.issue
branch:
created: 2026-10-02
updated: 2026-10-02
---

# FISC-004 — Queued fiscal submission

## Objective

Queue and process fiscal submission for confirmed invoices through the Fiscal
boundary with idempotency, bounded retry and tenant-safe evidence.

## Context

PRD §22 requires queued fiscal submission, idempotency and bounded retry.
Accepted [[DEC-047]] selects an explicit Fiscal issue command for EPIC-15 rather
than an automatic `InvoiceConfirmed` consumer. ADR-003 still governs the queue
boundary: BullMQ is appropriate because submission requires durable/retryable
work.

## In Scope

- Fiscal submission producer and BullMQ worker/consumer using the existing
  worker runtime.
- Introduction of the accepted explicit Fiscal issue command trigger and its
  queue hand-off.
- Idempotent job/database behavior under retries and concurrency.
- Retry/backoff classification for transient vs. terminal provider outcomes.
- API/worker/live-PostgreSQL evidence.

## Out of Scope

- Real provider network calls.
- New queue/broker technology.
- Portal/KuDE document exposure.

## Acceptance Criteria

- [ ] Confirmed invoices can produce exactly one eligible fiscal submission
      according to the accepted trigger model.
- [ ] The submission job is tenant-aware, idempotent and uses deterministic job
      identity or an equivalent accepted uniqueness rule.
- [ ] The worker calls only the Fiscal boundary and fake provider; Billing does
      not import the fake provider.
- [ ] Transient failures retry with bounded exponential backoff; functional,
      schema and configuration failures become terminal/retriable only through
      explicit manual retry rules.
- [ ] Integration tests cover authorization, entitlement, tenant isolation,
      duplicate submission, terminal rejection and retry behavior.
- [ ] A live-PostgreSQL forced overlap proves duplicate fiscal documents or
      duplicate active submissions are not admitted.
- [ ] Audit rows are written for issuance request, provider result and manual
      retry/cancel operations selected by the accepted decisions.

## Domain Invariants

- External/slow provider work never occurs inside the invoice confirmation
  database transaction.
- Retrying a job must not emit a second fiscal document for the same logical
  request.
- Queue failure does not rewrite Billing history.

## API

### Added

```text
Planned fiscal submission/status routes per accepted decisions.
```

### Changed

```text
Billing confirm may emit/dispatch the accepted post-commit trigger.
```

## Database

### Migration

```text
Only if accepted idempotency/retry shape requires additive columns or tables.
```

### Models/Tables

- Uses `FiscalDocument` and any accepted attempt/idempotency fields.

## UI

- None unless accepted decisions place status in this slice.

## Implementation Summary

_Not implemented._

## Verification

```text
Not run.
```

## Tests Added

- Planned API integration tests.
- Planned worker tests.
- Planned live-PostgreSQL forced concurrency probe.

## Known Limitations

- Fake provider only; no production adapter until EPIC-16.

## Technical Debt

- None planned.

## Decisions / ADRs

- Depends on accepted [[DEC-047]], [[DEC-048]] and [[DEC-049]].

## Files / Modules

- `apps/api/src/fiscal/*`
- `apps/worker/src/fiscal-*/`
- `packages/shared/src/*fiscal*queue*`
- `apps/api/src/billing/*` only for the accepted trigger integration

## Completion Notes

_Status must remain non-done until all required gates pass._
