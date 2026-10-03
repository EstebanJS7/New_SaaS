---
id: TD-029
type: tech-debt
title: Fiscal submissions have no operator-triggered re-drive
status: scheduled
severity: low
related_epics:
  - EPIC-15
related_stories:
  - FISC-005
created: 2026-10-03
updated: 2026-10-03
---

# TD-029 — Fiscal submissions have no operator-triggered re-drive

## Context

[[DEC-052]] describes the staff fiscal surface as showing "document status,
submission results/errors, and the accepted issue/retry/cancel actions". The
epic implemented issue and cancel as explicit commands, but no retry route was
ever accepted or shipped: `FISC-004` deliberately deferred
`POST /fiscal-documents/:id/retry`, and `FISC-005b` then decided not to invent
it (`D8` of the story contract), because a retry route is a new command rather
than a missing wire.

What exists instead is the [[TD-028]] recovery sweep: it re-drives `QUEUED` and
`ERROR` documents whose effective last activity is older than a five-minute
window, in batches of 100, on a one-minute interval. It is the recovery path,
but it is **automatic and time-based**, and its only knob is the staleness
window.

## Debt

There is no way for an operator who has just diagnosed a failure to re-drive one
specific document immediately. Concretely:

- A document whose five BullMQ attempts are spent sits in `ERROR` until the
  sweep's next tick sees it as stale, so the shortest possible operator-visible
  recovery is bounded below by the five-minute window.
- A document whose enqueue failed stays `QUEUED` with no job at all, and the
  same window applies.
- The staff surface can show `lastErrorCode`, `lastErrorMessage` and the attempt
  count, so an operator can see exactly what failed and still cannot act on it.

The consequence is bounded and non-destructive: the sweep does recover these
documents, so the debt is latency and operator agency rather than a lost
submission.

## Why It Is Safe to Defer

- The sweep already covers both failure shapes, so no document is permanently
  stranded.
- Re-drive needs no schema change, no guard edge and no new status: the handler
  already treats `QUEUED` and `ERROR` as claimable, so a re-enqueued job claims
  the document directly. This was verified while writing the sweep.
- The re-drive primitive already exists and is exported:
  `redriveFiscalSubmission` over a minimal queue interface, including the
  terminal job removal that a deterministic `jobId` plus `removeOnFail: false`
  makes necessary.
- Adding the route later is additive: it would reuse `fiscal.invoice.issue` (no
  new permission key) and would not change any existing contract.

## Risk

Low. The failure mode is operator latency, not data loss: every document the
route would re-drive is already re-driven by the sweep. The risk of shipping a
route in a hurry is the opposite one — a second re-drive path that disagrees
with the sweep about what a live claim looks like, which is exactly why the
shared primitive must be reused rather than reimplemented.

## Re-evaluation / Exit Criteria

Re-open when either holds:

1. an operator reports a stale fiscal document and the five-minute window is the
   actual complaint; or
2. [[EPIC-16]] ships a real provider, where a provider-side outage makes a
   manual re-drive materially more valuable because the sweep's staleness window
   no longer dominates the recovery time.

The route, if it ships, must: reuse `redriveFiscalSubmission` rather than adding
a second re-drive implementation; stay behind `fiscal.invoice.issue`; return the
document representation; and be state-guarded so a `SENDING` document is a `409`
and a terminal one is a replay or a refusal, never a blind requeue.

## Related

- [[TD-028]] — the recovery sweep that covers the same documents on a timer.
- [[FISC-004]] — the slice that deferred the retry route.
- [[FISC-005]] — the slice that decided not to invent it (`D8`).
- [[DEC-052]] — names the retry action in the surface description.
