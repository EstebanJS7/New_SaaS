---
id: TD-030
type: tech-debt
title: Fiscal review advisories recorded but not actioned
status: scheduled
severity: low
related_epics:
  - EPIC-15
related_stories:
  - FISC-004
  - FISC-005
created: 2026-10-03
updated: 2026-10-03
---

# TD-030 — Fiscal review advisories recorded but not actioned

## Context

Two native reviews closed approved on the Fiscal epic and left non-blocking
advisories behind. Both reviews stated the same rule: advisories are **separate
later work and never a reason to re-run review on that candidate**. They are
therefore recorded here rather than fixed inside the candidate that produced
them.

- The [[FISC-005a]] review (lineage `review-2768c9087a428449`, tier high, four
  lenses) closed **approved** and left **fourteen** advisories.
- The [[TD-028]] review left **four** advisories, already listed in the
  [[FISC-005]] tracker's closure list.

## Debt

The advisories cluster into four themes. The theme names below are the
actionable part; the provider's closure envelope returned each advisory's id,
lens, location and severity but **not** its full claim text, so the four opaque
`R3-*` ids are recorded with their location instead of a paraphrase.

### 1. Cancel-route gate-order coverage (`R1-CANCEL-GATE-ORDER-NOT-COVERED`, WARNING)

`apps/api/src/fiscal/fiscal.service.ts:118-121` — the cancel command asserts the
entitlement before the permission, and no integration case pins that order for
this route (the issue and read suites do). Actionable: one case asserting
`403 FEATURE_NOT_ENTITLED` for an unentitled tenant and `403 FORBIDDEN` for an
entitled-but-unpermissioned one, with the provider never called.

### 2. Cancel-route observability and metadata

- `R1-CANCEL-REASON-ECHO-UNSCRUBBED-IN-ERROR` (SUGGESTION) —
  `fiscal.service.ts:191-195`, the refusal message echoes the provider reason.
- `R2-SENDING-BRANCH-NO-AUDIT-CONTEXT` (SUGGESTION) —
  `fiscal.service.ts:139-142`, the `SENDING` refusal writes no audit row.
- `R4-AUDIT-METADATA-NO-PROVIDER-IDENTITY` (SUGGESTION) —
  `fiscal.service.ts:158-172`, the cancellation audit carries the outcome but no
  provider identity.
- `R1-PROVIDER-SNAPSHOT-NOT-PERSISTED` (SUGGESTION) —
  `fiscal.service.ts:152-165`, the deliberate narrowness FISC-005a recorded: the
  cancel path persists no sanitized snapshot.

### 3. Retry and conflict semantics

- `R4-CANCEL-RETRY-UNBOUNDED` (WARNING) — `fiscal.service.ts:154-177`, an
  operator may re-issue the cancel command without bound.
- `R4-BILLING-CANCEL-CONFLICT-VS-404` (SUGGESTION) —
  `billing.service.ts:676-682`, the DEC-051 block is a `409` while a missing
  invoice is a `404`.

### 4. Test-support and readability

- `R2-BOOT-PROVIDER-MUTABLE-BINDING` (SUGGESTION) and `R3-004` (SUGGESTION) —
  `apps/api/test/support/boot-test-app.ts:113-131`, the scriptable fiscal
  provider's mutable delegate binding.
- `R2-STRUCTURAL-READ-MIRROR` (SUGGESTION) and `R3-003` (SUGGESTION) —
  `apps/api/src/billing/billing.repository.ts:228-240`, the locally declared
  `fiscalDocument` read delegate mirroring the Fiscal read type.
- `R2-UNNAMED-MAGIC-500` (SUGGESTION) — `fiscal.service.ts:70-71`, the `scrub`
  length cap is a bare literal.
- `R3-001` (WARNING, `fiscal.service.ts:144-166`) and `R3-002` (WARNING,
  `fiscal.service.ts:174-179`) — reliability advisories recorded by id and
  location only.

### 5. The TD-028 sweep advisories (already listed in the FISC-005 tracker)

- `R3-BATCH-LIMIT-NO-PROGRESS-GUARD` (WARNING) — the sweep always takes the
  oldest batch, so a persistently failing head could starve newer documents.
- `R3-SKIPPED-COUNTED-AS-REQUEUED` (SUGGESTION) — a skipped re-drive is counted
  as requeued, affecting log counts only.
