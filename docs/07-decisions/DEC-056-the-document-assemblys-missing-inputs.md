---
id: DEC-056
type: decision
title:
  The document assembly's missing inputs — what a DE needs that the tenant's
  data does not model
status: proposed
date: 2026-10-08
related_epics:
  - EPIC-16
related_stories:
  - FISC-012
  - FISC-011
  - FISC-013
prd_change_required: false
---

# DEC-056 — the document assembly's missing inputs

## Context

[[FISC-012]]'s WU-D is the worker's document stage: build the DE, sign it, fill
its QR, store it, validate it against the official XSD, and hand it to the
provider. Its acceptance criteria assume the stage can **build a document from
the tenant's rows**. A read-only reconnaissance on 2026-10-08 — one mapping pass
over `main` + WU-A..WU-C, with the decisive claim verified independently — found
that the assembly's _inputs_ are largely unmodelled. The stage cannot be built
as written without inventing product data or guessing fiscal classifications.

### The six inputs that do not exist

1. **The fiscal number's provenance, and its link to a range.**
   `allocateDocumentNumber` ([[FISC-011]]) has **no production caller**: the
   only non-test occurrences are `packages/fiscal/src/timbrado/allocation.ts`
   itself, its export, a comment at
   `apps/api/src/fiscal/timbrado/timbrado.service.ts:125` and the
   live-PostgreSQL suite. `Invoice.number` comes from `allocateNumber` over
   `invoice_number_sequence` (`apps/api/src/billing/billing.service.ts:612`,
   `apps/api/src/billing/billing.repository.ts:402-419`). Neither `Invoice`
   (`packages/database/prisma/schema.prisma:2342-2387`) nor `FiscalDocument`
   (`:2547-2605`) carries `establishmentId`, `expeditionPoint`, `documentType`,
   `timbradoNumber` or `rangeId`, so **nothing links a confirmed invoice to the
   range that authorises its number** — and the `TimbradoRangeKey`
   `allocateDocumentNumber` needs
   (`packages/fiscal/src/timbrado/allocation.ts:97-104`) cannot be reconstructed
   from a confirmed invoice. FISC-011's own story records the intent: "The
   allocation is deliberately not a route. It is a service method [[FISC-012]]
   calls while building a DE"
   (`docs/02-stories/FISC-011-timbrado-and-numbering.md:232-234`).
2. **The receptor.** `DteReceptor` declares 24 fields
   (`packages/fiscal/src/dte/dte.types.ts:213-248`); `Customer` has eight
   (`schema.prisma:666-680`), and **nothing maps them** — a grep for
   `DteReceptor|dRucRec|iNatRec|dDVRec` across `apps/api/src` returns nothing.
   Absent: `iTiOpe`, `cPaisRec`/`dDesPaisRe`, `iTipIDRec`/`dDTipIDRec`,
   `iTiContRec`, `dCodCliente`. Derivable: `iNatRec` from `Customer.kind`,
   `dDVRec` from the RUC (a módulo-11 helper exists,
   `packages/fiscal/src/dte/dte.cdc.ts:90`). `Invoice.customerId` is nullable
   (`schema.prisma:2350`), so a walk-in invoice has no receptor at all.
3. **The line's fiscal classification.** `InvoiceLine.rateCode`
   (`schema.prisma:2433`) is the only fiscal datum on a line, and the mapper
   refuses to invent the rest: "It does not invent an affectation"
   (`packages/fiscal/src/dte/dte.mapper.ts:27-30`) — `E731 iAfecIVA` and
   `E734 ivaRate` are caller-supplied. Nothing maps a rate code to either.
4. **The unit of measure.** `cUniMed`/`dDesUniMed` have no source: `CatalogItem`
   has no unit column (`schema.prisma:1305-1367`), and only the fixture carries
   one (`packages/fiscal/src/dte/dte.fixture.ts:149-150`).
5. **The currency description.** `dDesMoneOpe` has no source
   (`packages/fiscal/src/dte/dte.mapper.ts:100-101`); only a fixture literal
   exists (`dte.fixture.ts:116`). This one is the cheapest to close: the
   protocol's own currency list is a table, not tenant data.
