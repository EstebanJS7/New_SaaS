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
updated: 2026-10-12
related:
  - FISC-016
  - FISC-012
  - ADR-009
---

# TD-033 — FISC-016's event advisories

Four findings from FISC-016's reviews were accepted as debt rather than fixed.
Each is recorded with the coordinates a later reader needs, because the review's
full text is not retained.

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

## 4. The cancellation path has the same timeout hole the void had

`packages/fiscal/src/sifen/sifen-direct.provider.ts`. `voidRange` now reads
`request.signal`; `cancel` still does not, so a cancelled-at-the-deadline
cancellation can complete at SIFEN while the document stays uncancelled locally
— the finding `R1-002` in its original, pre-void form. The port's own doc says
an adapter that ignores the signal "still gets a bounded caller", so this is
tolerated behaviour rather than a contract violation.

**Why it was not fixed**: it is FISC-012's surface, and the review's scope was
the void. It is the smallest of the four and the one most likely to matter in
production, so it should be the first to go.
