---
feature: fisc-005-fiscal-surface-and-closure
epic: EPIC-15
story: FISC-005
status: in-progress
created: 2026-10-03
updated: 2026-10-03
branch: feat/epic-15-fiscal-surface-and-closure
base_commit: 3944fca
---

# FISC-005 Fiscal surface and epic closure — ODD task tracker

## Goal

Close EPIC-15: resolve the confirmed-invoice cancellation hand-off [[DEC-043]]
made binding, ship the minimal staff fiscal surface [[DEC-052]] accepted, and
record the epic closure with real receipts.

## TDD resolution

- Mode: **off**. Authoritative source: `openspec/config.yaml` sets
  `strict_tdd: false` and `rules.apply.tdd: false`.

## DECISIONS NEEDING THE MAINTAINER'S NOD

### D1 — Split this story into two slices (recommended)

The story's seven acceptance criteria span a backend cancellation protocol, a UI
surface and the epic closure. FISC-004 was 43 files and ended with a refuter and
an escalated review; FISC-005 as one diff would be larger and would mix a fiscal
protocol change with UI work.

**Recommended**: two PRs under the same story.

- **FISC-005a — cancellation hand-off (backend).** `cancel` on the provider port
  plus fake support, the guard's cancellation edges as an additive migration,
  the Fiscal cancellation command, and the Billing cancel path consulting
  Fiscal.
- **FISC-005b — staff surface and closure.** The `fiscal-ui` settings namespace
  if accepted, the staff fiscal surface, `docs/05-modules/Fiscal.md`, CI
  evidence, changelog, roadmap and the epic closure.

Every acceptance criterion is still satisfied across the story; the split only
changes how the work is reviewed.

### D2 — Which fiscal state blocks a Billing cancellation

[[DEC-051]] accepted Option A: Billing cancellation must not contradict an
active fiscal document, and the flow is deliberately two-step.

**Recommended**: **any live (non-`CANCELLED`) fiscal document blocks it.** A
`PENDING` document still holds the invoice's live slot at the partial unique
index, so cancelling the invoice would leave a slot occupied by a document whose
business document no longer exists; only Fiscal can release it. Billing's cancel
returns a stable `409` naming the Fiscal cancellation route.

The alternative — blocking only on `SUBMITTED`/`APPROVED` — leaves the invoice
cancellable while a `QUEUED` or `ERROR` document holds its slot, which means the
operator cannot re-issue either.

### D3 — The cancellation state graph

**Recommended**, extending the FISC-004 guard additively:

```text
PENDING        -> CANCELLED
QUEUED         -> CANCELLED
ERROR          -> CANCELLED
REJECTED       -> CANCELLED
SUBMITTED      -> CANCEL_PENDING
APPROVED       -> CANCEL_PENDING
CANCEL_PENDING -> CANCELLED
```

`SENDING -> CANCELLED` is deliberately **excluded**: a worker holds that claim
and may be mid-call, so cancelling underneath it would race the provider. The
operator waits out the five-minute lease, after which the claim is abandoned and
the document is cancellable from `ERROR` or re-claimable.

The `resolved_at` rule needs no change and this is where FISC-004's deliberate
choice pays off: it was pinned as an **implication** (`APPROVED`/`REJECTED`
require it) rather than a biconditional, so
`APPROVED -> CANCEL_PENDING -> CANCELLED` keeps its resolution timestamp without
violating anything. A biconditional would have broken here, which is exactly
what the FISC-002 trap predicted.

`cancelled_at` is already a biconditional with `CANCELLED`, so every edge into
`CANCELLED` must set it.

### D4 — `cancel` on the provider port

[[DEC-048]] says the epic's port has "issue/cancel capabilities"; FISC-003
deferred `cancel` to the slice that owns its flow, which is this one.

**Recommended**:

```ts
cancel(request: FiscalCancelRequest): Promise<FiscalCancelResult>;
```

with `FiscalCancelResult` reusing the outcome vocabulary — `CANCELLED`,
`CANCEL_PENDING`, `REJECTED`, `CONFIGURATION_ERROR`, `TRANSIENT_FAILURE` — and
`isRetryableOutcome` reused unchanged, so there is one retryability predicate in
the codebase rather than two. The fake gains a `cancelOutcomes` script mirroring
its `outcomes` script, defaulting to `["CANCELLED"]`.

### D5 — How Billing reaches Fiscal

PRD §22 says Billing imports a Fiscal **application interface**. The Billing
cancel path needs a question answered, not a provider call: "does this invoice
have a live fiscal document?"

**Recommended**: a Fiscal application service exposing a single read
(`hasLiveDocumentForInvoice(invoiceId)`), injected into `BillingService`, with
`BillingModule` importing `FiscalModule`. The dependency stays one-way — Fiscal
reads invoices through its own repository and never imports Billing — so there
is no cycle. The boundary test's Billing rule changes from "imports nothing from
`fiscal/`" to "imports the Fiscal application boundary only, never a concrete
provider".

