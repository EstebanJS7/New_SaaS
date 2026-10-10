---
id: DEC-055
type: decision
title: FISC-012's scope — the worker's adapters, the QR, and the reconciliation
status: accepted
date: 2026-10-08
related_epics:
  - EPIC-16
related_stories:
  - FISC-012
  - FISC-011
  - FISC-013
prd_change_required: false
---

# DEC-055 — FISC-012's scope

## Context

[[FISC-012]] replaces the fake with the real provider and makes the worker
submit a real document. A read-only reconnaissance on 2026-10-08 (two mapping
passes over `main` = `ff8954e`, plus one retrieval) found five things that
decide the scope, and one of them **corrects the baseline**:

1. **The QR is not blocked.** `SIFEN-BASELINE.md` §14 grades it **[O] open**;
   the Manual's §13.8 pins it completely, and the earlier extraction had dropped
   it. It is now recorded in §24 with its retrieval record — the third time this
   vault has recorded that a source read with one tool looks silent.
2. **The worker has no credential boundary at all**:
   `FiscalProviderModule.forRoot()` is imported with no `credentialPort` (so the
   fail-closed null port runs), there is no `@newsaas/secret-store` dependency
   and no `SECRET_STORE_*` env entry.
3. **`apps/api` and `apps/worker` share no code beyond workspace packages**
   ([[ADR-008]]), and the API already holds a `TimbradoRangeStore`
   implementation (153 lines) plus the profile/establishment reads — both
   coupled to the API's request context.
4. **The port's request carries invoice data, not a document** — decided by
   [[ADR-009]], which this document does not repeat.
5. **The XSD gate is dev-only** (`libxmljs2` is a devDependency; the validator
   is exported only from `testing.ts`), while the epic's criteria say a DTE XML
   validates **before any submission** — decided by [[ADR-010]].

## Q1 — Where do the worker's Prisma adapters live?

The worker needs three reads: the timbrado range store (the allocation's
compare-and-swap), the emitter profile/establishment/activities, and the signing
material behind the credential port.

- **A. A new workspace package, `@newsaas/fiscal-persistence` (recommended).**
  The Prisma-backed implementations of the ports `packages/fiscal` already
  declares — the same shape `packages/storage` uses, where the package owns the
  port and a driver lives beside it. The API's store **moves** there, its tests
  follow, and both apps consume one implementation. `packages/fiscal` keeps
  depending on neither Prisma nor the database package.
- **B. A worker-local copy.** Smaller today, and rejected: the range store is a
  **counter claimed by compare-and-swap**, and two copies of that SQL can drift
  while only the API's copy is covered by the live-PostgreSQL suite. A drifted
  counter loses numbers or hands the same one twice, and §6.5 makes a consumed
  number permanent.
- **C. Inside `packages/database`.** Rejected: that package is the Prisma
  client, the schema and the migrations, and it is domain-free. Putting fiscal
  reads there would make the database package know what a timbrado is.

**Recommendation: A.**

## Q2 — Who builds the QR, and where does the CSC live?

