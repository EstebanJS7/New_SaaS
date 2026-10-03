---
feature: fisc-004a-fiscal-submission-recovery
epic: EPIC-15
story: TD-028
status: in-progress
created: 2026-10-03
updated: 2026-10-03
branch: feat/epic-15-fiscal-submission-recovery
base_commit: ac61c1a
---

# FISC-004a Fiscal submission recovery — ODD task tracker

## Goal

Close [[TD-028]]: an interval-driven sweep that re-drives fiscal submissions
with no operator path forward, using the branding reset-cleanup reconciliation
service as its template.

## TDD resolution

- Mode: **off**. Authoritative source: `openspec/config.yaml` sets
  `strict_tdd: false` and `rules.apply.tdd: false`.
- Gates: the focused worker suite, `pnpm test`, `typecheck`, `lint`, `build`,
  `format-check`.

## A correction to the parent's own assumption

The parent first reasoned that a requeue would need **new edges in the
transition guard** (`ERROR -> QUEUED`, `QUEUED -> QUEUED`). The read-only
mapping proved that wrong, and the pinned contract below is built on the
corrected reading:

- `QUEUED -> QUEUED` is never blocked, because the guard's allow-list is only
  consulted `IF NEW."status" IS DISTINCT FROM OLD."status"`.
- The handler already treats `QUEUED` and `ERROR` as claimable
  (`CLAIMABLE_STATUSES`), so a re-enqueued job claims the document directly.

**Therefore the sweep changes no status at all, and needs no migration, no guard
extension and no schema change.** It only re-adds a BullMQ job. This is recorded
because the wrong assumption would have produced a speculative migration — the
same over-specification FISC-002 and FISC-004 each already paid for once.

## Pinned technical contract (binding on the writer)

### Files

```text
apps/worker/src/fiscal-submission/fiscal-recovery.constants.ts
apps/worker/src/fiscal-submission/fiscal-recovery.service.ts
apps/worker/src/fiscal-submission/fiscal-recovery.service.test.ts
apps/worker/src/worker.module.ts
```

### Constants — `fiscal-recovery.constants.ts`

Mirror `branding-reset-cleanup/cleanup.constants.ts`, including its tolerant
`readPositiveInt` reader (blank, non-finite or `<= 0` falls back):

```ts
export const DEFAULT_FISCAL_RECOVERY_INTERVAL_MS = 60_000;
export const DEFAULT_FISCAL_RECOVERY_STALE_MS = 300_000;
export const FISCAL_RECOVERY_BATCH_LIMIT = 100;
export interface FiscalRecoveryTiming {
  readonly intervalMs: number;
  readonly staleMs: number;
}
export function resolveFiscalRecoveryTiming(
  env?: NodeJS.ProcessEnv
): FiscalRecoveryTiming;
```

Env keys: `FISCAL_SUBMISSION_SWEEP_INTERVAL_MS` and
`FISCAL_SUBMISSION_STALE_MS`.

The stale default of five minutes is deliberate and must be documented: it is
comfortably above the retry budget (five attempts with exponential backoff from
one second is about 31 seconds of backoff) and equal to the handler's
`CLAIM_LEASE_MS`, so the sweep never races a claim that is still live.

### The pure function — `fiscal-recovery.service.ts`

```ts
export interface RecoverDocumentRow {
  readonly id: string;
  readonly tenantId: string;
  readonly status: "QUEUED" | "ERROR";
}
export interface RecoverDocumentDelegate {
  findMany(args: {
    where: {
      status: { in: readonly string[] };
      OR: readonly [
        { lastAttemptAt: { lt: Date } },
        { lastAttemptAt: null; createdAt: { lt: Date } },
      ];
    };
    select: { id: true; tenantId: true; status: true };
    orderBy: { createdAt: "asc" };
    take: number;
  }): Promise<RecoverDocumentRow[]>;
}
export interface FiscalRecoveryDeps {
  readonly fiscalDocument: RecoverDocumentDelegate;
  readonly redrive: (document: RecoverDocumentRow) => Promise<void>;
  readonly now: Date;
  readonly staleMs: number;
  readonly batchLimit?: number;
}
export interface FiscalRecoveryResult {
  readonly scanned: number;
  readonly requeued: number;
  readonly failed: number;
}
export async function recoverStaleFiscalSubmissions(
  deps: FiscalRecoveryDeps
): Promise<FiscalRecoveryResult>;
```

Rules, each with a test:

- the threshold is `now - staleMs`, and staleness is
  `COALESCE(last_attempt_at, created_at) < threshold` — a `QUEUED` document has
  never been attempted, so its `created_at` is the only signal, and an `ERROR`
  document has `last_attempt_at`;
- `batchLimit` defaults to `FISCAL_RECOVERY_BATCH_LIMIT`;
- one `redrive` failure is counted, never fatal: one poison document must not
  block recovery of the rest of the backlog;
- the function is deterministic and Redis-free — the caller supplies `now` and
  the `redrive` closure, so the suite needs no Redis.

### The Nest service — same file

Mirror `BrandingResetCleanupReconciliationService` exactly in shape:

