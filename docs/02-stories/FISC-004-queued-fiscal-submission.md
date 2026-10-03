---
id: FISC-004
type: story
title: Queued fiscal submission
epic: EPIC-15
status: in-progress
priority: high
depends_on:
  - FISC-003
prd_sections:
  - "22"
  - "36"
  - "39"
permissions:
  - fiscal.invoice.issue
branch: feat/epic-15-fiscal-submission
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

- The explicit Fiscal issue command `POST /fiscal-documents` with body
  `{ invoiceId }`, gated on the `fiscal` entitlement and the already-seeded
  `fiscal.invoice.issue` permission — the first route that consumes it.
- The Fiscal submission queue: a shared contract, an API producer behind a port
  token, and a worker consumer, mirroring the shipped branding cleanup
  precedent.
- The worker handler that transitions the document, calls the provider port,
  sanitizes the snapshots before persisting, and maps DEC-049's outcome taxonomy
  onto the status graph.
- The status transition guard FISC-002 deliberately deferred, as its own
  additive migration.
- Idempotency by state, bounded exponential backoff for transient failures, and
  audit rows for the issue request and each provider result.

The full binding contract — the queue shape, the command's step-by-step gate
order, the transition graph, the outcome mapping, the migration path, the route
pinning and the explicit non-goals — is pinned in
`odd/tasks/fisc-004-queued-fiscal-submission.md`, including the decisions that
need the maintainer's nod.

## Out of Scope

- Real provider network calls and the third-party adapter — [[EPIC-16]].
- A new queue or broker technology; BullMQ and the existing worker deployable
  are the only ones used.
- Portal/KuDE document exposure and any read route: the command returns the
  created document and [[FISC-005]] owns the surface, so no `fiscal.read` key is
  added.
- `cancel` and `retry` routes, and `cancel` on the provider port ([[FISC-005]]).
- An `InvoiceConfirmed` event, which [[DEC-047]] keeps unused.
- A reconciliation sweep for a crash between the commit and the enqueue;
  recorded as technical debt with the branding cleanup sweep named as the
  template.

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
  request: the queue's deterministic `jobId` and the document's partial unique
  index agree on what "the same request" means.
- Queue failure does not rewrite Billing history: a failed submission changes
  the fiscal document only.
- A repeat issue command cannot create a second live document, so no
  `Idempotency-Key` is required — the state proves it.
- Provider snapshots are sanitized before they are persisted, and are never
  returned by an API response.
- Money crosses to the provider as decimal strings.

## API

### Added

```text
POST /fiscal-documents   body { invoiceId }   permission fiscal.invoice.issue
```

The route is pinned in `apps/api/src/rbac/route-contract.probe.test.ts` in the
same work unit, with a `FISCAL_PERMISSION_BY_ROUTE` map and the per-domain test
that mirrors the billing one.

Response: the allowlisted DTO
`{ id, invoiceId, provider, status, attemptCount, externalId, cdc, lastErrorCode, createdAt, updatedAt }`.
Snapshots are CONFIDENTIAL and are never returned.

### Changed

```text
None. Billing confirm does not emit or dispatch anything: DEC-047 keeps the
queue producer Fiscal-owned, and Billing imports nothing from fiscal/.
```

## Database

### Migration

```text
packages/database/prisma/migrations/20261003000001_fiscal_document_transition_guard/migration.sql
```

Additive: a new `fiscal_document_transition_guard()` function plus a
`BEFORE UPDATE` trigger. It must not relax the five guards FISC-002 applied. It
enforces the transition graph (`PENDING -> QUEUED, SENDING`;
`QUEUED -> SENDING`; `SENDING -> SUBMITTED, APPROVED, REJECTED, ERROR`;
`SUBMITTED -> APPROVED, REJECTED, ERROR`; `ERROR -> SENDING`), the `resolved_at`
biconditional for `APPROVED`/`REJECTED`, and that an already-set `external_id`,
`cdc`, `submitted_at` or `resolved_at` is never cleared.