### D6 — `fiscal-ui` settings scope

[[DEC-052]] accepted a minimal staff surface with closed, non-secret settings.

**Recommended**: ship the namespace only if the surface needs a configurable
value. The surface as scoped needs none — status, outcome and the two actions
are not configurable — so **ship no `fiscal-ui` namespace in FISC-005** and
record why, rather than adding a settings namespace with no consumer. PRD §38
lists the namespace; leaving it unregistered with a recorded reason is honest,
and registering it with an empty closed schema would be config surface with no
consumer.

## Pinned technical contract (D1-D6 accepted 2026-10-03)

### FISC-005a — files

```text
packages/fiscal/src/fiscal-provider.port.ts        + cancel request/result, port method
packages/fiscal/src/fake-fiscal.provider.ts        + cancelOutcomes script
packages/database/prisma/migrations/20261004000001_fiscal_document_cancellation_guard/migration.sql
packages/database/src/schema-fiscal-cancellation-guard.test.ts
apps/api/src/fiscal/fiscal.service.ts              + cancel command, + hasLiveDocumentForInvoice
apps/api/src/fiscal/fiscal.controller.ts           + POST /fiscal-documents/:id/cancel
apps/api/src/fiscal/fiscal.repository.ts           + document lock/find/update for cancel
apps/api/src/fiscal/fiscal.zod.ts                  + cancel body { reason }
apps/api/src/billing/billing.service.ts            cancel consults Fiscal
apps/api/src/billing/billing.module.ts             imports FiscalModule
apps/api/test/live-pg-isolation.e2e-spec.ts        + cancellation probes
```

### Port addition (D4)

```ts
interface FiscalCancelRequest {
  readonly fiscalDocumentId: string;
  readonly tenantId: string;
  readonly provider: FiscalProviderId;
  readonly reason: string;
  readonly externalId: string | null;
  readonly cdc: string | null;
}
type FiscalCancelOutcome =
  | "CANCELLED"
  | "CANCEL_PENDING"
  | "REJECTED"
  | "CONFIGURATION_ERROR"
  | "TRANSIENT_FAILURE";
interface FiscalCancelResult {
  readonly outcome: FiscalCancelOutcome;
  readonly reasonCode: string | null;
  readonly reason: string | null;
  readonly retryAfterMs: number | null;
  readonly providerRequest: unknown; // RAW; sanitized before persistence
  readonly providerResponse: unknown; // RAW
  readonly resolvedAt: string;
}
```

`isRetryableOutcome` is reused unchanged — it already admits exactly
`TRANSIENT_FAILURE`, and every `FiscalCancelOutcome` literal is an issue outcome
literal. One retryability predicate, not two. The fake gains
`cancelOutcomes?: readonly FiscalCancelOutcome[]`, defaulting to
`["CANCELLED"]`, consumed by the same ordered-script rule as `outcomes`.

### Guard migration (D3)

Additive, hand-written, sorting after `20261003000001`.
`CREATE OR REPLACE FUNCTION` only, and it must not relax any of the six existing
guards. New edges:

```text
PENDING | QUEUED | ERROR | REJECTED -> CANCELLED
SUBMITTED | APPROVED                -> CANCEL_PENDING
CANCEL_PENDING                      -> CANCELLED
```

`SENDING -> CANCELLED` stays excluded. The `resolved_at` implication and the
never-clear clauses stay as they are; `cancelled_at` must be set on every edge
into `CANCELLED`, which the FISC-002 biconditional already enforces. The schema
test mirrors `schema-fiscal-transition-guard.test.ts`, including its per-edge
matcher that accepts both the `= 'X'` and `IN (...)` forms.

### The Fiscal cancel command

`POST /fiscal-documents/:id/cancel`, `@RequirePermissions` on the existing
`fiscal.invoice.issue` (no new key, so the seed probes stay at
`permissions: 56`), body `{ reason }` — required, non-blank, length-capped —
mirroring `POST /invoices/:id/cancel`. Gate order as everywhere else:
entitlement → permission → actor, all outside the transaction.

Then a short transaction that locks the document `FOR UPDATE` and classifies it;
`404` when absent or cross-tenant; a document already `CANCELLED` replays the
same representation (`200`); a document in `SENDING` is a stable `409` because a
worker holds the claim. The provider `cancel` call then runs OUTSIDE any
transaction, and a second transaction applies the outcome through a conditional
write pinned to the observed status (see the T4a pinned details below for the
final, guard-compatible mapping): `CANCELLED` → `CANCELLED` with `cancelled_at`;
`CANCEL_PENDING` → `CANCEL_PENDING`; `REJECTED`/`CONFIGURATION_ERROR` and
`TRANSIENT_FAILURE` → the document stays where it was, the reason is stored in
`last_error_*`, and the caller gets a `409` carrying the provider's reason code.
This is a synchronous command, so the caller sees the failure rather than a
queued retry. One audit row per attempt:
`fiscal.document.cancellation_requested` on success,
`fiscal.document.cancellation_failed` on a refusal.

