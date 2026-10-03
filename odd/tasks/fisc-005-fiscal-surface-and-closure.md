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

### FISC-005a native review record (closed)

Lineage `review-2768c9087a428449`, tier **high**, four lenses, 24 changed files,
1482 original changed lines, correction budget 200. **Closed `approved`**; the
exact acknowledgement burned the authority (`authority: burned`, evidence
`gentle-ai.review-acknowledged/v1`, delivery left to ordinary repository
policy).

One candidate-caused CRITICAL was confirmed by the refuter and corrected before
approval: `R4-PROVIDER-CALL-NO-BOUND` — the synchronous cancel called the
provider with no timeout, deadline or abort signal. Correction `fab9758` (153
diff lines, inside the 200 budget) adds an optional `AbortSignal` to
`FiscalCancelRequest` and the exported `cancelWithinDeadline` helper, which
bounds the call at `FISCAL_CANCEL_TIMEOUT_MS = 10_000` and reports a retryable
`TRANSIENT_FAILURE` through the existing refusal path. A targeted validator
approved it on the last admitted event.

The fourteen advisory findings below are **non-blocking and informational**.
They are explicitly separate later work and never a reason to re-run review on
this candidate; the closure slice must triage them (action, Tech Debt item, or
recorded non-action):

- `R1-CANCEL-GATE-ORDER-NOT-COVERED` (WARNING) — no integration case asserts
  entitlement-before-permission on the cancel route.
- `R1-CANCEL-REASON-ECHO-UNSCRUBBED-IN-ERROR` (SUGGESTION).
- `R1-PROVIDER-SNAPSHOT-NOT-PERSISTED` (SUGGESTION) — the deliberate narrowness
  recorded in T4a.
- `R2-BOOT-PROVIDER-MUTABLE-BINDING` (SUGGESTION).
- `R2-SENDING-BRANCH-NO-AUDIT-CONTEXT` (SUGGESTION).
- `R2-STRUCTURAL-READ-MIRROR` (SUGGESTION).
- `R2-UNNAMED-MAGIC-500` (SUGGESTION) — the `scrub` cap.
- `R3-001` (WARNING), `R3-002` (WARNING), `R3-003` (SUGGESTION), `R3-004`
  (SUGGESTION).
