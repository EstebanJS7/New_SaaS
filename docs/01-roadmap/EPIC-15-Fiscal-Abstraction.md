---
id: EPIC-15
type: epic
title: Fiscal Abstraction
status: done
priority: high
depends_on:
  - EPIC-14
prd_sections:
  - "21"
  - "22"
  - "23"
  - "27"
  - "36"
  - "38"
  - "39"
  - "40"
  - "41"
created: 2026-10-02
updated: 2026-10-03
---

# EPIC-15 — Fiscal Abstraction

## Objective

Create the reusable Core Fiscal boundary promised by PRD §22 on top of the
confirmed invoice foundation from [[EPIC-14]]: a tenant-scoped `FiscalDocument`,
an application interface consumed by Billing, a deterministic
`FakeFiscalProvider`, queued and idempotent fiscal submission, retry/error
classification, audited fiscal operations, and a minimal staff fiscal surface
for operational status and retry/cancel actions where supported by the fake
boundary.

EPIC-15 deliberately stops before any real Paraguay/SIFEN or third-party
provider integration. [[EPIC-16]] owns the production adapter. EPIC-15 must not
implement SIFEN protocol details from memory; it only defines the provider port,
state machine, storage/sanitization contract, and fake implementation required
to prove the Core abstraction.

## Current state before implementation (verified 2026-10-02)

- `docs/01-roadmap/ROADMAP.md` lists EPIC-15 Fiscal Abstraction as `planned`,
  depending on EPIC-14, and EPIC-16 Fiscal Third-party Adapter as its successor.
- [[EPIC-14]] is `done`; the Billing module exposes tenant-scoped invoice
  creation, reads, confirmation and cancellation, but the aggregate is
  deliberately fiscal-free.
- [[DEC-042]] assigns the Fiscal application interface, fake provider,
  `FiscalDocument`, queued submission, `fiscal-ui` surface and additive invoice
  linkage to EPIC-15.
- [[DEC-041]] deferred `InvoiceConfirmed` until a concrete consumer exists;
  accepted [[DEC-047]] leaves that event unused in EPIC-15 because submission is
  queued by an explicit Fiscal issue command.
- [[DEC-043]] requires EPIC-15 to revisit confirmed-invoice cancellation once
  `FiscalDocument` exists, or record why fiscal cancellation remains separate.
- `fiscal.invoice.issue` and the `fiscal` feature code already exist in the seed
  catalog. The permission is granted to OWNER, ADMIN and CASHIER but consumed by
  no route.
- `packages/shared/src/events/dispatcher.ts` exists, but no `apps/` module uses
  it yet. BullMQ exists through the Branding cleanup worker precedent.
- No `FiscalDocument` model, Fiscal module, fiscal worker, fiscal module docs,
  EPIC-15 stories or EPIC-15 decisions exist before this kickoff.

## Progress

- **[[FISC-002]] Fiscal data foundation — `done`.** Closed on 2026-10-02 with
  the scope pull request #96 and the slice pull request #97, CI run
  **`37050111481`** green on both required checks. Implemented on
  `feat/epic-15-fiscal-data-foundation` as the additive `FiscalDocument`
  persistence foundation: `enum FiscalProvider` with PRD §22's three values,
  `enum FiscalDocumentStatus` with the SIFEN lifecycle minus `SIGNING`, the
  tenant-scoped aggregate with a composite RESTRICT invoice FK and no duplicated
  invoice money or series, two named CHECKs (`attempt_count >= 0` and the
  cancellation biconditional), a partial unique index mirrored from Billing that
  admits one non-cancelled document per invoice, and five structural triggers.
  Verification passed locally: database suite 19 files / 407 tests (was 18 /
  403), `db:generate`, `db:deploy` applying **30 migrations** including
  `20261002000001_fiscal_data_foundation`, the live-PostgreSQL suite at **176
  passed** (was 153, +23 fiscal cases), `typecheck` 14/14, `lint` 14/14, `build`
  9/9 and `format-check` clean. The frozen ownership-key counter moved 22 → 23,
  and the seed probes deliberately did not move because [[DEC-040]] had already
  allocated `fiscal.invoice.issue` and the `fiscal` feature code.

  Two guards were corrected during implementation because both were pinned
  before the flow that would use them existed: the dropped
  `external_id_iff_resolved` CHECK would have rejected the legitimate
  `SUBMITTED` -> `APPROVED` -> `CANCELLED` path, and the narrowed
  `cancelled_immutable` trigger replaced a broader guard that made `CANCELLED`
  unreachable from `APPROVED` and `REJECTED` — the same defect class [[TD-023]]
  recorded for the EPIC-14 invoice header guard.

  Three native review rounds closed **approved and acknowledged**
  (`review-55a6586fdf5cc2c2`, `review-49e414ffad03db30`,
  `review-a26929649a8d3a16`) with no corrections, and their advisories were
  treated as candidate defects rather than style notes — which was correct,
  since they exposed a broken `[\\s\\S]` regex, two rejected probes sharing an
  aborted transaction, a case named "for every status" that probed one, and four
  cases creating a second invoice for the fixture sale. A fourth round
  (`review-2c9359c3812696e8`) approved the correction that followed. When the
  executable gate finally ran it still found **15 failures in 22 cases**, which
  is this slice's durable lesson: for a database artifact, review is not a
  substitute for execution. [[TD-027]] recorded the deferred gate and is now
  `resolved`.