### The Billing hand-off (D2, D5)

`FiscalService.hasLiveDocumentForInvoice(invoiceId)` is a tenant-scoped read of
the live (non-`CANCELLED`) document for an invoice, used by
`BillingService.cancel` **before** it performs its own transition: a live
document means a stable `409` whose exported message names the Fiscal
cancellation route. `BillingModule` imports `FiscalModule`; the dependency stays
one-way because Fiscal reads invoices through its own repository and never
imports Billing.

The boundary test's Billing rule changes from "imports nothing from `fiscal/`"
to "imports the Fiscal application boundary only, never a concrete provider",
and its case name and comment must say so.

### What FISC-005a must NOT do

- No status write outside the graph, no `attempt_count` reset, no delete.
- No `fiscal-ui` namespace (D6): the surface needs no configurable value, and a
  namespace with no consumer is config surface for its own sake. Record that in
  the story's Known Limitations with PRD §38 named.
- No provider `cancel` call from Billing: Billing asks Fiscal, Fiscal asks the
  provider.

### FISC-005b — deferred to its own PR

The `fiscal-ui` decision is settled (not shipped); the remaining work is the
staff surface, `docs/05-modules/Fiscal.md`, CI evidence, changelog, roadmap and
the epic closure, with the four TD-028 advisories listed as closure follow-ups.

## Deferred items that belong in the closure list

The four advisories the TD-028 review recorded and did not action:
`R3-BATCH-LIMIT-NO-PROGRESS-GUARD` (a persistently failing head of the sweep
backlog could starve newer documents), `R3-SKIPPED-COUNTED-AS-REQUEUED` (a
skipped re-drive is counted as requeued), `R3-MISSING-OVERLAP-TEST` (the sweep's
overlap guard is not unit-covered because its queue only exists after
`onModuleInit`), and `R3-SUBMITTED-NOT-AUDITED`.

## Tasks

- [x] T1 — Get the nod on D1-D6, then pin the full contract. Evidence: `e489dab`
      (contract + D1-D6), `7cfeb68` (FISC-005a contract).
- [x] T2 — FISC-005a: `cancel` on the port and the fake. Evidence: `590eab4`.
- [x] T3 — FISC-005a: the guard's cancellation edges, additive migration plus
      schema and live-PostgreSQL probes. Evidence: `297007d`. Live-PostgreSQL
      execution of the probes is still owed (see T4b); Docker was down in the
      WSL distro when T3 landed.
- [x] T4a — FISC-005a: the Fiscal cancellation command
      (`POST     /fiscal-documents/:id/cancel`), the repository lock/read/update
      surface it needs, and its integration coverage. Evidence: `5b3b564`. Gates
      green: API 1050 tests / 80 files, root `pnpm test` 17/17, typecheck 16/16,
      lint 16/16, format clean.
- [x] T4b — FISC-005a: the Billing hand-off (`hasLiveDocumentForInvoice`), the
      Billing boundary rule, its integration coverage and the live-PostgreSQL
      execution of the FISC-005a probes. Evidence: this work unit's commit.
      Gates green: API 1056 tests / 80 files, root `pnpm test` 17/17, typecheck
      16/16, lint 16/16, format clean, `db:deploy` 32 migrations applied, live
      PostgreSQL **213 passed (213)** with the FISC-005a cancellation-edge
      probes executed locally for the first time.
- [ ] T5 — FISC-005b: the staff fiscal surface.
- [ ] T6 — FISC-005b: module docs, CI evidence, changelog, roadmap, epic
      closure.

### T4a pinned details (the contract above is ambiguous here; these win)

- The document read after the `FOR UPDATE` lock is by **id**, tenant-scoped, and
  must accept a `404` for unknown and cross-tenant ids, byte-equivalent. The
  shared message is a new `FISCAL_DOCUMENT_TARGET_NOT_FOUND_MESSAGE` naming the
  document (the existing invoice-source `FISCAL_DOCUMENT_NOT_FOUND_MESSAGE` must
  not be reused, and must not be renamed).
- The lock is
  `SELECT "id" FROM "fiscal_document" WHERE "tenant_id" = $1 AND "id" = $2 FOR UPDATE`.
- Every status write goes through ONE conditional `updateMany` whose `where`
  pins the **observed** status, so a lost race is a zero-row result, never a
  blind write. The write sets `cancelledAt` on every edge into `CANCELLED` and
  `lastErrorCode`/`lastErrorMessage` on the refusal paths (document stays put).
