---
feature: fisc-004-queued-fiscal-submission
epic: EPIC-15
story: FISC-004
status: in-progress
created: 2026-10-02
updated: 2026-10-02
branch: feat/epic-15-fiscal-submission
base_commit: b4b9f46
---

# FISC-004 Queued fiscal submission — ODD task tracker

## Goal

Ship the explicit Fiscal issue command, the BullMQ submission queue with its
worker consumer, and the status transition guard that FISC-002 deliberately
deferred — so a confirmed invoice can produce exactly one eligible fiscal
submission, idempotently, with bounded retry and tenant-safe evidence.

## TDD resolution

- Mode: **off**. Authoritative source: `openspec/config.yaml` sets
  `strict_tdd: false` and `rules.apply.tdd: false`.
- Gates: the focused API and worker suites, the live-PostgreSQL suite,
  `typecheck`, `lint`, `build`, `format-check`.

## DECISIONS NEEDING THE MAINTAINER'S NOD

These are the calls with real consequences. Everything else below is technical
detail the accepted decisions already authorise.

### D1 — The Fiscal provider boundary must move into a package (structural)

`apps/worker` cannot import `apps/api`. The FISC-003 port, fake and sanitizer
live in `apps/api/src/fiscal/`, so today the worker has **no import path** to
the provider boundary it must call.

**Recommended**: create `packages/fiscal` holding the provider port, the fake
provider, the snapshot sanitizer and the queue contract, and leave
`apps/api/src/fiscal/` with the API-side module, service, controller and
repository. This mirrors `packages/storage` exactly — port and drivers in the
package, `StorageModule.forRoot()` selecting the implementation in the app.

**Alternative**: put the same files in `packages/shared`, which both deployables
already depend on. Cheaper, but `packages/shared` would then hold a fake
implementation and a sanitizer rather than contracts and primitives.

No ADR is required either way: a workspace package is not on the AGENTS.md
complexity-budget list, and no runtime, broker, ORM or protocol changes.

### D2 — Route shape

**Recommended**: `POST /fiscal-documents` with body `{ invoiceId }`. The Fiscal
domain owns the namespace and the created resource is the fiscal document, so
FISC-005's retry and cancel actions sit beside it as
`POST /fiscal-documents/:id/retry` and `.../cancel`. A route under `/invoices`
would put a Fiscal-owned resource in Billing's namespace.

### D3 — Idempotency without an `Idempotency-Key`

**Recommended**: no `Idempotency-Key`. FISC-002's partial unique index
`(tenant_id, invoice_id) WHERE status <> 'CANCELLED'` already makes a second
live document impossible, so a repeat `POST` cannot apply a second effect and
returns a stable `409 CONFLICT` instead. This applies [[DEC-041]]'s own rule: a
key is required only when a retry could apply a second effect the current state
cannot prove was already applied. A manual retry is [[DEC-049]]'s separate
explicit operation, not a repeat of this command.

### D4 — The transition graph, and one deliberate relaxation

Pinned, and only now that the flow that uses it exists:

```text
PENDING   -> QUEUED, SENDING
QUEUED    -> SENDING
SENDING   -> SUBMITTED, APPROVED, REJECTED, ERROR
SUBMITTED -> APPROVED, REJECTED, ERROR
ERROR     -> SENDING
```

`PENDING -> SENDING` is the relaxation: the command marks the document `QUEUED`
and then enqueues post-commit (the shipped branding precedent), so a crash
between the commit and the enqueue would otherwise strand a `QUEUED` document
with no job. Letting the worker accept `PENDING` or `QUEUED` shrinks that
window's blast radius. `ERROR -> SENDING` is BullMQ retrying the **same** job,
not a re-enqueue.

`CANCELLED` and `CANCEL_PENDING` are excluded: cancellation is [[FISC-005]],
which extends the guard in its own additive migration. This is the same
follow-up tightening pattern BILL-003 used for the invoice header guard.