6. **The CSC.** Unmodelled as storage: no column, no secret reference, no
   setting. [[DEC-055]] Q2 decided it _should_ be per-tenant secret material
   (`docs/07-decisions/DEC-055-fisc-012-scope-adapters-qr-and-reconciliation.md:66-75`)
   and nothing models it; the QR builder takes it as an input
   (`packages/fiscal/src/dte/dte.qr.ts:87-90`).

### Three wiring gaps that _are_ implementable today

7. **`SIFEN_ENVIRONMENT` is never parsed.** It appears in [[ADR-008]] and in
   comments (`packages/fiscal/src/sifen/sifen.transport.ts:79-90`), but no code
   reads it, and `apps/worker/src/config/worker-env.schema.ts:10-37` has neither
   it nor `DTE_XSD_DIR`. The API's signing-material service takes the
   environment from its caller
   (`apps/api/src/fiscal/signing-material/signing-material.service.ts:161-165`).
8. **No fiscal storage prefix and no `xml_storage_key` writer.**
   `packages/storage/src/storage-keys.ts:18-21` defines only `brand`;
   `FiscalDocument.xmlStorageKey` (`schema.prisma:2568`) has no writer and no
   reader anywhere in the repository.
9. **The XSD gate compiles per call**, while WU-D's criteria require once per
   process (`packages/fiscal/src/dte/xsd-validator.ts:63-84` — no memoisation) —
   and `libxmljs2` is a **devDependency** although the validator imports it at
   runtime (`packages/fiscal/package.json`), so [[ADR-010]]'s promotion to a
   runtime dependency was never made.

### What this blocks

WU-D's criteria are, in effect, criteria about a document. Four of the six are
satisfiable **with no assembly at all** — the claim, the credential, the store's
order and the gate are properties of the stage, not of the data. The assembly is
the part that needs product decisions, and it is the part that cannot be
improvised: a guessed `iAfecIVA` is a tax-treatment statement, a guessed
receptor is a document SIFEN rejects, and a guessed range key emits a
`dEst`/`dPunExp` the emitter is not authorised for.

## Question

Two questions, in order, because the second depends on the first.

**1. Where is the document's fiscal number allocated?**

- **At invoice confirmation**, from the timbrado range, inside the confirmation
  transaction, persisting the range's identity with the invoice — so a confirmed
  invoice carries one authorised number, and the stage reads it.
- **At issuance**, in the worker, as FISC-011's story records the intent — so
  the invoice's own number stays a Billing counter and the DE's `dNumDoc` is a
  second number minted later.

**2. What is FISC-012's scope now?**

## Options

### Option A — narrow WU-D to the stage's plumbing, and give the assembly its own story

