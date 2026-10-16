---
id: TD-033
type: tech-debt
title:
  FISC-016's event advisories — the re-drive reason, the lease sweep, and two
  gates that do not run everywhere
status: open
severity: low
owner: fiscal
created: 2026-10-12
updated: 2026-10-13
related:
  - FISC-016
  - FISC-012
  - ADR-009
---

# TD-033 — FISC-016's event advisories

Four findings from FISC-016's reviews were accepted as debt rather than fixed.
Each is recorded with the coordinates a later reader needs, because the review's
full text is not retained. Item 4's diagnosis has since been corrected and its
signal-forwarding fix landed; the residual it leaves is recorded there as the
follow-up it is. **Item 5 is that follow-up**, and it is recorded as it was
closed: a fix with a residual of its own.

## 1. A re-drive carries the caller's new reason while the record keeps the original

`apps/api/src/fiscal/timbrado/timbrado.service.ts` (the adoption path). When a
claim past its lease is adopted and re-driven, the provider receives the **fresh
call's** `mOtEve` while the immutable `fiscal_range_void` row keeps the text of
the original attempt. The interval — the material thing, and the one a partial
submission may already have reached SIFEN with — is correctly adopted from the
record; the reason is not.

**Why it was not fixed**: the story pinned the interval, and adopting the reason
too is a product decision (whose words describe the void: the first operator's
or the one re-driving it). Severity is low because both reasons describe the
same intent and the record is the auditable one.

## 2. An in-flight claim past its lease has no automatic reconciliation sweep

The same file. A provider timeout leaves the range `VOIDING` with the claim
`IN_FLIGHT` — which is what keeps it unallocatable, and is correct. A retry
after the lease adopts and re-drives it, and an operator can do the same by
hand, but nothing sweeps stale in-flight claims the way
`redriveFiscalSubmission` sweeps submissions (TD-028's successor, FISC-012's
WU-F).

**Why it was not fixed**: the sweep is a scheduled job with its own cadence,
attempt cap and operator surface — the same shape FISC-012's reconciliation
needed — and it belongs with FISC-013's operational work rather than inside the
unit that introduced the state.

## 3. The signature round trip is XSD-gated, so it is inert locally

`packages/fiscal/src/dte/xsd-event-validation.test.ts`. The case that
re-verifies the signature **after** the serializer embeds the signed group — the
proof that closed the CRITICAL — sits inside the `describe.skipIf` that guards
the official schemas. Signature verification needs no XSD, so in a default local
run the guard does not execute. CI sets `DTE_XSD_REQUIRED=1`, so the gate is
real there.

**Why it was not fixed**: the correction's budget was spent, and moving one case
out of the guard changes a suite whose skip discipline is deliberate (a missing
directory must be a _visible_ skip, not a silent pass).

## 4. The caller's abort signal reached nothing, and cancel is where it matters

`packages/fiscal/src/sifen/sifen.facade.ts` and
`packages/fiscal/src/sifen/sifen-direct.provider.ts`. **Corrected diagnosis
(2026-10-13):** the original entry said "`voidRange` now reads `request.signal`;
`cancel` still does not". That was false. No method of the adapter forwarded the
caller's signal — not `cancel`, not `voidRange`, not `query`, and not `issue` —
because the facade bound exactly one signal, `dependencies.signal`, passed at
construction, and offered no per-call override. The abort `runWithinDeadline`
fires (`apps/api/src/fiscal/fiscal.deadline.ts`) therefore reached nothing, and
the HTTP call kept running past the deadline: whether SIFEN received the cancel
was unknown locally while the call completed remotely. The consequence that
matters is the cancellation's: the API maps a cancel timeout to
`TRANSIENT_FAILURE`, which persists `last_error_*` with no status change, so the
document stays locally cancellable/usable while the tax administration may
already have cancelled it. The void is protected against the same class of
problem not by its signal but by its own state machine (`VOIDING`/`IN_FLIGHT`).

**Fixed (branch `fix/td-033-cancel-reads-the-signal`).** The facade's `call()`
now takes an optional per-call `signal` and hands the transport a signal that
honours **both** the construction-level and the per-call one (`AbortSignal.any`
when both are present; the single one by reference otherwise; `undefined` when
neither is). All six public facade methods accept and forward it, and the
adapter forwards `request.signal` on the three port requests that carry one —
`query`, `cancel` and `voidRange`. `FiscalIssueRequest` declares no `signal`, so
`issue` has none to forward.

**What the fix does not do — the residual, as a follow-up.** It narrows the
window; it does not close the race. A request already on the wire may still
complete at SIFEN after the abort, so the local state can still disagree with
the tax administration's. Closing that needs the domain-level answer the void
already has: a cancel that ends in `TRANSIENT_FAILURE` should leave the document
in a state that is **not** locally cancellable/usable (`CANCEL_PENDING` exists
for exactly that meaning), plus a reconciliation for documents parked there.
That is a bigger design decision than this fix and is recorded here as the
follow-up it is.

The finding `R1-002` in its original, pre-void form was this hole on the
cancellation path; the signal-forwarding half of it is now closed.

