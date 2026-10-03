---
id: FISC-005
type: story
title: Fiscal surface and epic closure
epic: EPIC-15
status: done
priority: high
depends_on:
  - FISC-004
prd_sections:
  - "22"
  - "36"
  - "38"
  - "40"
  - "41"
permissions:
  - fiscal.invoice.issue
  - fiscal.read
branch:
  feat/epic-15-fiscal-surface-and-closure, feat/epic-15-fiscal-staff-surface
created: 2026-10-02
updated: 2026-10-03
---

# FISC-005 — Fiscal surface and epic closure

## Objective

Ship the minimal staff-facing fiscal operational surface selected by the
accepted decisions, close the invoice cancellation hand-off, and record EPIC-15
module/release evidence.

## Context

[[DEC-042]] says EPIC-15 owns the `fiscal-ui` surface. [[DEC-043]] requires this
epic to revisit confirmed invoice cancellation after `FiscalDocument` exists.
Portal documents remain deferred by [[TD-022]] unless an accepted decision
changes that scope.

## In Scope

- Minimal staff fiscal status/action UI or explicit API-only scope if selected
  by accepted decisions.
- Typed `fiscal-ui` settings namespace if selected by accepted decisions.
- Confirmed-invoice cancellation hand-off resolution.
- Fiscal module documentation, roadmap/changelog/CI evidence and epic closure.

## Out of Scope

- Customer portal documents/KuDE.
- PDF/print/export and notifications.
- Real fiscal provider configuration beyond safe references.

## Acceptance Criteria

- [x] Staff can inspect the fiscal status and operational outcome required by
      the accepted surface decision.
- [x] Any fiscal actions are gated by backend authorization, the `fiscal`
      feature code and the accepted fiscal permission keys; frontend checks are
      UX only.
- [x] Loading, empty, error, success, permission-denied and entitlement-denied
      states are covered when UI is in scope.
- [x] Confirmed invoice cancellation no longer silently contradicts approved
      fiscal documents: it either requests Fiscal cancellation or the accepted
      decision records the separate workflow and UI/API block.
- [x] `docs/05-modules/Fiscal.md` documents aggregate behavior, states, provider
      boundary, queues, retry/idempotency, authorization, audit, settings and
      limitations.
- [x] `docs/10-qa/CI-EVIDENCE.md`, `docs/09-releases/CHANGELOG.md` and
      `docs/01-roadmap/ROADMAP.md` are updated only with real verification/CI
      evidence.
- [x] EPIC-15 exits with required checks green or explicit non-green/pending
      evidence recorded.

## Domain Invariants

- Fiscal operations are explicit, authorized and audited.
- Portal identities do not gain staff fiscal access.
- Fiscal cancellation follows provider/Fiscal state rules, not local invoice
  edits.

## API

### Added

```text
Fiscal status/action routes per accepted decisions.
```

### Changed

```text
Invoice cancellation may be extended only through the accepted Fiscal hand-off.
```

## Database

### Migration

```text
Only if accepted settings/surface/cancellation resolution requires additive schema.
```

### Models/Tables

- Uses `FiscalDocument` and settings namespace rows when selected.

## UI

- Planned staff fiscal surface if accepted by [[DEC-052]].
- Reusable components must use semantic design tokens only.

## Implementation Summary

Delivered in two PRs under one story (`D1`), because the slice mixes a fiscal
protocol change with UI work and FISC-004 had already needed a refuter.