- owns its own `Queue` and `Redis` connection, both built in `onModuleInit` and
  both torn down in `onModuleDestroy` (queue closed, then the connection quit
  with a `disconnect()` fallback);
- `onModuleInit` throws `REDIS_URL is not set` when unset;
- schedules with a raw `setInterval` plus `timer.unref()` — no scheduler
  technology;
- a `sweeping` boolean skips an overlapping tick;
- `sweepOnce(now = new Date())` is public and returns the result, so a test can
  drive one sweep without waiting for the interval;
- timing is read once at construction.

**The re-drive closure is the part that must be right**, and its reasoning must
be in a comment:

```ts
const jobId = fiscalSubmissionJobId(document.id); // the deterministic identity
const existing = await queue.getJob(jobId);
if (existing !== undefined) {
  const state = await existing.getState();
  if (state === "failed" || state === "completed") {
    await existing.remove();
  } else {
    return; // waiting, active or delayed: a live delivery already exists
  }
}
await queue.add(
  FISCAL_SUBMISSION_JOB,
  { fiscalDocumentId: document.id, tenantId: document.tenantId },
  fiscalSubmissionJobOptions(document.id)
);
```

Why the removal is required, and why it is safe:

- `jobId` is deterministic and `removeOnFail: false` keeps a failed job in the
  queue, so BullMQ's job-id dedupe would make a plain `add` a **no-op** and the
  sweep would silently do nothing. The terminal job must be removed first.
- A job in `waiting`, `active` or `delayed` means a live delivery already
  exists, so the sweep must leave it alone; that is the case the `else` covers.
- Removing the failed job does **not** lose operator evidence: the failure of
  record is the database row (`lastErrorCode`, `lastErrorMessage`,
  `attemptCount`) plus the SYSTEM audit rows the handler writes per attempt. The
  queue's failed set is a convenience for a human inspecting the queue before
  the sweep runs, and the comment on `removeOnFail: false` in
  `packages/fiscal/src/fiscal-submission.queue.ts` must be corrected to say
  exactly that instead of claiming the failed job is the evidence FISC-005
  reads.
- `fiscalSubmissionJobId(id)` is a small exported helper on the queue contract
  so the producer and the sweep cannot disagree about the identity. The queue
  module currently inlines the template literal, so add the helper and have
  `fiscalSubmissionJobOptions` use it.

### Audit

Each successful re-drive appends one audit row, `actorType: "SYSTEM"`, action
`fiscal.document.submission_requeued`, `targetType: "fiscal_document"`, metadata
`{ previousStatus, attemptCount }` — never a payload or a snapshot. SIFEN.md
requires fiscal retries to be audited, and a sweep-driven re-drive is a retry.

### What the sweep must NOT do

- No status write, and therefore no migration and no guard change. If the writer
  believes a status change is needed, that is a contract error to report rather
  than to implement.
- Do not touch `SENDING`. BullMQ's own stalled-job recovery re-queues an active
  job whose worker died, and the handler's five-minute lease lets that
  redelivery take the claim over. Adding `SENDING` here would race that
  mechanism for no gain.
- Do not reset `attempt_count`: the monotonic trigger forbids a decrease and the
  counter is the document's attempt history.
- Do not touch resolved or cancelled documents.

### Wiring

Register the service in `apps/worker/src/worker.module.ts` as a plain provider
alongside `FiscalSubmissionHandler` and `FiscalSubmissionConsumer`.

### Tests — `fiscal-recovery.service.test.ts`

Cover the pure function with a hand-rolled fake delegate, Redis-free:

- stale `QUEUED` and `ERROR` documents are re-driven and counted;
- the query carries the coalesce shape (`OR` of `lastAttemptAt < threshold` and
  `lastAttemptAt: null` with `createdAt < threshold`) and the batch limit;
- the threshold is exactly `now - staleMs`, asserted on the ISO string;
- one `redrive` rejection is counted without aborting the sweep;
- an empty backlog returns zeroes.

Cover the transport layer too, because the branding template left it uncovered
and that is exactly where the removal-versus-dedupe logic lives:

- with a fake `Queue`, a **terminal** (`failed`/`completed`) job for the
  document is removed before the add, and the add carries the deterministic job
  id and the pinned options;
- a job in `waiting`/`active`/`delayed` is left alone and **no** add happens;
- no existing job means a plain add;
- the overlap guard makes a second concurrent `sweepOnce` a no-op.

## Tasks

- [ ] T1 — Create `TD-028` and pin this contract into the tracker.
- [x] T2 — Add `fiscalSubmissionJobId` to the queue contract and correct the
      `removeOnFail` comment.
- [x] T3 — Add the constants, the pure function and the Nest service.
- [x] T4 — Add the suite, including the transport-layer cases.
- [x] T5 — Register the service and verify: focused suite, `pnpm test`,
      `typecheck`, `lint`, `build`, `format-check`; then the native review.

## Notes

- Base commit `ac61c1a` (merged `main`, FISC-004). Branch
  `feat/epic-15-fiscal-submission-recovery`.
- No migration, no schema change, no route, no UI. This is a worker-only slice.
- The live-PostgreSQL suite is unaffected: the sweep writes no status and needs
  no new probe.
