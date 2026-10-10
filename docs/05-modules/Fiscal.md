---
type: module
status: implemented
epic: EPIC-15 + EPIC-16
updated: 2026-10-09
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
(cancellation hand-off, read contract and staff surface), [[TD-028]] (the
recovery sweep), [[FISC-007]] (the tenant signing-material boundary), and
[[FISC-008]], [[FISC-009]], [[FISC-010]], [[FISC-011]] and [[FISC-012]] for the
SIFEN Direct path: the DE builder and its XSD gate, the XMLDSig signer, the
web-service client, the timbrado ranges, the real adapter and the
reconciliation.

The documented behavior is implemented behavior, not a claim of production
readiness. Two capabilities are **deliberately absent and fail closed**: the
worker cannot build a document, because the fiscal identity a DE needs is
[[FISC-015]]'s, and `cancel` refuses, because SIFEN's cancellation event is
unprofiled and [[FISC-016]] owns it. Nothing in this module has been proven
against DNIT; that is [[FISC-013]].

## Owned tables

| Table                                                           | Purpose                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fiscal_document`                                               | The tenant-scoped submission record: source `invoice_id`, `provider`, `status`, provider references (`external_id`, `cdc`), XML/KuDE storage keys, sanitized request/response snapshots, attempt counters, last-error fields, the `submitted_at` / `resolved_at` / `cancelled_at` timestamps, and `next_query_at` — the instant the reconciliation may next query the provider, written by the handler when the row enters `SUBMITTED` and moved forward by the sweep. |
| `fiscal_provider`                                               | The provider vocabulary enum: `THIRD_PARTY`, `SIFEN_DIRECT`, `FAKE`.                                                                                                                                                                                                                                                                                                                                                                                                   |
| `fiscal_document_status`                                        | The lifecycle enum: `PENDING`, `QUEUED`, `SENDING`, `SUBMITTED`, `APPROVED`, `REJECTED`, `ERROR`, `CANCEL_PENDING`, `CANCELLED`, `SIGNING`. The SIFEN signing stage was deliberately absent while a fake stood in for the provider ([[DEC-047]]); [[FISC-009]] returns it. `SIGNING` is declared **last** because PostgreSQL's `ALTER TYPE ... ADD VALUE` appends — the lifecycle's order lives in the transition guard, not in the enum.                              |
| `tenant_secret`                                                 | **RESTRICTED.** One sealed tenant secret: the AES-256-GCM ciphertext, the per-secret data key wrapped by the platform master key, and the master-key version that wrapped it. No plaintext, no unwrapped key and no password is ever stored, and no log, DTO or audit payload may carry a column of this table.                                                                                                                                                        |
| `tenant_fiscal_signing_material`                                | **INTERNAL.** The tenant's SIFEN certificate and its metadata, plus an opaque `credential_ref` into `tenant_secret` for the private key. A partial unique index permits at most one `ACTIVE` material per tenant and environment; retirement destroys the stored key and keeps the row as the record.                                                                                                                                                                  |
| `fiscal_signing_environment` / `fiscal_signing_material_status` | The `TEST`/`PRODUCTION` environment enum and the `ACTIVE`/`RETIRED` status enum. Evolve additively only.                                                                                                                                                                                                                                                                                                                                                               |

`fiscal_document` is tenant-scoped, carries the composite `(tenant_id, id)`
ownership key and a composite `RESTRICT` foreign key to `invoice`. It duplicates
**no** invoice series, number, currency, customer or money: a confirmed invoice
is immutable, so a consumer reads the request data through the composite
tenant-ownership reference. Migrations: `20261002000001_fiscal_data_foundation`,
`20261003000001_fiscal_document_transition_guard`,
`20261004000001_fiscal_document_cancellation_guard`,
`20261007000001_fiscal_document_signing_state` (the `SIGNING` state),
`20261008000001_fiscal_document_provider_reference` (the operation handle, the
`submitted_at` writer and the `SUBMITTED` edges) and
`20261009000001_fiscal_document_next_query` (the reconciliation's marker, with a
bounded backfill for rows already `SUBMITTED`).

`tenant_secret` and `tenant_fiscal_signing_material` are tenant-scoped with a
composite `(tenant_id, id)` ownership key, and the secret table's reads are
scoped by tenant so a key-composition bug cannot become a cross-tenant read.
Migration: `20261004000002_fiscal_signing_material`. Three CHECK constraints
hold the retirement biconditional, the mandatory retirement reason and the
validity window; the one-`ACTIVE`-material rule is a partial unique index, which
Prisma cannot express and the migration therefore creates in raw SQL.

## Routes

Every route requires the `fiscal` entitlement and its listed permission; the
entitlement is asserted before the granular permission, reads included. Tenant
identity comes from authenticated server context, not caller input.

| Route                                      | Permission                       | Contract                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------------ | -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /fiscal-documents`                   | `fiscal.invoice.issue`           | Create and queue a document from one confirmed in-tenant invoice (`201`); body carries the invoice reference only. A second live document is `409`.                                                                                                                                                                                       |
| `GET /fiscal-documents`                    | `fiscal.read`                    | List tenant documents, ordered `createdAt desc`; optional `status` filter with no implicit default. There is no pagination.                                                                                                                                                                                                               |
| `GET /fiscal-documents/:id`                | `fiscal.read`                    | Read one document; foreign and unknown IDs share a byte-equivalent `404`.                                                                                                                                                                                                                                                                 |
| `POST /fiscal-documents/:id/cancel`        | `fiscal.invoice.issue`           | Cancel (`200`) with a required reason of at most 500 characters. An already cancelled document replays as `200`; a `SENDING` document is `409`. No idempotency key.                                                                                                                                                                       |
| `POST /fiscal/signing-material`            | `fiscal.signing_material.manage` | Load a signing material (`201`). `multipart/form-data` with `file` (a PKCS#12, at most 64 KiB), `password` and `environment` (`TEST`/`PRODUCTION`); part order is not assumed. A material already `ACTIVE` for that environment is retired and its stored key destroyed in the same transaction. Every rejection carries its own message. |
| `GET /fiscal/signing-material`             | `fiscal.signing_material.manage` | List the tenant's materials, newest first. Metadata only: the `credentialRef`, the certificate PEM and the private key are never returned.                                                                                                                                                                                                |
| `POST /fiscal/signing-material/:id/retire` | `fiscal.signing_material.manage` | Retire (`200`) with a required reason of at most 500 characters. The stored private key is destroyed in the same transaction and the row survives as the record. A repeat is `409`; an unknown or foreign id is a byte-equivalent `404`.                                                                                                  |

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
  PENDING        -> QUEUED, SIGNING, SENDING, CANCELLED
  QUEUED         -> SIGNING, SENDING, CANCELLED
  SIGNING        -> SENDING, ERROR
  SENDING        -> SUBMITTED, APPROVED, REJECTED, ERROR
  SUBMITTED      -> APPROVED, REJECTED, ERROR, CANCEL_PENDING
  APPROVED       -> CANCEL_PENDING
  REJECTED       -> CANCELLED
  ERROR          -> SIGNING, SENDING, CANCELLED
  CANCEL_PENDING -> CANCELLED
  ```

  `SENDING -> CANCELLED` is deliberately excluded: a worker holds that claim and
  may be mid-call. **`SIGNING -> CANCELLED` is excluded for the same reason** —
  `SIGNING` is a claim too, not a label attached to one, so cancelling
  underneath a signer would race it. `SIGNING -> ERROR` exists because a signing
  failure is **ours**, not the provider's, and it is the only failure that does
  not depend on a remote call. Every other transition is rejected with a message
  naming both states and never a stored value.

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
- **`FiscalIssueRequest` carries the signed document** ([[ADR-009]]): a required
  `document: FiscalIssueDocument | null` holding the CDC and the signed bytes,
  and `FiscalProviderPort.requiresSignedDocument` says whether the provider
  needs one. A provider whose flag is `true` and that is handed `null` answers
  `CONFIGURATION_ERROR` — terminal, non-retryable — and never submits or throws.
  The caller is the side that can build and sign, because the emitter profile,
  the timbrado and the allocation live in PostgreSQL, which `packages/fiscal`
  cannot reach.
- **`SifenDirectFiscalProvider` is the real adapter.** `issue` submits a **lot
  of one** through the asynchronous service — the Manual's schema admits 1–50
  `rDE` per lot and the batch is the path whose answer is asynchronous, which is
  what `SUBMITTED` and the reconciliation exist for — and answers `SUBMITTED`
  with the lot number as `providerReference` and the document's own CDC, which
  the batch answer does not carry. `query` asks by the reference when it has one
  and by the CDC otherwise, so a lost hand-over answer does not lose the
  document ([[ADR-007]] §2). `cancel` **fails closed** with
  `CANCELLATION_EVENT_UNPROFILED`: SIFEN's cancellation is an event and its
  payload is unprofiled ([[FISC-016]]).
- **The failure partition is total.** The transport's nine failures and the
  facade's one are mapped explicitly, and only the three where the request may
  never have arrived — `NETWORK_FAILURE`, `TIMEOUT`, `ABORTED` — are
  `TRANSIENT_FAILURE`; everything deterministic is terminal, so a retry cannot
  loop. A parse or serializer refusal is terminal too, and it uses a **fixed
  reason sentence** rather than the error's message, because the serializer's
  message can quote the document's first characters.
- **The snapshot is a descriptor**, not the document: the provider, the service,
  the CDC and the byte count for a request, and the answer's own code and
  message for a response. `PROVIDER_SNAPSHOT_ALLOWED_KEYS` carries the two keys
  a descriptor needs, because the sanitizer redacts an unlisted key.
- `FiscalProviderModule` is the only place the concrete implementation is
  created, selected from `FISCAL_PROVIDER`. In production an unset value is
  refused both by `apiEnvSchema` at boot and by the factory, because silently
  emitting non-fiscal documents is worse than failing fast;
  `FISCAL_PROVIDER=sifen-direct` builds the real adapter and requires
  `SIFEN_ENVIRONMENT` in production, since an absent value would point a
  production deployment at the DNIT **test** host. `FISCAL_PROVIDER=fake` is the
  dedicated-demo path and stays selectable in production, deliberately: the
  refusal is about absence, not about the fake.
- **The credential is a port**
  (`FiscalCredentialPort.read({ tenantId, environment })`), read **per call**
  and never cached, because the provider is a process singleton and a cached
  private key would be RESTRICTED material held across tenants ([[ADR-008]] §2).
  `null` is a state, not an exception: it becomes `CONFIGURATION_ERROR`, which
  is terminal. Both deployables wire the real port — the worker over its own
  Prisma client and secret store, the API over its own.
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
- The worker claims the document with a compare-and-set into `SIGNING`, runs the
  **document stage**, moves it to `SENDING` with a compare-and-set on the lease
  timestamp, calls the provider **outside** any transaction, sanitizes both raw
  payloads, maps the outcome onto the graph and writes one `SYSTEM` audit row
  per attempt. A `TRANSIENT_FAILURE` is persisted as `ERROR` and then rethrown
  so BullMQ's bounded backoff owns the retry.
- **The document stage is `build -> sign -> QR -> store -> validate`.** The
  signed XML is stored **before** the XSD gate runs, so a refused document is
  inspectable, and `xml_storage_key` is written only for a document that was
  stored. The gate runs on the **signed** document with the schema compiled once
  per process and **fails closed** — an unusable schema directory is a failure,
  not a pass — and it runs again on a resend, because [[ADR-010]] §3 says the
  gate runs before every submission. A stage failure lands on `ERROR` with a
  sanitized reason and no secret in it. **The build itself is a seam that
  answers `UNAVAILABLE`** with a named reason: the assembly is [[FISC-015]]'s,
  so a `sifen-direct` deployment refuses rather than submitting an unbuilt
  document. With the fake the stage returns before touching the builder, the
  storage or the gate.
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
- **The `ERROR` re-drive is bounded by an attempt cap.** Past it the sweep does
  not select the row again, so a permanent failure — a schema refusal, a missing
  fiscal profile — reaches an operator as a row that stays in `ERROR` with its
  code and count instead of being resubmitted forever. The cap is a count rather
  than a list of codes, because the result-code catalogue is open and a list
  would rot. **It is a one-way door**: a capped row cannot be revived by the
  sweep or by hand, which is why [[TD-029]] is urgent rather than optional.
- **The reconciliation walks `SUBMITTED`.** A second phase selects the rows
  whose `next_query_at` is due — the marker exists because the sweep's cadence
  is 60 seconds while SIFEN's poll is ten minutes (§23.7), and without it every
  due row would be queried once a minute — and asks the provider through the
  port: a terminal answer applies the status with its identity and `resolvedAt`;
  `PROCESSING` leaves the row `SUBMITTED` and moves the marker by the provider's
  own hint, and **cannot resubmit** because that phase has no queue; `0360` goes
  back to `ERROR` where the existing re-drive picks it up; and anything else
  leaves the row `SUBMITTED` with its reason recorded. `attempt_count` counts
  submissions and never queries. One row's failure is isolated — the guard sits
  around the application of the answer, records the failure, advances the marker
  and reports `unapplied` — so a single poisoned answer cannot block the batch.
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

## The signing-material boundary

SIFEN Direct makes this system the issuer, so the tenant's signing private key
enters our boundary. [[ADR-005]] introduces a reusable `SecretStore` platform
capability (`packages/secret-store`) and [[DEC-053]] records the choices behind
it: envelope encryption in PostgreSQL, a PKCS#12 plus its password as the
operator's artifact, and audited staff routes as the only entry point.

The rules that hold:

- **One stored secret per material.** The upload decrypts the container in
  memory, validates it and keeps only the private key; the password has no
  lifetime in the system.
- **The certificate is public material.** It is transmitted inside every signed
  DE, so it is stored inline with its metadata; the private key is RESTRICTED
  and lives behind an opaque `credentialRef`.
- **Retirement destroys the key.** A material moves `ACTIVE -> RETIRED` with an
  actor, a timestamp and a reason, and its ciphertext is deleted in the same
  transaction. Rotation applies the same rule to the material it replaces, so a
  material out of service never keeps a usable key. Rolling back therefore means
  re-uploading the operator's container, which the operator still holds.
- **Nothing leaks.** The private key is never returned by a DTO, never placed in
  `AuditLog.metadata`, never interpolated into an error message and never
  logged, failure paths included. Audit rows carry identifiers only.
- **The master key is a versioned ring.** `SECRET_STORE_MASTER_KEYS` plus
  `SECRET_STORE_MASTER_KEY_VERSION`; new writes use the current version and
  reads use the version recorded in the row, so a KEK rotation needs no data
  migration. `apiEnvSchema` refuses to boot in production without a master key,
  and the composition root refuses to fall back to the in-memory driver there.

The container itself is parsed by `packages/fiscal`'s `extractSigningMaterial`,
which uses `pkijs` only for PKCS#12 container parsing; the certificate standard
is enforced by `node:crypto` (`X509Certificate.checkPrivateKey` for the pair,
`modulusLength` for the pinned RSA minimum, `validToDate` for expiry). Node
cannot open a PKCS#12 in any form, which is why that dependency exists at all.

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
  the rest of [[EPIC-16]]; PRD §23 forbids implementing protocol details from
  memory.
- **The secret-store capability itself** — a reusable platform boundary in
  `packages/secret-store` ([[ADR-005]]); Fiscal consumes the port and never
  reaches a concrete driver.
- **Timbrado and numbering ranges** — [[FISC-011]].
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
The signing-material commands write `fiscal.signing_material.uploaded` and
`fiscal.signing_material.retired`. Audit metadata carries a schema version, the
outcome and field names only — never the cancellation reason text, never a
provider payload, never a certificate PEM, a private key or a `credentialRef`.
Reads are not audited.

Provider references (`external_id`, `cdc`, storage keys) and the
request/response snapshots are CONFIDENTIAL; status, attempt counters,
timestamps and the signing certificate's metadata are INTERNAL (PRD §41). A
tenant's signing private key is **RESTRICTED**: `tenant_secret` stores only
ciphertext, the store never logs, and no DTO exposes it. Logs and audit carry
IDs and field names only.

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
- `packages/fiscal/src/*` — the port, the fake's ordered scripts, the sanitizer,
  the queue contract, the PKCS#12 extraction with its base64 fixture, the DE
  builder and its official-schema gate, the XMLDSig signer, the SIFEN client
  (messages, serializer, parser, transport, facade, outcome mapping), the QR
  with §13.8.4's worked example, the timbrado ranges and profile assembly, the
  real adapter with its failure partition, and the provider selection. Fiscal
  suite: **28 files / 577 tests**.
- `packages/secret-store/src/*` — the port, the envelope crypto, the key ring,
  the two drivers and the opaque key factory. Suite: **5 files / 50 tests**.
- `apps/api/src/fiscal/*` — the issue, cancel and read integration suites (**21
  cases**), the signing-material service (**22 cases**) and HTTP boundary (**4
  cases**), the boundary rule, the producer deadline and the module composition.
  API suite: **84 files / 1105 tests**.
- `apps/worker/src/fiscal-submission/*` — the handler's claim, lease, stage,
  custody, outcome mapping and audit, the document seam, the consumer, and the
  reconciliation sweep with its two phases, its cap and its isolation. Worker
  suite: **11 files / 140 tests**.
- `packages/fiscal-persistence/src/*` — the moved timbrado range store, the
  emitter-profile read and the credential read. Suite: **3 files / 27 tests**.
- `apps/web/src/app/(app)/app/fiscal/*` and
  `apps/web/src/app/api/fiscal/[[...path]]/route.test.ts` — client, display,
  validation, outcome, panels, workspace states and the proxy contract (**7
  cases**). Web suite: **99 files / 1087 tests**.
- `apps/api/test/live-pg-isolation.e2e-spec.ts` — the applied schema, the
  trigger catalogue, the transition graph per edge including the cancellation
  edges, and the `APPROVED -> CANCEL_PENDING -> CANCELLED` path: **213 cases**.
- The FISC-007 integration suite runs against the in-memory database double,
  which now models `tenant_secret` and `tenant_fiscal_signing_material`. The
  partial unique index and the CHECK constraints are enforced by PostgreSQL
  only, so they are covered by the migration itself rather than by that suite.

## Known limitations

- **The worker cannot build a document.** The stage fails closed behind a seam
  whose reason names [[FISC-015]], so a `sifen-direct` deployment cannot issue
  until the assembly lands.
- **`cancel` fails closed** with `CANCELLATION_EVENT_UNPROFILED`: the
  cancellation event's payload is unprofiled and [[FISC-016]] owns it.
- **Nothing has been proven against DNIT.** No submission has reached SIFEN, the
  certificate is a fixture and the CSC is a stand-in; that is [[FISC-013]].
- **No deployment input exists for a trust-anchor override** (`caPem`): the
  transport's own trust store is the only reviewed configuration.
- **A capped `ERROR` row cannot be revived** — the sweep stops selecting it and
  the attempts-monotonic trigger forbids lowering the count ([[TD-029]]).
- **A lost claim after a successful `put` orphans a storage object**; nothing
  deletes it.
- **A query that can never resolve stays `SUBMITTED`** with its marker moving
  and its reason recorded; there is no query-side cap by design ([[ADR-007]]
  §6).
- **We own the master key.** Losing `SECRET_STORE_MASTER_KEYS` makes every
  stored private key unrecoverable. Backup and custody of that value are an
  operational requirement the code cannot satisfy.
- No KEK rewrap command ships: a rotation adds a version and old rows keep
  decrypting with the version recorded in their row.
- The in-memory secret driver is the development default, so a development
  environment loses stored material on restart. The production refusal is what
  keeps that from being a deployment risk.
- The signing-material test fixture is a self-assembled PKCS#12, not a PSC
  artifact, so [[FISC-013]] must validate the extraction against a real
  PSC-issued container during homologation.
- The signing material has no browser surface yet: the three routes are API-only
  and a `/app/fiscal` panel is follow-up work.
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