- **[[FISC-003]] Fiscal provider port and deterministic fake — `done`.** Closed
  via pull request #99. The application boundary the epic rests on: a provider
  port with a normalized outcome taxonomy, a deterministic `FakeFiscalProvider`,
  a fail-closed snapshot sanitizer, the composition root that selects the
  implementation, and the source-text rule that keeps concrete providers out of
  every other domain. Two lineages closed approved with zero corrections. One
  correction to the pinned contract: the port declares its own frozen provider
  vocabulary instead of importing the Prisma enum, because `@newsaas/database`
  keeps `@prisma/client` private — and a port should not depend on generated
  persistence types anyway.

- **[[FISC-004]] Queued fiscal submission — `done`.** Closed via pull request
  #100, with the live-PostgreSQL gate executed both locally and in CI. Extracted
  `packages/fiscal` so the worker can consume the same boundary, added the queue
  contract with the deterministic `jobId = fiscal-submit:<documentId>`, the API
  producer with a 2 s deadline and fail-fast Redis options, the worker consumer
  and handler with a five-minute claim lease, the status transition guard, and
  the explicit `POST /fiscal-documents` command. Two CRITICAL findings the
  refuter confirmed were fixed before merge: a Redis outage could hang every
  issue request, and a worker dying between the `SENDING` claim and the provider
  call could strand a document permanently. The targeted validation was refused
  at admission and `inspect-authority` reported `sanctioned_exits: []`, so this
  slice's review is **escalated, not closed** — the same terminal shape BILL-004
  recorded in EPIC-14, and it is recorded rather than smoothed over.

- **[[TD-028]] Fiscal submission recovery sweep — `resolved`.** Closed via pull
  request #101. `recoverStaleFiscalSubmissions` selects `QUEUED`/`ERROR`
  documents older than a five-minute window in batches of 100, and
  `redriveFiscalSubmission` removes a terminal job before re-adding it, because
  a deterministic `jobId` plus `removeOnFail: false` would otherwise make the
  re-add a silent BullMQ dedupe no-op. No status write, so no migration and no
  guard extension. Four advisories were recorded rather than actioned and are
  now listed in [[TD-030]].