- **A. FISC-012 builds it, from §13.8 (recommended).** The composition is now
  pinned: the consultation URL, nine parameters with their lengths, the "fill
  with 0" rule, the hexadecimal conversion of `dFeEmiDE` and `DigestValue`, the
  SHA-256 hash, the `&cHashQR` parameter, and the XML escaping. It is built
  **after signing** (it needs the signature's digest), which is why `gCamFuFD`
  sits outside the signed subtree — so the builder gains a **QR placeholder**
  and the stage fills it, exactly as `SIGNATURE_PLACEHOLDER` works today. **The
  CSC is per-tenant secret material**, not a constant: §13.8.4.2 appends it only
  to compute the hash, and §13.8.3/§13.8.4 say twice that it must never be
  shared or sent in the URL. It lives in the `SecretStore`, beside the signing
  key.
- **B. `qrContent` stays a caller input and the QR is deferred.** Rejected: the
  XSD requires `dCarQR` (100–600 characters), so a DE cannot be built without it
  — the worker's document stage would be blocked on a constant, and the source
  for it is now in hand.

**Recommendation: A.**

## Q3 — What does the sweep do with a `0360` answer?

FISC-010's mapping sends `0360` ("número de lote inexistente") to
`CONFIGURATION_ERROR`, which the worker turns into an `ERROR` row the sweep
re-drives. FISC-010 left open whether that re-drive is right, because the Guide
warns against resending a CDC that is still processing.

- **A. Keep the mapping and the re-drive (recommended).** `0360` says the **lot
  does not exist** — SIFEN never took it, so the documents inside it are not in
  SIFEN either. That is the same statement as the CDC query's `0420` ("the DE
  does not exist"), which the Guide answers with _"se debe volver a enviar el DE
  para su procesamiento"_. The blocking rules are about a document **still
  processing** (`0361`) and about duplicate sends inside that window — neither
  of which is this case.
- **B. The sweep leaves a `0360` row `SUBMITTED` for an operator.** Rejected: it
  turns a defined answer into a stuck row and moves work the Guide assigns to
  the client onto a human.

**Recommendation: A**, with the guardrail that makes it safe: **a `PROCESSING`
answer never triggers a resubmission.** The row stays `SUBMITTED`, only the
query is repeated, and `retryAfterMs` bounds the next attempt.

## Q4 — The reconciliation's cadence and its clock

[[ADR-007]] §5 already decided the mechanism: the TD-028 sweep, extended to
`SUBMITTED`, with `last_attempt_at` as the clock. This document adds only what
the reconnaissance found missing: the sweep's **own** stale threshold (five
minutes) is shorter than the Guide's ten-minute polling recommendation, so the
`SUBMITTED` branch uses the protocol's interval —
`SIFEN_BATCH_POLL_INTERVAL_MS`, already a constant in `packages/fiscal` — rather
than the recovery default, and `attempt_count` keeps counting **submissions**,
never queries.

## The proposed FISC-012 scope, if the recommendations are accepted

```text
WU-A  docs-only: ADR-009, ADR-010, this decision, the Story, baseline §24
WU-B  @newsaas/fiscal-persistence: the range store moved, the profile read,
      the credential read (Prisma + SecretStore), and the live-PostgreSQL
      proof that the moved store still claims correctly
WU-C  the QR: buildQrContent (pure, table-driven against §13.8.4's worked
      example) plus the builder's placeholder and the fill step
WU-D  the worker's document stage: QUEUED -> SIGNING -> SENDING, the
      build -> sign -> QR -> validate -> store chain, DTE_XSD_DIR, the
      fiscal storage prefix, and the credential read serving both uses
WU-E  SifenDirectFiscalProvider: issue/query/cancel over the facade, the
      sync/batch strategy, FISCAL_PROVIDER selection with the production
      refusal kept, and null credential -> CONFIGURATION_ERROR
WU-F  the reconciliation: the sweep walking SUBMITTED, calling query,
      applying terminal resolutions and leaving PROCESSING alone
```

## Consequences if accepted

- **The API's range store moves**, so its unit test and the live-PostgreSQL
  suite change imports — mechanical, and the live proof follows the
  implementation to where it now lives.
- **The worker gains two dependencies** it does not have:
  `@newsaas/secret-store` and (transitively, through `packages/fiscal`)
  `libxmljs2`, plus the `SECRET_STORE_*` and `DTE_XSD_DIR` env entries with
  their boot validation.
- **`FiscalIssueRequest` changes**, which is [[ADR-009]]'s decision and not this
  one: two construction sites and the fake's flag.
- **A `SIGNING` claim becomes real**, which is the first code to use the state
  FISC-009 added, and the transition guard already admits every edge it needs.
- **`0360` stays a re-drivable error**, with `PROCESSING` as the one answer that
  never resubmits — asserted, not left to reading.
- **FISC-013 inherits**: the homologation run, the CSC's real value from SIFEN,
  and the `DTE_XSD_DIR` deployment step.

## Status

**Accepted 2026-10-08** at the maintainer's instruction to start FISC-012 with
the recommendations above. The two ADRs it points at carry the boundary changes;
this document carries the scope.
