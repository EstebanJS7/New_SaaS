---
type: module
status: implemented
epic: EPIC-15
updated: 2026-10-03
---

# Fiscal

The Fiscal module owns the provider boundary and the tenant-scoped fiscal
document record: the application port, the deterministic fake provider, the
sanitized snapshot boundary, the queued submission, the explicit issue and
cancel commands, the read contract and the staff workspace that operates them.
Fiscal is a Core Business domain. It reads a confirmed invoice through its own
repository and writes only its own aggregate; it performs no money arithmetic,
duplicates no invoice data and never imports Billing ([[DEC-046]], [[DEC-048]],
[[DEC-051]]).

Implemented by [[FISC-002]] (data foundation), [[FISC-003]] (provider port and
fake), [[FISC-004]] (queued submission and the issue command), [[FISC-005]]
(cancellation hand-off, read contract and staff surface) and [[TD-028]] (the
recovery sweep). The documented behavior is implemented behavior, not a claim of
production readiness: the only provider is a deterministic fake, and no real
SIFEN adapter exists until [[EPIC-16]].

## Owned tables

| Table                    | Purpose                                                                                                                                                                                                                                                                                          |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `fiscal_document`        | The tenant-scoped submission record: source `invoice_id`, `provider`, `status`, provider references (`external_id`, `cdc`), XML/KuDE storage keys, sanitized request/response snapshots, attempt counters, last-error fields and the `submitted_at` / `resolved_at` / `cancelled_at` timestamps. |
| `fiscal_provider`        | The provider vocabulary enum: `THIRD_PARTY`, `SIFEN_DIRECT`, `FAKE`.                                                                                                                                                                                                                             |
| `fiscal_document_status` | The lifecycle enum: `PENDING`, `QUEUED`, `SENDING`, `SUBMITTED`, `APPROVED`, `REJECTED`, `ERROR`, `CANCEL_PENDING`, `CANCELLED`. The SIFEN `SIGNING` stage is deliberately absent because XAdES signing is a real-adapter concern (PRD §23, [[DEC-047]]).                                        |

`fiscal_document` is tenant-scoped, carries the composite `(tenant_id, id)`
ownership key and a composite `RESTRICT` foreign key to `invoice`. It duplicates
**no** invoice series, number, currency, customer or money: a confirmed invoice
is immutable, so a consumer reads the request data through the composite
tenant-ownership reference. Migrations: `20261002000001_fiscal_data_foundation`,
`20261003000001_fiscal_document_transition_guard` and
`20261004000001_fiscal_document_cancellation_guard`.

## Routes

Every route requires the `fiscal` entitlement and its listed permission; the
entitlement is asserted before the granular permission, reads included. Tenant
identity comes from authenticated server context, not caller input.

