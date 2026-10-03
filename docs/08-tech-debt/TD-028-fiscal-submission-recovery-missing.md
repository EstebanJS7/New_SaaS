---
id: TD-028
type: tech-debt
title: Fiscal submissions have no out-of-band recovery for exhausted retries
status: scheduled
severity: medium
related_epics:
  - EPIC-15
related_stories:
  - FISC-004
created: 2026-10-03
updated: 2026-10-03
---

# TD-028 — Fiscal submissions have no out-of-band recovery for exhausted retries

## Context

FISC-004 shipped the queued fiscal submission: `POST /fiscal-documents` creates
a `FiscalDocument` and enqueues one BullMQ job, and the worker claims the
document into `SENDING`, calls the provider port and writes the outcome. Two
failure paths leave a document with **no operator path forward**, and neither is
closed by the lease the native review's R4-2 correction added:

1. **Exhausted retries.** A document whose five BullMQ attempts are spent sits
   in `ERROR` with `removeOnFail: false` keeping the failed job visible. Nothing
   re-drives it. A manual retry is [[FISC-005]]'s, and the sweep that would
   automate it was deferred.
2. **A failed enqueue.** `POST /fiscal-documents` commits the document as
   `QUEUED` and then enqueues; if that enqueue fails, the request surfaces an
   error (promptly, thanks to R4-1's deadline) but the document stays `QUEUED`
   with **no job at all**.

The lease added by R4-2 makes an _abandoned claim_ recoverable in band: a
redelivered job may take over a `SENDING` claim older than five minutes. That
covers a worker that died while a job was still being redelivered. It does not
cover either path above, because in both cases there is no delivery to recover
with.

## Debt

A silent, operator-invisible stall in a fiscal flow. The document is correct in
the database and its failure is recorded (`lastErrorCode`, `lastErrorMessage`,
`attemptCount`, audit rows), so nothing is lost or corrupted — but no automatic
mechanism ever tries again, and the only recourse is manual database surgery.

## Why It Is Safe to Defer

It is recorded rather than hidden, the failure is visible in the row and the
audit trail, and no confirmed document is affected: a document in `ERROR` or
`QUEUED` has no approved fiscal state to contradict. The shipped template for
the fix is the branding reset-cleanup reconciliation service, which is small,
tested and proven.

## Risk

A fiscal document that never resolves blocks the operator's invoicing flow for
that sale, and `CANCELLED`-vs-approved consistency checks in [[FISC-005]] will
see a document that is neither resolved nor cancelled. In a multi-tenant
deployment the affected set grows with any Redis or worker outage that outlives
the retry budget.

## Re-evaluation / Exit Criteria

Close when a scheduled sweep re-drives both paths: it re-enqueues documents
stuck in `QUEUED` with no job and documents in `ERROR` whose retries are
exhausted, idempotently, with the deterministic job id preserved and each
recovery audited.

## Related

- [[FISC-004]] — the slice that introduced the flow and this debt.
- [[EPIC-15]] — the epic that owns it.
- The branding cleanup reconciliation service is the implementation template.