- `CANCELLED` observed is a `200` **replay**: the same DTO, no write entering,
  no audit row. `SENDING` observed is a stable `409` with its own message,
  before any provider call.
- **The provider call is NOT inside a database transaction** (AGENTS.md:
  "External fiscal calls must happen outside long-running database
  transactions"). The command is therefore three phases: **(A)** a short
  transaction that locks the document `FOR UPDATE`, reads it tenant-scoped and
  classifies it; **(B)** the provider `cancel` call, outside any transaction;
  **(C)** one transaction that applies the outcome through the single
  conditional `updateMany` pinned to the observed status (a zero-row CAS is a
  lost race -> stable `409`) and co-commits the audit row.
- **`TRANSIENT_FAILURE` does NOT move the document to `ERROR`** (maintainer
  decision, 2026-10-03). The pinned D3 graph admits `ERROR` only from `SENDING`
  and `SUBMITTED`, so a general `-> ERROR` mapping is not implementable without
  widening the already-reviewed guard. A transient failure instead leaves the
  document in its observed status, stores `last_error_*`, and returns a stable
  `409` carrying the provider reason code: the command is synchronous and
  retryable by re-issuing it. No guard change, no migration.
- Outcome mapping, final:

  ```text
  CANCELLED            -> status CANCELLED,      cancelled_at set, 200, audit ..._requested
  CANCEL_PENDING       -> status CANCEL_PENDING,                   200, audit ..._requested
  REJECTED             -> status unchanged, last_error_* set,      409, audit ..._failed
  CONFIGURATION_ERROR  -> status unchanged, last_error_* set,      409, audit ..._failed
  TRANSIENT_FAILURE    -> status unchanged, last_error_* set,      409, audit ..._failed
  ```

- Reason text is scrubbed (`[\r\n\t]+` -> space) and length-capped exactly like
  the worker's `MAX_ERROR_LENGTH = 500`; the audit metadata carries field NAMES
  and the outcome only, never the reason text.
- `resolvedAt`/provider snapshots are NOT persisted by the cancel command in
  T4a: the cancel result has no `externalId`/`cdc` to add, and the snapshots are
  the submission path's evidence. Record this as a deliberate narrowness.
- The response DTO (`FiscalDocumentResponse`) is **unchanged**: no `cancelledAt`
  and no `lastErrorMessage` are exposed by this slice, so the existing issue
  integration test's `RESPONSE_KEYS` allowlist stays valid.
- The `409` refusals must NOT be thrown from inside a transaction: the outcome
  write and the audit row commit FIRST (phase C returns a discriminated result),
  and the `DomainError` is thrown after that transaction resolves. Throwing
  inside would roll back the `last_error_*` write and the audit row the contract
  requires to persist.

### T4b pinned details

- `hasLiveDocumentForInvoice(invoiceId, tx?)` is read **inside** the Billing
  cancellation transaction, immediately AFTER `lockById` and the `CANCELLED`
  replay branch, so it serializes with `FiscalService.issue` (which locks the
  same invoice header before creating the document). A check outside the
  transaction would leave the create window open.
- The transaction handle is shared through a **minimal structural read type**,
  not through the Fiscal package: `fiscal.repository.ts` exports
  `FiscalDocumentReadTx = { fiscalDocument: { findFirst } }`,
  `FiscalRepositoryTx` extends it, `findLiveDocument` takes it, and
  `hasLiveDocumentForInvoice` accepts it optionally. Billing declares its own
  `fiscalDocument` read delegate locally (no import from `fiscal/`), so the
  dependency stays a read seam and Billing still never imports
  `@newsaas/fiscal`.
- `FiscalService.hasLiveDocumentForInvoice` asserts NO entitlement and NO
  permission: Billing has already applied both gates on its own path. It is a
  pure tenant-scoped read.
- `FiscalModule` gains `exports: [FiscalService]`; `BillingModule` imports
  `FiscalModule`. The dependency stays one-way (Fiscal never imports Billing).
- The blocked message is a stable `409` that names the Fiscal cancellation
  route. It is exported and asserted byte-exactly in the integration test.
- The boundary test's Billing rule becomes: Billing may import ONLY the Fiscal
  **application boundary** (`../fiscal/fiscal.service.js`,
  `../fiscal/fiscal.module.js`) and must never import `@newsaas/fiscal` nor a
  concrete provider. The existing `@newsaas/fiscal` rule stays in force and
  keeps its own case; a new case allowlists the application-boundary modules by
  path.

## Notes

- Base commit `3944fca` (merged `main`: EPIC-15 kickoff, FISC-002, FISC-003,
  FISC-004 and TD-028). Branch `feat/epic-15-fiscal-surface-and-closure`.
- EPIC-15 stays `planned` in the roadmap until this story closes, matching how
  EPIC-14 was tracked.
