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
follow-up it is.

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