- **[[FISC-005]] Fiscal surface and epic closure — `done`.** Closed 2026-10-03
  in two PRs under one story. **FISC-005a** (pull request #102) added `cancel`
  to the provider port and the fake, the guard's cancellation edges as an
  additive migration, the synchronous `POST /fiscal-documents/:id/cancel`, and
  the [[DEC-051]] Billing hand-off. **FISC-005b** (pull request #103) added the
  read-wide `fiscal.read` key with the list and detail reads, the `/app/fiscal`
  workspace with its client layer and `/api/fiscal` proxy, and
  `docs/05-modules/Fiscal.md`. The FISC-005a native review (lineage
  `review-2768c9087a428449`, tier high, four lenses) closed **approved** after
  one candidate-caused CRITICAL — an unbounded provider cancel call — was
  corrected and validated.

  Three contract decisions were taken during implementation and recorded rather
  than silently applied: `TRANSIENT_FAILURE` does not move a cancellation to
  `ERROR` because the accepted graph does not admit that edge; no retry route
  ships because none was ever accepted ([[TD-029]]); and no `fiscal-ui` settings
  namespace ships because the surface needs no configurable value (`D6`).

  [[TD-030]] records the review advisories from FISC-005a and TD-028 with
  dispositions, and [[TD-029]] records the missing operator-triggered re-drive.

## Scope

- Add the tenant-scoped Fiscal domain data model, including `FiscalDocument`,
  provider/state enums, immutable references to the source invoice, provider
  external identifiers, XML/KuDE storage references, sanitized request/response
  snapshots, attempts/errors and timestamps.
- Preserve PRD §21's separation between invoice business status and fiscal
  status: fiscal state belongs to Fiscal records, not to `Invoice` columns.
- Define the Fiscal application port and DTOs so Billing depends only on the
  Fiscal boundary, never on a concrete provider.
- Implement `FakeFiscalProvider` for tests/dev with deterministic approved,
  rejected and transient-error outcomes.
- Queue fiscal submissions with BullMQ using the existing worker runtime,
  idempotent job identity and bounded retry/backoff for transient failures.
- Keep `InvoiceConfirmed` unused in EPIC-15 under accepted [[DEC-047]]; fiscal
  submission is queued by the explicit Fiscal issue command rather than an
  automatic Billing event consumer.
- Gate fiscal routes/actions on the `fiscal` feature code and the existing
  `fiscal.invoice.issue` permission unless an accepted decision adds a narrower
  key.
- Record data classification for all fiscal fields and keep secrets out of
  tenant settings and application tables.
- Add the minimal staff fiscal status/action surface required for the epic,
  while keeping customer portal documents deferred unless a later accepted
  decision says otherwise.
- Resolve the confirmed-invoice cancellation hand-off from [[DEC-043]] before
  fiscal issuance is enabled.

## Out of Scope

- Real third-party fiscal providers and production credential handling beyond
  secret references — [[EPIC-16]].
- `SifenDirectFiscalProvider`, DNIT protocol XML generation, signatures,
  certificates, certification flow, XSD implementation or SIFEN details from
  memory — PRD §23 and `docs/06-fiscal/SIFEN.md` defer this until official
  documentation is revalidated.
- Portal invoice/document/KuDE surfaces — still tracked by [[TD-022]] and
  re-evaluated after EPIC-15/EPIC-16.
- Printed/PDF rendering, official document layout and delivery by email or
  WhatsApp — later document/notification epics.
- Reports and dashboards — [[EPIC-18]].
- Sale reversal, payment refund and stock compensation — [[TD-018]].
- New deployables, new queue technologies, event sourcing, distributed event
  buses or microservices.

## Acceptance Criteria

FISC-001 kickoff artifacts and decisions are complete; implementation criteria
remain open. Each unchecked box names planned evidence that will close it.

### FISC-001 — Fiscal scope and decisions

- [x] EPIC-15 has an epic record, planned stories and decisions for the provider
      boundary, document shape, trigger model, idempotency/queue/retry,
      storage/sanitization, cancellation hand-off and fiscal UI/settings.
- [x] DEC-046 through DEC-052 are accepted by the maintainer before
      implementation code starts.
- [x] No PRD scope is modified by kickoff docs.

### FISC-002 — Fiscal data foundation

- [x] `FiscalDocument` and fiscal enums exist as tenant-scoped additive schema
      with composite ownership keys, source invoice ownership, provider/state
      constraints, storage-reference fields and sanitized snapshot fields.
      Evidence: migration `20261002000001_fiscal_data_foundation`,
      `schema-fiscal.test.ts` and the fiscal live-PostgreSQL block.
- [x] Fiscal state is not duplicated into `Invoice`, and invoice-to-fiscal
      linkage is additive and tenant-safe. Evidence: no fiscal column on
      `Invoice`, only a back-reference and the composite RESTRICT FK.
- [x] Database tests and live-PostgreSQL probes cover constraints, tenant
      isolation, immutability and classification-relevant fields. Evidence: 4
      textual gates plus 23 executed live-PostgreSQL cases; the full suite is
      176/176 and the migration applied as the 30th.
- [x] Any new fiscal permission/settings seeds reconcile the pinned seed-count
      probes in the same slice. Evidence: nothing was added, so the pinned
      probes stay at `permissions: 56` and `featureCodes: 12`.

### FISC-003 — Fiscal application interface and fake provider

- [ ] The Fiscal port, DTOs and error/result taxonomy exist in the Fiscal
      module, and Billing imports only the port/facade.
- [ ] `FakeFiscalProvider` deterministically covers approved, rejected and
      transient-error outcomes without SIFEN protocol assumptions.
- [ ] Snapshot sanitization prevents CONFIDENTIAL/RESTRICTED payload leakage in
      stored provider request/response data and logs.
- [ ] Unit tests cover provider outcomes, sanitization and boundary rules.

### FISC-004 — Queued fiscal submission

- [ ] Confirmed invoices can enqueue exactly one fiscal submission job through
      the Fiscal boundary, with tenant-safe authorization and the `fiscal`
      capability gate.
- [ ] Queue job identity and database constraints make submission idempotent
      under retries and concurrency.
- [ ] Transient errors retry with bounded exponential backoff; functional,
      schema or configuration rejections do not retry forever.
- [ ] Worker tests, API integration tests and live-PostgreSQL concurrency probes
      prove no duplicate FiscalDocument/submission is admitted.

### FISC-005 — Fiscal operations surface, cancellation hand-off and closure

- [ ] Staff can inspect fiscal document status and required operational actions
      in the minimal authorized surface selected by the accepted decisions.
- [ ] Confirmed invoice cancellation either requests fiscal cancellation through
      Fiscal or records an accepted reason why cancellation is a separate Fiscal
      operation; the [[DEC-043]] contradiction risk is closed before issuance is
      enabled.
- [ ] Module documentation, changelog, CI evidence and roadmap status are
      current.
- [ ] Required lint, typecheck, unit, integration, worker, live-PostgreSQL and
      build checks are green, or non-green/pending evidence is recorded.

## Stories

- [[FISC-001]] Fiscal scope and decisions — kickoff artifacts and proposed
  decisions required before code.
- [[FISC-002]] Fiscal data foundation — `FiscalDocument`, enums, linkage,
  seeds/settings and schema evidence.
- [[FISC-003]] Fiscal application interface and fake provider — port, DTOs,
  deterministic fake, sanitization and provider taxonomy.
- [[FISC-004]] Queued fiscal submission — explicit Fiscal issue command, BullMQ
  producer/worker, idempotency, retry and live concurrency evidence.
- [[FISC-005]] Fiscal operations surface and epic closure — staff
  status/actions, cancellation hand-off, docs and release evidence.

## Dependencies

- [[EPIC-14]] Billing (**done**) — provides confirmed invoices, cancellation and
  the explicit fiscal-free hand-off.
- [[EPIC-02]] RBAC/Entitlements/Tenant Settings (**done**) — provides the
  permission catalog, role matrix, feature-code seeds and typed settings
  service.
- [[ADR-003]] and `docs/03-architecture/INTERNAL-EVENTS.md` — events exist only
  when a concrete subscriber exists; BullMQ is used for durable/retryable
  external work.
- `docs/06-fiscal/SIFEN.md` — fixes the provider sequence and forbids SIFEN
  direct implementation from stale notes.
- [[DEC-040]], [[DEC-041]], [[DEC-042]], [[DEC-043]] and [[DEC-044]] — EPIC-14
  decisions that bind this hand-off.

## Exit Criteria

- [ ] Every EPIC-15 story is `done` with acceptance criteria checked and
      evidence recorded.
- [ ] Fiscal submission can be queued from a confirmed invoice and processed by
      the fake provider idempotently.
- [ ] Billing depends on the Fiscal boundary only, and no concrete provider
      leaks into Billing.
- [ ] Tenant isolation, authorization, entitlement gates, audit, retry behavior,
      idempotency and fiscal state constraints are covered by tests and
      live-PostgreSQL evidence where applicable.
- [ ] Module documentation, CI evidence, changelog and roadmap are current.
- [ ] Required checks are green for the merged work units, or explicit
      non-green/pending evidence is recorded.

## Decisions / ADRs

The following kickoff decisions are accepted by the maintainer before
implementation:

- [[DEC-046]] (**accepted**) — Fiscal document aggregate, states and invoice
  linkage.
- [[DEC-047]] (**accepted**) — Fiscal trigger model and event/queue boundary.
- [[DEC-048]] (**accepted**) — Fiscal provider port, fake provider and result
  taxonomy.
- [[DEC-049]] (**accepted**) — Fiscal idempotency, retries and error
  classification.
- [[DEC-050]] (**accepted**) — Fiscal storage references, sanitization and data
  classification.
- [[DEC-051]] (**accepted**) — Confirmed-invoice cancellation after
  FiscalDocument exists.
- [[DEC-052]] (**accepted**) — Fiscal staff surface and `fiscal-ui` settings
  scope.

No ADR is planned unless implementation requires a new runtime, queue
technology, general event bus or another architecture-freeze exception.

## Technical Debt

- [[TD-022]] remains open for portal invoice/document surfaces until the fiscal
  document and provider story make the customer-visible document shape concrete.
- [[TD-018]] remains open for sale reversal, payment refund and stock
  compensation.
- New debt must be created for any accepted shortcut that does not invalidate
  the current story acceptance criteria.