- `R3-MISSING-OVERLAP-TEST` (SUGGESTION) — the overlap guard is not unit-covered
  because the queue only exists after `onModuleInit`.
- `R3-SUBMITTED-NOT-AUDITED` (WARNING) — a `SUBMITTED` outcome is not audited.

### 6. The FISC-005b chain advisories (eleven, all informational)

Locations are the reviewed revision's line numbers. Two are WARNINGs and both
sit in the workspace's cancel-command state, the same place the FISC-005a
advisories pointed, so the two sets are worth reading together.

**Read contract (`review-dd26b5d31ff25018`, tier medium)**

- `R3-list-unbounded` (WARNING, `apps/api/src/fiscal/fiscal.zod.ts:41-44`) — the
  list has no pagination; this is the Fiscal instance of [[TD-026]].
- `R3-get-non-tx-read` (SUGGESTION, `fiscal.service.ts:189-194`) — the by-id
  read runs outside a transaction.
- `R3-list-determinism-tiebreak` (SUGGESTION,
  `apps/api/test/support/in-memory-database.ts:3583-3596`) — the in-memory
  list's `createdAt` tiebreak.
- `R3-read-entitlement-before-permission` (SUGGESTION,
  `fiscal.integration.test.ts:487-495`) — the read gate order's coverage.

**Client, proxy and nav (`review-b67e9dfd40dbb1d1`, tier medium)**

- `R3-REQID-STRIP` (SUGGESTION,
  `apps/web/src/app/api/fiscal/[[...path]]/route.ts:132-154`) — how the proxy
  handles `x-request-id`.
- `R3-CHANGED-PATH-LITERAL` (SUGGESTION,
  `apps/web/src/app/api/fiscal/[[...path]]/route.test.ts:196-209`) — a literal
  in the changed-path case.
- `R3-FISCAL-NAV-FEATURE` (SUGGESTION,
  `apps/web/src/components/shell/nav-sidebar.tsx:38`) — the Fiscal nav entry's
  declarative feature gate, which is dormant exactly like Billing's.

**Workspace (`review-0a69015d0b17a603`, tier medium)**

- `R3-cancel-error-identity` (WARNING,
  `apps/web/src/app/(app)/app/fiscal/fiscal-surface.tsx:82`) — the cancel error
  is bound to the selected document's identity.
- `R3-cancel-inflight-selection-swap` (WARNING,
  `apps/web/src/app/(app)/app/fiscal/fiscal-surface.tsx:85`) — switching the
  selected document while a cancel is in flight.
- `R3-detail-error-folding` (SUGGESTION,
  `apps/web/src/app/(app)/app/fiscal/fiscal-surface.tsx:92`) — how the detail
  error folds into the read error.
- `R3-issue-clears-on-select` (SUGGESTION,
  `apps/web/src/app/(app)/app/fiscal/fiscal-surface.tsx:132`) — selecting a row
  resets a settled issue mutation.

## Why It Is Safe to Defer

- Every advisory is explicitly **non-blocking**: neither review offered a
  correction transition for it, and both stated the rule above.
- The two WARNINGs that are actionable without new context are narrow: a missing
  integration case and a log-count inaccuracy. Neither is a correctness defect
  in a shipped path.
- Nothing here changes a contract, a status, a guard or a route.

## Risk

Low. The realistic cost is that the cancel route's gate order could regress
without a test noticing, and that an operator debugging a cancellation sees a
slightly thinner audit row than would be ideal. Both are bounded and neither
affects data integrity.

## Re-evaluation / Exit Criteria

Re-open when a writer next touches `apps/api/src/fiscal/fiscal.service.ts`,
`apps/api/src/billing/billing.repository.ts`,
`apps/api/src/billing/billing.service.ts`,
`apps/api/test/support/boot-test-app.ts` or
`apps/web/src/app/(app)/app/fiscal/fiscal-surface.tsx`, or when [[EPIC-16]] adds
the real provider — whichever comes first. At that point the theme-1 case should
be added outright and the remaining items triaged again, since a real provider
changes what "provider identity in the audit" and "snapshot on cancellation" are
worth, and the two workspace WARNINGs in theme 6 should be settled with the
cancel-state rework they imply.

## Related

- [[FISC-005a]] — the slice whose review produced fourteen of these.
- [[TD-028]] — the slice whose review produced the other four.
- [[TD-029]] — the separate, larger operator re-drive gap.