- `R4-AUDIT-METADATA-NO-PROVIDER-IDENTITY` (SUGGESTION).
- `R4-BILLING-CANCEL-CONFLICT-VS-404` (SUGGESTION).
- `R4-CANCEL-RETRY-UNBOUNDED` (WARNING).

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
- [x] T5a — FISC-005b: the API fiscal read contract (`fiscal.read` + list +
      detail + the DTO's `cancelledAt`). Evidence: this work unit's commit.
      Gates green: database 21 files / 416 tests, API 81 files / 1068 tests,
      root typecheck 16/16, lint 16/16, format clean, seed reapplied
      (`permissions: 57`, `rolePermissions: 193`), live PostgreSQL **213 passed
      (213)**.
- [x] T5b-1 — FISC-005b: the web client layer (`fiscal-api`, `fiscal-display`,
      `fiscal-validation`, `fiscal-outcome`), the `/api/fiscal` proxy and the
      nav entry, with their colocated tests. Evidence: this work unit's commit.
      Gates green: web 95 files / 1071 tests, web typecheck/lint/`next build`
      clean, root `pnpm test` 17/17, typecheck 16/16, lint 16/16, format clean.
- [ ] T5b-2 — FISC-005b: the `/app/fiscal` workspace — `page.tsx`, the surface
      and the three panels, with their colocated tests.
- [ ] T6 — FISC-005b: module docs, TD-029, advisory triage, CI evidence,
      changelog, roadmap and the EPIC-15 closure.

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

## FISC-005b pinned contract (maintainer decisions, 2026-10-03)

The read-only mapping of the EPIC-14 Billing template surfaced a blocking gap:
`FiscalController` exposes only the two POST commands, there is no `fiscal.read`
key and `FiscalService`/`FiscalRepository` have no list or by-id read. The three
maintainer decisions below close that gap; D6 (no `fiscal-ui` namespace) stands.

### D7 — the fiscal read contract (accepted)

- A new permission key `fiscal.read` ("Read fiscal documents") joins the
  reference seed, so the seeded permission count moves **56 → 57** and the probe
  in `packages/database/src/reference-seed.test.ts` moves with it. Read is
  granted to all six roles, mirroring the read-wide `billing.read` shape of
  DEC-040.
- `GET /fiscal-documents` — tenant-scoped list, newest first (`createdAt desc`),
  a **strict** optional `status` filter with no implicit default, and no
  pagination (the shipped sales/cash/invoice list precedent).
- `GET /fiscal-documents/:id` — tenant-scoped detail; unknown and cross-tenant
  ids are byte-equivalent `404`s.
- Gate order on both reads: `fiscal` entitlement → `fiscal.read`, then actor.
- `FiscalDocumentResponse` gains **`cancelledAt: string | null`** and nothing
  else. `requestSnapshot`/`responseSnapshot` stay CONFIDENTIAL and are never
  returned.

### D8 — no retry route (accepted)

DEC-052 names "issue/retry/cancel", but no retry route was ever accepted or
shipped; the TD-028 sweep re-drives internally on a five-minute window.
FISC-005b ships **no** retry route and records `docs/08-tech-debt/TD-029` for
the missing operator-triggered re-drive.

### D9 — the surface lives at `/app/fiscal` (accepted)

`/app/fiscal` owns the issue panel, the list and the detail with the cancel
action. Billing gains no fiscal action beyond the DEC-051 `409`.

### T5a — files

```text
packages/database/src/reference-seed.ts              + fiscal.read key and its six role grants
packages/database/src/reference-seed.test.ts         probe 56 -> 57
apps/api/src/fiscal/fiscal.permissions.ts            + read key
apps/api/src/fiscal/fiscal.dto.ts                    + cancelledAt
apps/api/src/fiscal/fiscal.zod.ts                    + list query, + id param
apps/api/src/fiscal/fiscal.repository.ts             + list + by-id read
apps/api/src/fiscal/fiscal.service.ts                + list + get, gate order
apps/api/src/fiscal/fiscal.controller.ts             + GET routes
apps/api/src/fiscal/fiscal.integration.test.ts       + read cases
apps/api/src/rbac/route-contract.probe.test.ts       + 2 routes, + permission map
```

### T5a pinned details

- The by-id read reuses `findDocument(id, tx)`; the list is a NEW tenant-scoped
  repository method (`findMany`-shaped, optional `status` filter,
  `createdAt desc`) — the repository must not gain a cross-tenant read.
- The list query schema is `.strict()` with a single optional `status` enum; an
  unknown key or a non-enum status is the stable `400 VALIDATION_FAILED`.
- The permission key literal is `fiscal.read`; the seed's role grants follow the
  existing read-wide shape (all six roles).
- The route-contract probe needs BOTH pins: `EXPECTED_ROUTE_INVENTORY` gains
  `GET /fiscal-documents` and `GET /fiscal-documents/:id`, and
  `FISCAL_PERMISSION_BY_ROUTE` gains both mapped to `fiscal.read`.
- Read audit: **no** audit row. Reads are never audited in this codebase.
- The list/detail DTO is the SAME allowlist as the issue response plus
  `cancelledAt`; do not add a second DTO shape.

### T5b — files

```text
apps/web/src/app/(app)/app/fiscal/page.tsx
apps/web/src/app/(app)/app/fiscal/fiscal-api.ts
apps/web/src/app/(app)/app/fiscal/fiscal-display.ts
apps/web/src/app/(app)/app/fiscal/fiscal-validation.ts
apps/web/src/app/(app)/app/fiscal/fiscal-outcome.tsx
apps/web/src/app/(app)/app/fiscal/fiscal-surface.tsx
apps/web/src/app/(app)/app/fiscal/fiscal-list-panel.tsx
apps/web/src/app/(app)/app/fiscal/fiscal-detail-panel.tsx
apps/web/src/app/(app)/app/fiscal/issue-fiscal-document-panel.tsx
apps/web/src/app/api/fiscal/[[...path]]/route.ts
apps/web/src/components/shell/nav-sidebar.tsx
+ colocated tests for every new module
```

### T5b pinned details

The slice is split into two work units because it is the largest of the story:
**T5b-1** is the client layer, the proxy and the nav (no rendering), and
**T5b-2** is the workspace that consumes them. Both are part of the same
FISC-005b PR.

- The client talks only to `/api/fiscal/...`. The proxy prefix is `/api/fiscal`
  and the remainder is the upstream path, so the four calls are:
  `GET /api/fiscal/fiscal-documents` (optional `?status=`),
  `GET /api/fiscal/fiscal-documents/:id`, `POST /api/fiscal/fiscal-documents`
  body `{ invoiceId }`, and `POST /api/fiscal/fiscal-documents/:id/cancel` body
  `{ reason }`.
- Replicate the Billing template exactly: `page.tsx` is a server component
  rendering one `"use client"` surface, with no guard and no metadata; the proxy
  is the `[[...path]]` shape-classifier (prefix constant, method-aware path
  shape, query allowlist, body key-set contract forwarded byte-for-byte,
  `STAFF_SESSION_COOKIE` from `@/lib/session-cookie`, only the cookie and
  `x-request-id` forwarded, `notFound`/`invalidPath`/`invalidBody`/
  `unauthenticated` envelopes matching the API byte-for-byte,
  `cache: "no-store"`).
- The surface pins its OWN runtime status mirror (`FISCAL_DOCUMENT_STATUSES`)
  because `FiscalDocumentResponse.status` is a plain `string`; do NOT import the
  API's server-side union. This is the `INVOICE_STATUSES` precedent, and the
  display test must assert the mirror.
- Reuse only `Button` and `Card*` from `@newsaas/ui`, plus the semantic tokens
  the Billing template uses. No brand literal, no arbitrary-value class, no
  remote font. The display test mirrors Billing's token assertion
  (`not.toMatch(/#[0-9a-f]{3,8}/i)`, `not.toMatch(/\[[^\]]+\]/)`).
- Do NOT replicate `billing-display.ts`'s cross-feature import of
  `formatWireAmount`; Fiscal has no money field.
- State coverage is an acceptance criterion: loading, empty, error, success,
  permission-denied (`FORBIDDEN`) and entitlement-denied
  (`FEATURE_NOT_ENTITLED`), each with its own `data-testid`.
- The nav entry is
  `{ href: "/app/fiscal", label: "Fiscal", requiredFeature: "fiscal" }`, and
  `nav-sidebar.test.tsx` hard-codes the entry count, the positional
  destructuring, the href array and the `visibleNavLinks` negative list, so all
  four must move with it. The gate stays declarative-only because
  `(app)/layout.tsx` passes no entitlements — that is the shipped Billing
  behavior and must be recorded in the module doc's limitations.
- The web suite has **no** shared test-helper module: helpers are file-local,
  `global.fetch` is replaced by `vi.fn()`, and pure modules carry a
  `/** @vitest-environment node */` docblock.
- The cancel action needs the document's cancellable states only; `SENDING` and
  `CANCELLED` are not cancellable, and the surface must render the API's `409`
  message rather than inventing its own rule.

### T6 — closure scope

- `docs/05-modules/Fiscal.md` (mirroring `Billing.md`'s ten sections) and the
  `docs/05-modules/README.md` "Implemented (EPIC-15)" block.
- `docs/08-tech-debt/TD-029-*.md` for the missing operator-triggered re-drive.
- Triage of the fourteen FISC-005a advisories and the four TD-028 advisories:
  each is actioned, turned into a Tech Debt item, or explicitly not actioned
  with a reason.
- `docs/10-qa/CI-EVIDENCE.md`, `docs/09-releases/CHANGELOG.md`,
  `docs/01-roadmap/ROADMAP.md`, `docs/01-roadmap/EPIC-15-Fiscal-Abstraction.md`
  and `docs/02-stories/FISC-005-fiscal-surface-and-closure.md` — all only with
  real executed evidence.
- The CI-EVIDENCE heading anomaly must be resolved deliberately: there is no
  `## EPIC-15` heading today and the FISC-002 receipt sits under `## EPIC-14`.

## Notes

- Base commit `3944fca` (merged `main`: EPIC-15 kickoff, FISC-002, FISC-003,
  FISC-004 and TD-028). Branch `feat/epic-15-fiscal-surface-and-closure`.
- EPIC-15 stays `planned` in the roadmap until this story closes, matching how
  EPIC-14 was tracked.