`CANCELLED` and `CANCEL_PENDING` are excluded because cancellation is
[[FISC-005]], which extends this guard in its own additive migration — the same
follow-up tightening pattern BILL-003 used for the invoice header guard.

### Models/Tables

- `FiscalDocument`, unchanged in shape: the flow needs no new column, since
  `QUEUED`/`SENDING`/`attempt_count`/`last_attempt_at` already express it.

## UI

- None unless accepted decisions place status in this slice.

## Implementation Summary

_Not implemented._

## Verification

```text
Not run.
```

## Tests Added

- `packages/fiscal` (after the move): the FISC-003 suites, unchanged in intent.
- `apps/api/src/fiscal/fiscal.integration.test.ts` — the command's gate order,
  the confirmed-invoice requirement, the repeat-command conflict, the audit row,
  and the tenant isolation of a foreign invoice.
- `apps/api/src/fiscal/fiscal-submission.producer.test.ts` — the payload, the
  deterministic `jobId`, the bounded attempts and backoff, and queue-error
  propagation, with a fake `Queue`.
- `apps/worker/src/fiscal-submission/fiscal-submission.consumer.test.ts` — the
  Redis-free processor seam.
- `apps/worker/src/fiscal-submission/fiscal-submission.handler.test.ts` — the
  transition into `SENDING`, the outcome mapping for each of DEC-049's five
  literals, the sanitized snapshots, the retry rethrow on `TRANSIENT_FAILURE`,
  the audit rows, and the no-op on an already-terminal document.
- `packages/database/src/schema-fiscal-transition-guard.test.ts` — the additive
  migration, the allow-list, the biconditional and the never-cleared columns.
- `apps/api/test/live-pg-isolation.e2e-spec.ts` — an `EPIC-15 fiscal submission`
  block: the route over real HTTP, the repeat-command conflict, the forced
  concurrent-issue overlap proving one document and one job, and the guard's
  rejections at the applied schema.

## Known Limitations

- Fake provider only; no production adapter until [[EPIC-16]].
- A crash between the command's commit and its enqueue can leave a document
  `QUEUED` with no job. The worker's tolerance of `PENDING` or `QUEUED` shrinks
  the window, and the reconciliation sweep that would close it is recorded as
  technical debt with the branding cleanup sweep as the template.
- The transition guard covers the submission flow only; `CANCELLED` and
  `CANCEL_PENDING` arrive with [[FISC-005]]'s cancellation flow.
- No read route and no manual retry or cancel route: the command returns the
  created document, and [[FISC-005]] owns the surface.
- `xmlStorageKey`/`kudeStorageKey` stay null: the fake produces no artifact.

## Technical Debt

- None planned.

## Decisions / ADRs

- Depends on accepted [[DEC-047]], [[DEC-048]], [[DEC-049]] and [[DEC-050]].
- [[DEC-047]] selects the explicit issue command over an `InvoiceConfirmed`
  consumer, keeps the producer Fiscal-owned, and states that Billing does not
  enqueue directly.
- [[DEC-049]] supplies the idempotency rule (Fiscal-owned uniqueness plus
  deterministic job identity, retries update the same document) and the error
  taxonomy the handler maps.
- No ADR: no runtime, broker, ORM, protocol or auth change. Moving the provider
  boundary into `packages/fiscal` mirrors `packages/storage` and is not on the
  complexity-budget list.

## Files / Modules

- `packages/fiscal/src/*` — the provider port, fake, sanitizer and queue
  contract
- `apps/api/src/fiscal/*` — controller, service, repository, dto, zod,
  permissions, module and the submission producer
- `apps/worker/src/fiscal-submission/*` — consumer and handler
- `packages/database/prisma/migrations/20261003000001_fiscal_document_transition_guard/`
- `apps/api/src/rbac/route-contract.probe.test.ts`
- `apps/worker/src/worker.module.ts`
- `apps/api/src/fiscal/fiscal-boundary.test.ts` — the corrected Billing rule

## Completion Notes

_Status must remain non-done until all required gates pass._