### D5 — No reconciliation sweep in this slice

A crash between the commit and the enqueue still leaves a document with no job
once its BullMQ retries are exhausted. The shipped answer to exactly this
problem is the branding cleanup's reconciliation sweep, and adding one here
roughly doubles the slice. **Recommended**: record it as technical debt with the
branding precedent named as the template, rather than half-building it.

## Pinned technical contract (binding on the writer)

### Queue contract — `packages/fiscal/src/fiscal-submission.queue.ts`

Mirror `packages/shared/src/branding-reset-cleanup.ts` exactly:

```ts
export const FISCAL_SUBMISSION_QUEUE = "fiscal-submission";
export const FISCAL_SUBMISSION_JOB = "submit";
export const FISCAL_SUBMISSION_MAX_ATTEMPTS = 5;
export const FISCAL_SUBMISSION_BACKOFF_DELAY_MS = 1_000;

export interface FiscalSubmissionJob {
  readonly fiscalDocumentId: string;
  readonly tenantId: string;
}

export function fiscalSubmissionJobOptions(fiscalDocumentId: string) {
  return {
    jobId: `fiscal-submit:${fiscalDocumentId}`, // deterministic identity, DEC-049
    attempts: FISCAL_SUBMISSION_MAX_ATTEMPTS,
    backoff: {
      type: "exponential" as const,
      delay: FISCAL_SUBMISSION_BACKOFF_DELAY_MS,
    },
    removeOnComplete: true,
    removeOnFail: false, // a terminal failure stays visible
  };
}
```

`jobId` is derived from the document id, so the DB uniqueness and the queue
dedupe agree on what "the same logical request" means. `removeOnFail: false`
differs from the branding precedent on purpose: a failed fiscal submission is
evidence an operator needs, and FISC-005's manual retry reads it.

The payload carries **stable ids only**, never a document dump, per the internal
events payload rule.

### API side — `apps/api/src/fiscal/`

```text
fiscal.controller.ts        @Controller("fiscal-documents"), POST, parseInput
fiscal.dto.ts               allowlisted FiscalDocumentResponse
fiscal.permissions.ts       Object.freeze({ issue: "fiscal.invoice.issue" })
fiscal.repository.ts        tenant-safe reads: invoice + lines, document CRUD, row lock
fiscal.service.ts           the issue command
fiscal.zod.ts               createFiscalDocumentBody = { invoiceId: uuid }.strict()
fiscal.module.ts            adds the controller, service, repository, producer provider
fiscal.integration.test.ts
fiscal-submission.producer.ts   FiscalSubmissionProducer port + BullMQ implementation
```

