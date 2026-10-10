---
id: ADR-009
type: adr
title: The port's request carries the signed document
status: accepted
date: 2026-10-08
supersedes: []
superseded_by:
related_epics:
  - EPIC-16
related_decisions:
  - DEC-046
  - DEC-048
  - DEC-054
related_stories:
  - FISC-012
  - FISC-008
  - FISC-009
approval_record:
  decision_proposal: none
  decision_status: accepted
  decision_approval_date: 2026-10-08
  adr_gate_authority:
    docs/99-governance/DOCUMENTATION-RULES.md "change Fiscal Provider boundary",
    plus the epic's requirement that the port's shape be decided before the
    Story that consumes it
  adr_acceptance_basis:
    authored in FISC-012's WU-A at the maintainer's instruction of 2026-10-08,
    which also fixed the boundary between the worker (builds, signs, persists)
    and the provider (submits)
---

# ADR-009 — The port's request carries the signed document

## Decision Summary

A SIFEN provider submits a **signed DE**. The port's `issue` request carries
invoice data — series, number, currency, lines, totals — and no document at all,
because the port was designed while a fake stood in for the provider. Something
has to close that gap, and the provider cannot: building a DE needs the emitter
profile, the timbrado and the allocation, which live in **PostgreSQL**, and
`packages/fiscal` deliberately depends on neither Prisma nor
`@newsaas/database`.

So the **caller** builds the document and the request carries it:

1. **`FiscalIssueRequest` gains `document: FiscalIssueDocument | null`**, where
   `FiscalIssueDocument` is `{ cdc, signedXml }` — the document's identity and
   the document as it was **signed**.
2. **The port gains one capability flag, `requiresSignedDocument: boolean`**, so
   the caller knows whether to build one. The fake declares `false`; a SIFEN
   provider declares `true`.
3. **A provider that requires a document and receives `null` answers
   `CONFIGURATION_ERROR`** with a reason naming the contract violation — never a
   crash, and never a silent skip.

**What this ADR deliberately does not do**: it does not make the port know what
a DE _is_. The request carries bytes and an identity; the adapter is the only
thing that knows they are a `rDE` document, and the port still carries no SIFEN
constant (ADR-007 §6).

## Context

`FiscalIssueRequest` (FISC-003, EPIC-15) is:

```ts
export interface FiscalIssueRequest {
  readonly fiscalDocumentId: string;
  readonly tenantId: string;
  readonly provider: FiscalProviderId;
  readonly invoice: { series; number; currency; issuedAt };
  readonly lines: readonly FiscalIssueLine[];
  readonly totals: { taxableBase; taxAmount; total };
}
```

Every field is invoice data. The fake ignores the request entirely, which is why
the gap stayed invisible for two epics — and why [[FISC-009]] had to record, as
a moved acceptance criterion, that _"the worker does not build a DE at all
today: it hands invoice data to the port and the fake provides."_

**Why the provider cannot build it.** The chain is
`assembleEmitterProfile(stored profile, establishment, activities, range, allocated)`
→ `buildDteRequestFromInvoice(invoice, profile, identity, qrContent)` →
`buildDteXml` → `signDteXml`. The first step reads four tenant-scoped tables and
the allocation is a transactional compare-and-swap against
`fiscal_timbrado_range`. That is the worker's database access, not the boundary
package's.

**Why the persistence forces the same answer.** `xml_storage_key` exists and is
written by nothing; FISC-009 assigned "where the document is persisted" to
submission. The document must be **stored by the caller** — a provider that
built it internally could not hand it back for storage without a second
capability, and a document that is submitted but not stored is a document this
system cannot reproduce when SIFEN asks about it.

**Why the `SIGNING` state forces it too.** `fiscal_document_status` gained
`SIGNING` in FISC-009 with the graph `QUEUED -> SIGNING -> SENDING`, and **no
code claims it**: the handler goes straight to `SENDING`. The state exists to
hold the document while it is built and signed, which is the worker's stage. A
provider that signed internally would make the state's subject the provider's
private business, and the state would stay unclaimed.