WU-D implements the four properties that are its own: the
`QUEUED -> SIGNING -> SENDING` claim with the abandoned-claim recovery, the
`requiresSignedDocument` port surface with its branch, the credential wiring
(`@newsaas/secret-store`, the env, WU-B's reader), and the document's custody —
the fiscal storage prefix, the store-then-validate order, the `xml_storage_key`
writer, the XSD gate with its per-process compile and `libxmljs2` promoted to a
runtime dependency. The assembly sits behind an injected seam that **fails
closed** with a named reason, so every criterion is testable with a fake
builder.

The assembly — the six inputs above, their migrations and the numbering decision
— becomes a new story with its own decisions.

- **Impact**: FISC-012 closes without a real submission; the epic's outcome
  moves by one story.
- **Cost**: the smallest; no schema change; nothing guessed.
- **Risk**: the seam's shape is chosen before the assembly exists, so it may
  need one adjustment when the assembly lands.

### Option B — grow FISC-012 to include the assembly

WU-D splits into D1 (the plumbing, as in A) and D2 (the assembly): the
migrations for the CSC's reference, the unit of measure, the line's
classification and the receptor's fiscal fields; the protocol-derived mappings
(the currency description, the IVA rate from the rate code, the DV from the
RUC); and the tenant policy that selects the issuance key.

- **Impact**: reaches the epic's outcome inside FISC-012.
- **Cost**: two to three more work units, at least four tables touched, one
  migration each, and the numbering decision must land **first** because it
  decides whether `dNumDoc` is the invoice's number or a new one.
- **Risk**: the fiscal classifications (which affectation a rate code means,
  whether a 0% rate is _exento_ or _exonerado_) are product statements. Deciding
  them inside an implementation work unit is what the scope-control rule
  forbids.

### Option C — stop FISC-012 after WU-C and re-scope the epic

Option A's code, plus rewriting the epic's criteria and creating the new story
before any further work.

- **Impact**: the same code as A, with the epic's closure (FISC-014) naming the
  new story explicitly.
- **Cost**: the most documentation churn for the same result.

## Recommendation

**Option A**, with the numbering decision recorded in this same document and the
new story drafted in the same move.

The six inputs are product data. What a receptor's operation type is, what a 0%
rate means, which establishment issues, and where the CSC lives are statements
about the business — and three of them (`iAfecIVA`, the receptor's identity, the
range key) are the difference between a document SIFEN accepts and one it
rejects or, worse, one it accepts while misstating the tax treatment. None of
them should be decided by an agent inside a work unit that is nominally about a
state machine.

Option A also leaves the stage's plumbing genuinely finished rather than
half-built on guesses: the claim, the credential, the custody and the gate are
all real and testable today, and the assembly plugs into a seam that is already
exercised by the fake.

**And the numbering, recommended: at invoice confirmation.** Three reasons, in
order of weight:

1. **A fiscal document's number must be authorised before it is printed.** An
   invoice is confirmed and handed to the customer; a number minted later, in a
   background worker, would leave the printed document carrying a number the
   timbrado does not authorise.
2. **A number allocated at issuance is burned by every failed attempt.** The
   allocator is monotonic and never reissues by design
   (`docs/02-stories/FISC-011-timbrado-and-numbering.md:144-159`), so a
   submission that fails, retries or is abandoned leaves a hole in the range —
   and SIFEN's own rules treat a skipped number as a finding.
3. **The reconciliation needs a stable identity before submission.** The CDC is
   built from the number; a number that changes between attempts produces two
   CDCs for one invoice, which is exactly the duplicate-send case the protocol
   punishes (`0360`).

Allocating at confirmation also closes the link the stage needs: the range's
identity is written where the allocation happened, so the worker reads it
instead of reconstructing it.

## Impact

### Product

- FISC-012's outcome ("the worker submits a real document") moves to the new
  story under Option A; the epic's closure must name it.
- The invoice's printed number becomes the fiscal number, which is what a
  customer and the tax authority both expect to match.

### Architecture

- No new service, no new store, no new dependency beyond the one ADR-010 already
  approved (`libxmljs2` as a runtime dependency of `packages/fiscal`).
- The worker gains a seam between "the stage" and "the assembly", which is where
  the next story's work lands.
- `packages/fiscal` stays Prisma-free: the assembly reads through
  `@newsaas/fiscal-persistence`, where WU-B's readers already live.

### Database/API

- Option A: **no migration**. The stage's custody needs no new column
  (`xml_storage_key` exists).
- Option B or the new story: migrations for the CSC's reference, the unit of
  measure, the line's classification and the receptor's fiscal fields; and, if
  the numbering moves to confirmation, a column carrying the range's identity
  beside the invoice or the fiscal document, written inside the existing
  confirmation transaction.
- Either way the API's confirmation path is Billing's territory, not the
  worker's.

### Delivery

- Option A keeps FISC-012's branch shippable at WU-D: the worker's stage is
  complete for every provider that does not require a signed document, and fails
  closed with a named reason for the one that does.
- The new story inherits FISC-013's homologation run, the CSC's real value and
  the `DTE_XSD_DIR` deployment step.

## Decision

_Pending. The maintainer decides: the numbering's allocation point, and whether
the assembly lands as a new story (A) or inside FISC-012 (B)._

## PRD Update

No. This document records a gap and a scope question; it changes no approved
product scope, and an accepted decision here would change the _plan_, not the
product's intent.

## What this document does not do

It does not touch the schema, the Billing confirmation path, the worker or
`packages/fiscal`. WU-D's implementation is stopped at the point where the
assembly begins, and the reconnaissance that produced this document is recorded
in `odd/tasks/fisc-012-sifen-direct-provider.md`.