The producer mirrors `branding-reset-cleanup.producer.ts`: an exported token
`FISCAL_SUBMISSION_PRODUCER`, an interface with
`enqueue(document): Promise<void>`, a `BullMqFiscalSubmissionProducer`, a
`createBullMqFiscalSubmissionProducer(redisUrl)` factory, and a module provider
that requires `REDIS_URL` (the branding module's exact pattern).

### The command, step by step

Gate order, all outside the transaction, matching Billing:

1. `assertFiscalEnabled()` — `EntitlementsService.has(tenantId, "fiscal")`, else
   `FEATURE_NOT_ENTITLED` with a stable `FISCAL_FEATURE_NOT_ENTITLED_MESSAGE`.
2. `requirePermission(FISCAL_PERMISSIONS.issue)`.
3. `requestContext.requireUserProfileId()`.

Then, in one transaction:

4. Read the invoice tenant-scoped, `FOR UPDATE` (the `lockById` precedent). Not
   found → `404` via `NOT_FOUND`.
5. Require `status = 'CONFIRMED'` → else `409` with
   `FISCAL_INVOICE_NOT_CONFIRMED_MESSAGE`.
6. Look for the live document. If one exists:
   - `PENDING` → set `QUEUED` (the enqueue never landed) and continue;
   - anything else → `409` `FISCAL_DOCUMENT_ALREADY_ISSUED_MESSAGE`.
7. Otherwise insert a `PENDING` document with `provider` from the resolved
   provider, then set it `QUEUED` in the same transaction. A `P2002` on the
   partial index maps to the same `409` (the `isInvoiceSaleConflict` precedent).
8. Append one audit row: action `fiscal.document.issue_requested`, target type
   `fiscal_document`, metadata `{ schemaVersion, invoiceId }`.

Commit, then enqueue **outside** the transaction, passing only the document id
and tenant id. Enqueue failure is not swallowed: it surfaces as `500` and the
document stays `QUEUED`, which D5 records.

The response is the allowlisted DTO, never a Prisma model:
`{ id, invoiceId, provider, status, attemptCount, externalId, cdc, lastErrorCode, createdAt, updatedAt }`.
Snapshots are **never** returned — they are CONFIDENTIAL.

### Worker side — `apps/worker/src/fiscal-submission/`

Mirror the branding consumer's three-file shape:

```text
fiscal-submission.consumer.ts   createFiscalSubmissionProcessor(handler) pure seam
                                + the Nest consumer constructing new Worker(...)
fiscal-submission.handler.ts    FiscalSubmissionHandler
```

- `createFiscalSubmissionProcessor` is Redis-free and unit-tested with a plain
  `{ data: {...} } as Job<FiscalSubmissionJob>`, exactly as
  `cleanup.consumer.test.ts` does.
- The handler is tenant-aware, resolves the document by `(tenantId, id)`, and:
  1. transitions `PENDING`/`QUEUED`/`ERROR` → `SENDING`, incrementing
     `attemptCount` and setting `lastAttemptAt`;
  2. builds `FiscalIssueRequest` by reading the invoice and its lines (money as
     decimal strings, `issuedAt` from `confirmedAt`);
  3. calls `FISCAL_PROVIDER.issue(request)`;
  4. sanitizes `providerRequest`/`providerResponse` with
     `sanitizeProviderSnapshot` **before** persisting;
  5. maps the outcome onto the graph: `APPROVED` → `APPROVED` with
     `externalId`/`cdc`/`resolvedAt`; `REJECTED` and `FUNCTIONAL_REJECTION` →
     `REJECTED` with `reasonCode`/`reason`/`resolvedAt`; `CONFIGURATION_ERROR` →
     `ERROR` with `reasonCode`/`reason`; `TRANSIENT_FAILURE` → `ERROR` with
     `reasonCode`/`reason` and then **rethrow**, so BullMQ's bounded exponential
     backoff owns the retry;
  6. appends one audit row per attempt: `fiscal.document.submitted` on a
     resolved outcome, `fiscal.document.submission_failed` on `ERROR`.
- A document already in a terminal or in-flight state is a no-op that returns
  without calling the provider, so a redelivered job cannot double-submit.

The outcome mapping is the one place DEC-049's four classes become two statuses,
so it ships with its own test naming each literal.

### Transition guard migration

Additive, hand-written, sorting after `20261002000001`:

```text
packages/database/prisma/migrations/20261003000001_fiscal_document_transition_guard/migration.sql
```

It adds `fiscal_document_transition_guard()` plus a `BEFORE UPDATE` trigger and
must not relax the five existing guards. It enforces:

- the D4 allow-list, with a message naming the from/to states and no stored
  value;
- `resolved_at` is non-null exactly when the new status is `APPROVED` or
  `REJECTED`, mirroring the cancellation biconditional's shape;
- an already-set `external_id`, `cdc`, `submitted_at` or `resolved_at` is never
  cleared, so a permitted transition cannot erase evidence.

The `ERROR`/`REJECTED`/`APPROVED` rows stay updatable only along the graph:
FISC-002's `cancelled_immutable` trigger already makes `CANCELLED` terminal.

### Boundary rule correction

`apps/api/src/fiscal/fiscal-boundary.test.ts` carries a case named "keeps
Billing free of Fiscal imports until FISC-004" whose comment says "FISC-004
changes this rule to: Billing imports the port only". That comment is stale
relative to [[DEC-047]]: Fiscal owns the issue command and **Billing imports
nothing from `fiscal/`**. Keep the assertion verbatim, rename the case, and drop
the "yet" from the failure message. The concrete-provider fence already covers
the other half.

### Route and permission pinning

`apps/api/src/rbac/route-contract.probe.test.ts` gains `POST /fiscal-documents`
in `EXPECTED_ROUTE_INVENTORY` and a `FISCAL_PERMISSION_BY_ROUTE` map with the
per-domain test mirroring the billing one. `fiscal.invoice.issue` is finally
consumed by a route. No new seed: the permission and the `fiscal` entitlement
both already exist, so the pinned probes stay at `permissions: 56` and
`featureCodes: 12`.

### Not in this slice

- No read route: the command returns the created document and FISC-005 owns the
  surface. No `fiscal.read` key is added.
- No `cancel`/`retry` route (FISC-005), and no `cancel` on the provider port.
- No `InvoiceConfirmed` event: [[DEC-047]] keeps it unused.
- No reconciliation sweep (D5).
- No real provider, no SIFEN protocol, no storage prefix, no KuDE.

## Tasks

- [x] T1 — Pin this contract into the FISC-004 story file.
- [x] T2 — Create `packages/fiscal` and move the port, fake, sanitizer and their
      tests from `apps/api/src/fiscal/`; keep `apps/api/src/fiscal/` for the API
      side. Reconcile imports, the boundary test and any package wiring.
- [x] T3 — Add the queue contract, the API producer and the worker consumer. The
      worker handler and its outcome mapping shipped with it, because the
      consumer has no purpose without one.
- [ ] T4 — Add the transition-guard migration plus its schema and
      live-PostgreSQL probes.
- [ ] T5 — Add the Fiscal repository, service, controller, DTO, zod schema,
      permissions and module wiring; pin the route in the route-contract probe.
- [x] T6 — Add the worker handler and its outcome mapping, with tests.
- [ ] T7 — Verify: focused suites, `pnpm test`, `db:deploy`, live-PostgreSQL,
      `typecheck`, `lint`, `build`, `format-check`; then the native review.

## Harness consequence worth remembering

Adding a provider whose factory requires `REDIS_URL` breaks every suite that
boots `AppModule` unless the test harness overrides it. `FiscalModule`'s
producer did exactly that: **33 API test files failed** until
`apps/api/test/support/boot-test-app.ts` and the live-PostgreSQL spec gained a
recording fake plus a token-identity pin, mirroring what the branding cleanup
producer already required. Any future Redis-backed provider must do the same in
the same commit.

## Environment note

Docker is unavailable again in this WSL distro, so PostgreSQL is down and the
live-PostgreSQL suite plus `db:deploy` **cannot run locally** for this slice.
Every other gate runs and is green. CI's `Database migrations` job applies the
migrations to a fresh PG16 and runs the suite, so the applied-schema evidence
for this slice is produced by CI — the same compensating control [[TD-027]]
recorded before it was resolved. Record the execution state honestly rather than
treating the missing run as a pass.

## Notes

- Base commit `b4b9f46` (merged `main`, EPIC-15 kickoff + FISC-002 + FISC-003).
- This is the densest slice of the epic: it touches a package, the API, the
  worker, the database and the route inventory. Two work units are expected, and
  the review-workload risk is real — say so rather than shipping one oversized
  diff.
- The live-PostgreSQL harness has **no** queue or worker case today: the
  producer is faked through `overrideProvider`, exactly as the branding cleanup
  producer is. Any live-PG fiscal command case follows that pattern.