## Why an ADR is Required

`DOCUMENTATION-RULES.md` names "change Fiscal Provider boundary" as an ADR case,
and this changes the boundary's request contract in a way every provider must
honour: a provider that needs a document must be able to say so, and one that
receives `null` must fail in a defined way. The epic also requires the shape to
be decided **before** the Story that consumes it — the same ordering ADR-007
records for the asynchronous capability.

## Decision

### 1. The document

```ts
/** The document a caller built and signed, as the provider will submit it. */
export interface FiscalIssueDocument {
  /** The DE's `Id`: the CDC, the signature's reference and the QR's `Id`. */
  readonly cdc: string;
  /** The document exactly as it was signed. Never re-serialized. */
  readonly signedXml: string;
}
```

`cdc` is not decoration. It is the value the signature references (`#<cdc>`),
the value the QR carries as `Id`, and the value SIFEN's own recovery rule asks
with when a hand-over answer is lost (ADR-007 §2). Carrying it beside the bytes
lets a provider log, query and reconcile without parsing the document.

**The bytes are passed through unchanged.** The signed bytes are what SIFEN
validates; a provider that re-serialized them would invalidate the signature it
was handed.

### 2. The capability flag

```ts
export interface FiscalProviderPort {
  readonly provider: FiscalProviderId;
  /** Whether this provider needs the caller's built document to issue. */
  readonly requiresSignedDocument: boolean;
  issue(request: FiscalIssueRequest): Promise<FiscalIssueResult>;
  query(request: FiscalQueryRequest): Promise<FiscalQueryResult>;
  cancel(request: FiscalCancelRequest): Promise<FiscalCancelResult>;
}
```

**The flag is why this is a decision and not a field.** The alternative is the
worker branching on `document.provider === "SIFEN_DIRECT"`, which is exactly
what the port exists to prevent: consumers "depend on the port, never a concrete
implementation". A capability the port declares is testable, and a new provider
must answer it explicitly instead of inheriting an assumption.

`FakeFiscalProvider.requiresSignedDocument` is `false`: the fake models a
provider that takes invoice data, and a demo tenant without an emitter profile
must stay issuable in development. A SIFEN provider is `true`.

### 3. The rule for a missing document

A provider whose flag is `true` and whose request carries `document: null`
returns `outcome: "CONFIGURATION_ERROR"` with a reason naming the violation. It
does **not** throw: `CONFIGURATION_ERROR` is already terminal and non-retryable
(DEC-049), so the row lands in `ERROR` with a message an operator can read,
which is the honest outcome for a caller that skipped a required stage.

### 4. What the caller must do

The worker's document stage, in order:

```text
claim    QUEUED -> SIGNING        (the state FISC-009 added and nothing claims)
build    the emitter profile, the allocation, the CDC, the security code
emit     buildDteXml -> signDteXml
qr       build the QR from the signature's digest and fill its placeholder
validate the signed document against the official XSD (ADR-010)
store    the signed XML, and write xml_storage_key
submit   SIGNING -> SENDING, then provider.issue(request with the document)
```

**It builds the document only when `requiresSignedDocument` is `true`.** For the
fake the stage is a pass-through, which keeps the fake's path free of the fiscal
profile and keeps the demo tenant working.

## Alternatives Considered

### The provider builds the document

Rejected, and it is the alternative that looks cleanest on paper: the builder
and the signer are pure functions that already live in `packages/fiscal`, and
the provider already reads the credential. It fails on three facts. **The data
is in PostgreSQL** — the emitter profile, the establishment, the activities and
the timbrado range are tenant rows, and `packages/fiscal` depends on neither
Prisma nor the database package. **The persistence needs the document in the
caller's hands**, or a second capability to hand it back. And **the `SIGNING`
state would lose its subject**: the state exists to hold the document while it
is built, and the state machine is the database's, not the adapter's.

