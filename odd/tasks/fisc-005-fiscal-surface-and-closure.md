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

## Pinned technical contract (binding on the writer)

To be pinned in full once D1-D6 are settled. The shape is already known from the
shipped precedents:

- the guard migration is additive, `CREATE OR REPLACE FUNCTION` only, and must
  not relax any of the six existing guards;
- the Fiscal cancellation command is a `POST /fiscal-documents/:id/cancel` route
  gated on `fiscal.invoice.issue` (no new permission key, so the seed probes
  stay at `permissions: 56`) with a required reason, mirroring
  `POST /invoices/:id/cancel`;
- the staff surface mirrors the shipped Cash and Billing workspaces, with the
  full state coverage and semantic tokens only;
- the closure updates `docs/05-modules/Fiscal.md`, CI evidence, changelog and
  roadmap only with real receipts.

## Deferred items that belong in the closure list

The four advisories the TD-028 review recorded and did not action:
`R3-BATCH-LIMIT-NO-PROGRESS-GUARD` (a persistently failing head of the sweep
backlog could starve newer documents), `R3-SKIPPED-COUNTED-AS-REQUEUED` (a
skipped re-drive is counted as requeued), `R3-MISSING-OVERLAP-TEST` (the sweep's
overlap guard is not unit-covered because its queue only exists after
`onModuleInit`), and `R3-SUBMITTED-NOT-AUDITED`.

## Tasks

- [ ] T1 — Get the nod on D1-D6, then pin the full contract.
- [ ] T2 — FISC-005a: `cancel` on the port and the fake.
- [ ] T3 — FISC-005a: the guard's cancellation edges, additive migration plus
      schema and live-PostgreSQL probes.
- [ ] T4 — FISC-005a: the Fiscal cancellation command and the Billing hand-off.
- [ ] T5 — FISC-005b: the staff fiscal surface.
- [ ] T6 — FISC-005b: module docs, CI evidence, changelog, roadmap, epic
      closure.

## Notes

- Base commit `3944fca` (merged `main`: EPIC-15 kickoff, FISC-002, FISC-003,
  FISC-004 and TD-028). Branch `feat/epic-15-fiscal-surface-and-closure`.
- EPIC-15 stays `planned` in the roadmap until this story closes, matching how
  EPIC-14 was tracked.