## 5. A timed-out cancel left the document cancellable, so a second attempt was a second submission

`apps/api/src/fiscal/fiscal.service.ts` (`cancel` and `mapFiscalCancelOutcome`),
and the transition guard that admits the states it can write. The finding is
item 4's residual, in the words a later reader needs: a cancel that ended in
`TRANSIENT_FAILURE` — the API's 10 s deadline, or a transport failure —
persisted `last_error_*` and **left the status unchanged**. The document stayed
`APPROVED`, which means it was still cancellable: every guard admitted a second
attempt, and the tax administration received a **second cancellation for the
same document** while the first one's fate was unknown. The same
duplicate-submission family the range void closes with its claim, in the one
surface that had no claim state at all — and the 10 s deadline means the unknown
fate is not an exotic case, it is what a slow service produces.

**The honest state already existed and had no exit.** `CANCEL_PENDING` means
exactly "a cancellation was requested and its outcome is unknown", and
`APPROVED -> CANCEL_PENDING -> CANCELLED` was already legal — but there was no
way back into the parked state and nothing resolved it: no retrieved source
evidences a way to **query** a cancellation's fate (every `siRecepEvento*`
artifact in the baseline is a _reception_ wrapper), and the worker's sweep walks
`SUBMITTED`. Parking without a lease would have traded a duplicate submission
for a wedge, which is the failure this epic already spent four review rounds
fixing on the range void.

**Fixed (branch `fix/fisc-012-cancel-pending-lease`) — the state change and a
lease, as one design.**

- `mapFiscalCancelOutcome` now writes `CANCEL_PENDING` with a **fresh lease**
  and `accepted: true` for a `TRANSIENT_FAILURE`: the request _was_ made, and
  the reason code carries the timeout. The provider's own `CANCEL_PENDING` also
  starts a lease, because that document is exactly as unresolvable as a
  timed-out one.
- `fiscal_document.cancel_pending_since TIMESTAMPTZ(3)` is the lease: written
  when the document **enters** `CANCEL_PENDING` and refreshed by every later
  attempt. The window is `FISCAL_CANCEL_PENDING_LEASE_MS` — **five minutes**,
  the submission path's own claim lease, so the house has one number for "an
  attempt's fate has been unknown for this long" instead of two that drift.
- The retry policy lives in the API and the invariant in the database. `cancel`
  refuses a document already in `CANCEL_PENDING` with a **named 409**
  (`FISCAL_DOCUMENT_CANCEL_PENDING_MESSAGE`) and a retry-after in its `details`,
  and **never calls the provider**; once the lease is stale the attempt proceeds
  and the mapping rewrites the lease. A missing lease counts as stale, so a row
  parked without one can never wedge.
- The trigger enforces the structural half it can see
  (`20261013000001_fisc_012_cancel_pending_lease`, a
  `CREATE OR REPLACE FUNCTION` that carries the previous body forward verbatim):
  a `CANCEL_PENDING -> CANCEL_PENDING` edge is legal **only when the new lease
  is strictly newer than the old one**, so a writer cannot spin inside the
  parked state while the API believes a fresh attempt started.
- **A terminal failure keeps the old behaviour only where no fate is unknown.**
  `CONFIGURATION_ERROR` means nothing was sent (a missing credential, a document
  that could not be built) and `REJECTED` is the provider's own answer that the
  cancellation did not take effect; in both cases the document genuinely is
  still cancellable, and parking it would hide that. Only the retryable outcome
  — the one whose fate is unknown — is parked.

**What this does not fix.**

- The duplicate submission is closed only while the lease is live. A document
  can still sit in `CANCEL_PENDING` with an unknown fate until a retry after the
  window or an operator acts, and after the window the retry **is** a second
  submission — the deliberate trade, because the alternative is a state with no
  exit.
- **Automatic reconciliation stays blocked.** No retrieved source evidences a
  query for a cancellation's fate ([[ADR-007]] §6 records the open question), so
  nothing resolves a parked cancellation on its own. The worker's sweep walks
  `SUBMITTED` and was deliberately **not** extended: a `CANCEL_PENDING` row is
  not a submission, and an automatic sweep without a protocol behind it would be
  guesswork with the tax administration on the other side.
- Two retries issued **simultaneously** after the window expired are still two
  submissions. The trigger's monotonic-lease edge orders the writes; it does not
  serialize the attempts, because the retry path has no attempt compare-and-swap
  (the range void's claim has one). The window makes this a race of seconds
  rather than an open door, and closing it properly belongs with the
  reconciliation work above.
- The API's HTTP-boundary suite boots an in-memory Prisma double that does not
  model `cancel_pending_since`, so the lease's refusal is proven at the service
  unit level and by the live-PostgreSQL suite, never through the route.
  Extending the double is the small follow-up if the boundary ever needs that
  proof.
- `docs/02-stories/FISC-005-fiscal-surface-and-closure.md` still records the
  **superseded** mapping as its contract refinement 1 ("leave the status, store
  `last_error_*`, return a retryable `409`"). It is that story's historical
  record and is left as it stands; `docs/05-modules/Fiscal.md` is the surface
  that now describes the behaviour, and this item is where the divergence is
  noted.