### A document port injected into the provider

Considered: a `FiscalDocumentSource` port the provider reads per call, like
`FiscalCredentialPort`, which would leave the request untouched. Rejected
because it hides the dependency — a provider that cannot work without a document
would declare nothing and fail at call time — and because it adds a port, a
storage read and a second failure mode to avoid one field in a request that
already exists.

### A required (non-null) `document`

Rejected. It would force every submission through the whole document pipeline,
so a tenant without an emitter profile — the demo tenant, and every integration
test that scripts the fake — would stop being issuable in development. The
document is required by _some_ providers, which is what the flag expresses.

### A second method, `issueDocument(document)`

Rejected. It splits one capability in two: a caller would have to choose the
method by provider, which is the same branch the flag removes, and the fake
would have to implement a method it cannot honour meaningfully.

## Consequences

### Positive

- **The worker owns the pipeline and the provider is a transport adapter.** The
  `SIGNING` state has a subject, the persistence happens before the hand-off,
  and a crash after signing keeps the document on the row instead of losing it.
- **The port stays provider-agnostic.** It gains bytes, an identity and one
  boolean — no SIFEN constant, no document vocabulary.
- **The fake path is untouched in substance.** A demo tenant keeps issuing
  without a fiscal profile.

### Negative

- **The request grows and every construction site changes**: one production site
  (`fiscal-submission.handler.ts`) and one test literal
  (`fake-fiscal.provider.test.ts`). Small, and measured before the decision.
- **`requiresSignedDocument` is a new obligation on every provider.** A provider
  that forgets it does not compile, which is the intended failure mode.
- **The request now carries document bytes**, so the _snapshot_ rule matters:
  the sanitized `providerRequest` is a record of what the provider was asked,
  and a provider that echoes a whole DE into it would store the document twice.
  The adapter's snapshot is a descriptor (the CDC, the envelope kind, the byte
  count), not the document — recorded in the Story.

## Migration / Rollout

Additive and mechanical: `FiscalIssueRequest.document` is nullable, the flag is
a new required member of the port (the fake and the future SIFEN provider both
declare it), and the worker's stage builds the document only when the flag is
`true`. No data migration. The `SIGNING` claim is a worker change with the
transition guard already in place since FISC-009.

## Guardrails

1. **The signed bytes pass through unchanged.** A test asserts the provider
   receives byte-identical XML to what the caller signed, and that the signature
   still verifies after the round trip through the request.
2. **`requiresSignedDocument` is honoured, not assumed.** A test asserts the
   worker's stage does not read the fiscal profile when the provider's flag is
   `false`.
3. **A `null` document for a requiring provider is a `CONFIGURATION_ERROR`**,
   with a reason that names the violation, asserted for both outcomes: no throw,
   no submission attempt.
4. **The `cdc` in the document is the same value as the signature's reference
   and the QR's `Id`**, asserted in the stage's tests rather than by inspection.
5. **The port learns nothing about documents.** A test asserts the port's public
   surface carries no SIFEN or DE vocabulary beyond the two field names above.

## References

- `packages/fiscal/src/fiscal-provider.port.ts` — the request and the port this
  ADR extends.
- `docs/04-adrs/ADR-007-asynchronous-outcome-capability.md` — the same boundary,
  extended for outcomes; its §6 keeps the port free of provider constants.
- `docs/04-adrs/ADR-008-sifen-transport-mutual-tls-and-parser.md` — the
  transport and the credential port the worker will read the signing material
  through.
- `docs/07-decisions/DEC-054-wu-c-scope-emitter-profile-and-cdc.md` — the
  mapper's inputs and the profile's owner.
- `docs/02-stories/FISC-009-xmldsig-signing.md` — "Why this acceptance criterion
  moved", and the `SIGNING` state with no claim.
- `docs/02-stories/FISC-012-sifen-direct-provider.md` — the Story this gates.