**FISC-005a — the cancellation hand-off (PR #102).** `cancel` on the provider
port and the deterministic fake; the guard's cancellation edges as an additive
migration (`20261004000001_fiscal_document_cancellation_guard`, a
`CREATE OR REPLACE FUNCTION` that relaxes none of the six guards in force); the
synchronous `POST /fiscal-documents/:id/cancel` behind the existing
`fiscal.invoice.issue` (no new key); and the `DEC-051` Billing hand-off through
`FiscalService.hasLiveDocumentForInvoice`, read inside Billing's cancellation
transaction so it serializes with the issue command.

The command runs in three phases because AGENTS.md forbids external fiscal calls
inside long-running transactions: a short lock-and-classify transaction, the
provider call outside any transaction bounded by a 10 s deadline, then one
transaction that applies the outcome through a conditional write pinned to the
observed status and co-commits the audit row. Refusals are thrown after that
transaction commits so `last_error_*` and the audit row persist.

**FISC-005b — the read contract and the surface (PR #103).** A read-wide
`fiscal.read` key for all six roles (seed 56 → 57, `rolePermissions` 187 → 193),
`GET /fiscal-documents` and `GET /fiscal-documents/:id`, the DTO's
`cancelledAt`, the `/app/fiscal` workspace with its client layer and
`/api/fiscal` proxy, the module documentation and the epic closure.

**Three contract refinements, each recorded rather than silently applied.**

1. `TRANSIENT_FAILURE` does **not** move a cancellation to `ERROR`. The pinned
   command contract asked for it, but the accepted `D3` graph admits `ERROR`
   only from `SENDING` and `SUBMITTED`; the maintainer chose the smallest
   compatible path — leave the status, store `last_error_*`, return a retryable
   `409`.
2. No retry route ships (`D8`). `DEC-052` names a retry action, but no retry
   route was ever accepted; the `TD-028` sweep covers the same documents on a
   five-minute window, so the gap is recorded as [[TD-029]].
3. No `fiscal-ui` settings namespace ships (`D6`). The surface needs no
   configurable value and a namespace with no consumer is config surface for its
   own sake; PRD §38 names it, and leaving it unregistered with a recorded
   reason is honest.

**One candidate-caused CRITICAL was found and fixed.** The FISC-005a refuter
confirmed `R4-PROVIDER-CALL-NO-BOUND`: the cancel command called the provider
with no timeout, deadline or abort signal, so a hung provider turned a staff
cancellation into an unbounded open request with no `last_error_*`, no audit row
and no release but re-issuing the command. `FiscalCancelRequest` now carries an
optional `AbortSignal` and `cancelWithinDeadline` bounds the call at
`FISCAL_CANCEL_TIMEOUT_MS = 10_000`, reporting a retryable `TRANSIENT_FAILURE`
through the existing refusal path. A targeted validator then approved the
correction.

## Verification

```text
CI run 37155574081 (PR #103) — both required checks SUCCESS
  Database migrations
    32 migrations found; All migrations have been successfully applied.
    seed idempotency: roles 6, permissions 57, featureCodes 12, plans 1,
      rolePermissions 193, planCapabilities 12, species 6, breeds 9, taxRates 3
      (identical after the second seed)
    LIVE MIGRATION VERIFICATION PASSED
    live-PostgreSQL application-path isolation: 213 passed (213)
  Lint, Typecheck, Test, Build -> SUCCESS
    database 21 files / 416 tests; fiscal 5 / 50; worker 9 / 72;
    API 81 files / 1068 tests passed (213 skipped without DATABASE_URL_TEST);
    web 99 files / 1087 tests

CI run 37150885463 (PR #102) — both required checks SUCCESS
  Database migrations: 32 migrations, live-PostgreSQL 203 passed (203)
  Lint, Typecheck, Test, Build -> SUCCESS

Local gates at closure
  pnpm test -> 17/17 tasks; pnpm typecheck -> 16/16; pnpm lint -> 16/16;
  pnpm build -> 10/10; pnpm format-check -> clean
  db:deploy -> 32 migrations; db:seed -> permissions 57, rolePermissions 193;
  test:live-pg -> 213 passed (213)
```

The live-PostgreSQL gate executed the FISC-005a cancellation-edge probes for the
first time in this epic: per-edge admission for the new edges, the
`APPROVED -> CANCEL_PENDING -> CANCELLED` path that keeps its resolution
timestamp, and the `CANCELLED`-source probe that records which same-timing
trigger actually fires.

## Tests Added

- `apps/api/src/fiscal/fiscal.integration.test.ts` — **21 cases**: the issue
  command, the cancellation command (replay, `SENDING`, refusals, tenant
  masking, gates, validation) and the read contract (list, filter, detail, 404s,
  gate order, validation, no audit on reads).
- `apps/api/src/fiscal/fiscal.service.test.ts` — the deadline-bounding helper:
  timely success, timeout with an aborted signal, rejection propagation, timer
  cleanup and the default deadline.
- `apps/api/src/fiscal/fiscal-boundary.test.ts` — the Billing rule changed to
  "the Fiscal application boundary only", with the shared-package ban and the
  concrete-provider ban kept as their own cases.
- `apps/api/src/rbac/route-contract.probe.test.ts` — the two new routes and
  their `fiscal.read` permission pin, plus the cancellation route from
  FISC-005a.
- `apps/api/test/live-pg-isolation.e2e-spec.ts` — the cancellation edges per
  edge, the resolution-preserving path and the trigger-order probe (213 cases
  total).
- `apps/web/src/app/(app)/app/fiscal/*` and
  `apps/web/src/app/api/fiscal/[[...path]]/route.test.ts` — client, display,
  validation, outcome, three panels, the workspace's six states and the proxy
  contract (**7 cases**).
- `apps/web/src/components/shell/nav-sidebar.test.tsx` — the Fiscal entry's
  position, counts, hrefs and capability gating.
- `packages/database/src/reference-seed.test.ts` — the seed probe moved 56 → 57
  with the read-wide grant asserted for every role.

## Known Limitations

- The only provider is a deterministic fake. No real SIFEN adapter, XML,
  signature or KuDE exists until [[EPIC-16]].
- No `fiscal-ui` settings namespace ships, so PRD §38's namespace is
  unregistered ([[DEC-052]], `D6`).
- No operator-triggered re-drive exists; a document whose attempts are spent
  waits for the sweep's five-minute window ([[TD-029]]).
- Portal document and KuDE access remain deferred ([[TD-022]]).
- `GET /fiscal-documents` is unbounded ([[TD-026]]).
- The navigation entitlement gate is dormant because no browser-side entitlement
  source is wired; the backend gate remains authoritative.
- The cancel route's gate order has no dedicated integration case, and the
  remaining review advisories are recorded rather than actioned ([[TD-030]]).

## Technical Debt

- [[TD-022]] is re-evaluated by this Story but not closed: the portal fiscal
  document surface stays deferred.
- [[TD-029]] is created by this Story: no operator-triggered fiscal re-drive.
- [[TD-030]] is created by this Story: the review advisories from FISC-005a and
  TD-028, recorded with dispositions rather than actioned inside the candidates
  that produced them.
- The four [[TD-028]] sweep advisories remain open and are listed in [[TD-030]].

## Decisions / ADRs

- Depends on accepted [[DEC-051]] and [[DEC-052]].

## Files / Modules

- `apps/web/src/app/(app)/app/fiscal/*` or selected staff surface path
- `apps/api/src/fiscal/*`
- `apps/api/src/billing/*` only for accepted cancellation hand-off
- `docs/05-modules/Fiscal.md`
- `docs/10-qa/CI-EVIDENCE.md`
- `docs/09-releases/CHANGELOG.md`
- `docs/01-roadmap/ROADMAP.md`

## Decisions / ADRs

- Depends on accepted [[DEC-051]] and [[DEC-052]].
- Records three contract decisions taken during implementation: `D7` (the
  read-wide `fiscal.read` plus the list and detail reads), `D8` (no retry route;
  [[TD-029]]) and `D9` (the surface lives at `/app/fiscal`). The full pinned
  contract is in `odd/tasks/fisc-005-fiscal-surface-and-closure.md`.
- `D1` split the story into FISC-005a (PR #102) and FISC-005b (PR #103).

## Completion Notes

Closed 2026-10-03 with both required CI checks green on run `37155574081`, the
live-PostgreSQL gate executed locally and in CI (213 cases), and the FISC-005a
native review closed approved with its one CRITICAL corrected before approval.
FISC-005b's own slice was not put through a native review: the epic's surface
and read work was covered by the FISC-005a lineage's closure, and the story
records that rather than implying a verdict it does not have.

The PRs are #102 (FISC-005a, merged state decided by ordinary repository policy)
and #103 (FISC-005b, stacked and green).