| Route                               | Permission             | Contract                                                                                                                                                            |
| ----------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /fiscal-documents`            | `fiscal.invoice.issue` | Create and queue a document from one confirmed in-tenant invoice (`201`); body carries the invoice reference only. A second live document is `409`.                 |
| `GET /fiscal-documents`             | `fiscal.read`          | List tenant documents, ordered `createdAt desc`; optional `status` filter with no implicit default. There is no pagination.                                         |
| `GET /fiscal-documents/:id`         | `fiscal.read`          | Read one document; foreign and unknown IDs share a byte-equivalent `404`.                                                                                           |
| `POST /fiscal-documents/:id/cancel` | `fiscal.invoice.issue` | Cancel (`200`) with a required reason of at most 500 characters. An already cancelled document replays as `200`; a `SENDING` document is `409`. No idempotency key. |

There is no update, delete, retry, status patch or reopen route. Cancellation
reuses `fiscal.invoice.issue` because no separate cancel key was accepted
([[DEC-048]]); `fiscal.read` was added by FISC-005b for the read contract. Reads
are never audited.

## Invariants

- **One live document per invoice.** The partial unique index
  `fiscal_document_tenant_id_invoice_id_key` covers `(tenant_id, invoice_id)`
  while `status <> 'CANCELLED'`. Re-issuing therefore requires an explicit
  cancellation first; a second live document is database-impossible.
- **Cancellation agrees with its timestamp.** The
  `fiscal_document_cancelled_at_iff_cancelled` CHECK requires `cancelled_at` to
  be present exactly when the status is `CANCELLED`, so every edge into
  `CANCELLED` must set it.
- **Attempts never decrease and are never negative.** The
  `fiscal_document_attempt_count_positive` CHECK and the
  `fiscal_document_attempts_monotonic_trigger` guard enforce it; a requeue never
  resets the counter, which is the document's attempt history.
- **Status moves only along the pinned graph.** The
  `fiscal_document_transition_guard` function, installed by its own trigger,
  admits exactly:

  ```text
  PENDING        -> QUEUED, SENDING, CANCELLED
  QUEUED         -> SENDING, CANCELLED
  SENDING        -> SUBMITTED, APPROVED, REJECTED, ERROR
  SUBMITTED      -> APPROVED, REJECTED, ERROR, CANCEL_PENDING
  APPROVED       -> CANCEL_PENDING
  REJECTED       -> CANCELLED
  ERROR          -> SENDING, CANCELLED
  CANCEL_PENDING -> CANCELLED
  ```

  `SENDING -> CANCELLED` is deliberately excluded: a worker holds that claim and
  may be mid-call. Every other transition is rejected with a message naming both
  states and never a stored value.

- **`resolved_at` is an implication, not a biconditional.** Entering `APPROVED`
  or `REJECTED` requires it; it is never required to be absent otherwise. This
  is what makes `APPROVED -> CANCEL_PENDING -> CANCELLED` legal while a
  cancelled document keeps the resolution timestamp it already had. A
  biconditional would have made that path impossible.
- **Evidence is never cleared.** `external_id`, `cdc`, `submitted_at` and
  `resolved_at` cannot be set back to `NULL`.
- **Identity and provider references are immutable.** A trigger rejects changes
  to `tenant_id`, `id`, `invoice_id`, `provider` and `created_at`; `external_id`
  and `cdc` are write-once once non-null.
- **A document is never deleted, and `CANCELLED` is terminal.** Delete is
  rejected outright and a `CANCELLED` row cannot be updated. PostgreSQL fires
  same-timing `BEFORE` triggers in name order, so a `CANCELLED -> *` attempt is
  rejected by the cancellation trigger rather than by the transition guard.
- **Snapshots are sanitized before persistence.** The provider's raw request and
  response are allowlisted, depth- and length-bounded and secret-redacted before
  they reach `request_snapshot` / `response_snapshot`; the sanitizer redacts
  rather than throws, because a throw inside a submission path would turn a safe
  payload into a failed document.
- **Fiscal never imports Billing.** The dependency is one-way: Billing consults
  a Fiscal read service, and Fiscal reads invoices through its own repository.

## The provider boundary

`packages/fiscal` holds the boundary both deployables consume:

- `FiscalProviderPort` with the `FISCAL_PROVIDER` injection token, mirroring the
  shipped `STORAGE_PORT` precedent, so a consumer depends on the port and never
  an implementation.
- `FiscalIssueRequest` carries the invoice's frozen snapshot with money as
  **decimal strings**, so no float crosses the boundary. `FiscalCancelRequest`
  additionally carries an optional `AbortSignal` so an adapter can abandon a
  call whose deadline the caller has already enforced.
- `FiscalIssueResult` and `FiscalCancelResult` are data, not thrown errors:
  `APPROVED` / `REJECTED` / `FUNCTIONAL_REJECTION` / `CONFIGURATION_ERROR` /
  `TRANSIENT_FAILURE` for a submission, and `CANCELLED` / `CANCEL_PENDING` /
  `REJECTED` / `CONFIGURATION_ERROR` / `TRANSIENT_FAILURE` for a cancellation.
  `isRetryableOutcome` is true for `TRANSIENT_FAILURE` only, and one predicate
  serves both.
- `FakeFiscalProvider` is a deterministic ordered-script fake (`outcomes` and
  `cancelOutcomes`, the last element repeating) that produces **no** XML,
  signature or protocol artifact, because PRD §23 forbids implementing SIFEN
  details from memory.
- `FiscalProviderModule` is the only place the concrete implementation is
  created, selected from `FISCAL_PROVIDER`. In production an unset value is
  refused both by `apiEnvSchema` at boot and by the factory, because no
  production provider exists until EPIC-16 and silently emitting non-fiscal
  documents is worse than failing fast. `FISCAL_PROVIDER=fake` is the
  dedicated-demo path.
- A source-text boundary test keeps the concrete provider inside the Fiscal
  composition area and keeps `@newsaas/fiscal` imports out of every other
  domain.

## The queued submission

`POST /fiscal-documents` commits the document as `QUEUED` and enqueues one
BullMQ job **after** the commit, through a producer port rather than BullMQ
directly. The job payload carries stable IDs only —
`{ fiscalDocumentId, tenantId }` — never a document dump.

- Queue `fiscal-submission`, job `submit`, deterministic `jobId`
  `fiscal-submit:<documentId>`, 5 attempts, exponential backoff from 1 s,
  `removeOnComplete: true`, `removeOnFail: false`. The deterministic job ID
  makes queue dedupe and the partial unique index agree on what "the same
  logical request" means.
- The producer is bounded: fail-fast Redis options (`maxRetriesPerRequest: 2`,
  `enableOfflineQueue: false`, 2 s `connectTimeout`) plus a 2 s `queue.add`
  deadline, so a Redis outage cannot hang an HTTP request.
- The worker claims the document with a compare-and-set into `SENDING`, commits
  that claim, calls the provider **outside** any transaction, sanitizes both raw
  payloads, maps the outcome onto the graph and writes one `SYSTEM` audit row
  per attempt. A `TRANSIENT_FAILURE` is persisted as `ERROR` and then rethrown
  so BullMQ's bounded backoff owns the retry.
- The claim is committed before the provider call, so a worker that dies in
  between would strand the row. A five-minute **claim lease** closes that
  window: past the lease the claim is treated as abandoned and a delivery may
  take it over by compare-and-swap on the observed `lastAttemptAt`, so two
  workers that both see the same abandoned claim cannot both win it.
- The recovery sweep (`recoverStaleFiscalSubmissions` plus
  `redriveFiscalSubmission`) covers what the lease cannot: a document whose
  attempts are spent, or whose enqueue failed and so has no job at all. It
  selects `QUEUED` / `ERROR` documents whose effective last activity is older
  than a five-minute window (equal to the lease, and well above the ~31 s retry
  budget), in batches of 100, and re-drives each one without aborting the
  backlog on a single failure. A terminal job is removed before re-adding,
  because a deterministic job ID plus `removeOnFail: false` would otherwise make
  the re-add a silent BullMQ dedupe no-op. Each successful re-drive is audited
  as `fiscal.document.submission_requeued` with `actorType: SYSTEM`.
- Timing is configurable through `FISCAL_SUBMISSION_SWEEP_INTERVAL_MS` (default
  60 s) and `FISCAL_SUBMISSION_STALE_MS` (default 300 s).

### Retry and idempotency

No command requires an `Idempotency-Key`. The state itself proves a second
effect is impossible: the partial unique index admits only one live document per
invoice, the handler is idempotent by state (a `PROVIDER_OWNED_OR_TERMINAL`
status returns without calling the provider), and a repeat issue on a live
document is a `409`. A repeat cancel on a `CANCELLED` document is a `200` replay
with the same representation and no second audit row.

## Cancellation and the Billing hand-off

The cancel command is **synchronous** and runs in three phases, because
AGENTS.md forbids external fiscal calls inside long-running database
transactions:

1. a short transaction that locks the document `FOR UPDATE` and classifies it;
2. the provider `cancel` call, outside any transaction, bounded by a 10 s
   deadline (`FISCAL_CANCEL_TIMEOUT_MS`), with an `AbortSignal` handed to the
   adapter;
3. one transaction that applies the outcome through a conditional write pinned
   to the observed status and co-commits the audit row.

A `CANCELLED` document is a `200` replay; a `SENDING` document is a stable `409`
before any provider call; a zero-row compare-and-set is a lost race and its own
`409`. Refusals are thrown **after** phase 3 commits, so the `last_error_*`
write and the audit row persist instead of rolling back. A deadline expiry is
reported as a retryable `TRANSIENT_FAILURE`, so a hung provider produces a
bounded, actionable failure rather than an open request. `TRANSIENT_FAILURE`
deliberately does **not** move the document to `ERROR`: the pinned graph admits
`ERROR` only from `SENDING` and `SUBMITTED`, so a transient cancel failure
leaves the status and stores the error.

[[DEC-051]] then makes the two-step flow explicit. Billing consults
`FiscalService.hasLiveDocumentForInvoice` **inside** its own cancellation
transaction, immediately after the invoice header lock, so it serializes with
the issue command — which locks the same invoice header before creating the
document. Any live (non-`CANCELLED`) document blocks the Billing cancellation
with a stable `409` naming the Fiscal cancellation route, because only Fiscal
can release the invoice's slot at the partial unique index. The transaction
handle crosses the boundary through a minimal structural read type, so Billing
never imports the Fiscal package or its persistence types.

## Staff surface

`/app/fiscal` provides the status-filtered document list, the document detail
with its provider references, attempt count, last error and timestamps, the
issue panel and the cancel form. It covers loading, empty, error, success,
permission-denied and entitlement-denied states. The navigation entry declares
`requiredFeature: "fiscal"`.

All browser API calls go through the `/api/fiscal` proxy, which allowlists
exactly the four operations and forwards staff cookie context only. It does not
accept portal context or synthesize tenant authority, and the backend remains
the authority for permission and entitlement checks. The client pins its own
runtime status mirror because the API's status union is server-side only, and it
renders an API `409` verbatim rather than replacing it with an invented local
rule.

## Does Not Own

- **A real fiscal provider, SIFEN Direct, XAdES signing or KuDE rendering** —
  [[EPIC-16]]; PRD §23 forbids implementing protocol details from memory.
- **The invoice aggregate, its numbering or its transitions** — Billing,
  [[EPIC-14]] and [[DEC-042]].
- **The portal fiscal document surface** — deferred ([[TD-022]]).
- **Operator-triggered re-drive** — no retry route exists; [[TD-029]].
- **Reports and dashboards** — [[EPIC-18]].
- **Notification delivery** — [[EPIC-17]].
- **Any tenant setting** — no `fiscal-ui` namespace ships ([[DEC-052]]).

## Audit and classification

Accepted mutations write one co-committed audit row:
`fiscal.document.issue_requested`, `fiscal.document.cancellation_requested` and
`fiscal.document.cancellation_failed` from the API, and
`fiscal.document.submitted`, `fiscal.document.submission_failed` and
`fiscal.document.submission_requeued` from the worker with `actorType: SYSTEM`.
Audit metadata carries a schema version, the outcome and field names only —
never the cancellation reason text and never a provider payload. Reads are not
audited.

Provider references (`external_id`, `cdc`, storage keys) and the
request/response snapshots are CONFIDENTIAL; status, attempt counters and
timestamps are INTERNAL (PRD §41). Logs and audit carry IDs and field names
only.

## Settings

No `fiscal-ui` tenant-settings namespace is registered. PRD §38 names it, but
the scoped surface needs no configurable value, and a namespace with no consumer
is config surface for its own sake ([[DEC-052]]). The two operational timings
the submission path needs are environment variables, not tenant settings,
because they are deployment concerns rather than tenant behavior.

## Tests

- `packages/database/src/schema-fiscal.test.ts`,
  `schema-fiscal-transition-guard.test.ts`,
  `schema-fiscal-cancellation-guard.test.ts` and `reference-seed.test.ts` —
  tables, constraints, the trigger catalogue, the transition graph per edge and
  the seed probes. Database suite: **21 files / 416 tests**.
- `packages/fiscal/src/*` — the port, the fake's ordered scripts, the sanitizer
  and the queue contract. Fiscal suite: **5 files / 50 tests**.
- `apps/api/src/fiscal/*` — the issue, cancel and read integration suites (**21
  cases**), the boundary rule, the producer deadline and the module composition.
  API suite: **81 files / 1068 tests**.
- `apps/worker/src/fiscal-submission/*` — the handler's claim, lease, outcome
  mapping and audit, the consumer, and the recovery sweep. Worker suite: **9
  files / 72 tests**.
- `apps/web/src/app/(app)/app/fiscal/*` and
  `apps/web/src/app/api/fiscal/[[...path]]/route.test.ts` — client, display,
  validation, outcome, panels, workspace states and the proxy contract (**7
  cases**). Web suite: **99 files / 1087 tests**.
- `apps/api/test/live-pg-isolation.e2e-spec.ts` — the applied schema, the
  trigger catalogue, the transition graph per edge including the cancellation
  edges, and the `APPROVED -> CANCEL_PENDING -> CANCELLED` path: **213 cases**.

## Known limitations

- The only provider is a deterministic fake. No real SIFEN adapter, XML,
  signature or KuDE exists until [[EPIC-16]].
- There is no operator-triggered re-drive: a document whose attempts are spent
  waits for the sweep's five-minute window ([[TD-029]]).
- No `fiscal-ui` settings namespace ships, so PRD §38's namespace is
  unregistered ([[DEC-052]]).
- `GET /fiscal-documents` is unbounded ([[TD-026]]).
- The navigation entitlement gate is dormant because no browser-side entitlement
  source is wired; the backend gate remains authoritative.
- The portal fiscal document surface is deferred ([[TD-022]]).
- Four advisories from the TD-028 review remain open: the sweep's batch limit
  has no progress guard, a skipped re-drive is counted as requeued, the overlap
  guard is not unit-covered, and a `SUBMITTED` outcome is not audited.
- Fourteen non-blocking advisories from the FISC-005a native review are recorded
  in the story tracker; the review itself closed approved.
