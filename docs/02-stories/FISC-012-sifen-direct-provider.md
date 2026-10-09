---
id: FISC-012
type: story
title:
  SifenDirectFiscalProvider — the worker builds, signs and submits a real DE
epic: EPIC-16
status: in-progress
priority: high
depends_on:
  - FISC-010
  - FISC-011
prd_sections:
  - "22"
  - "23"
permissions: []
branch: feat/epic-16-fisc-012-sifen-direct-provider
created: 2026-10-08
updated: 2026-10-08
---

# FISC-012 — `SifenDirectFiscalProvider`

## Objective

Replace the fake with the real provider, and make the **worker** submit a real
document: it builds the DE from the tenant's fiscal profile, signs it, builds
the QR, validates it against the official XSD, stores it, hands it to the
provider, and reconciles what SIFEN answers.

This is the Story where every earlier piece meets: [[FISC-007]]'s signing
material, [[FISC-008]]'s builder and schema gate, [[FISC-009]]'s signer and its
unclaimed `SIGNING` state, [[FISC-010]]'s web-service layer and asynchronous
capability, and [[FISC-011]]'s emitter profile, establishments and timbrado
ranges.

## Context

The epic's row for this Story: _"`SifenDirectFiscalProvider` behind the existing
port — it **implements** the asynchronous capability FISC-010 adds — provider
selection, **the worker's signing stage** moved from FISC-009, the worker's
credential wiring and the reconciliation stage."_

Three ADR/decision documents gate it, all written in WU-A:

- **[[ADR-009]]** — the port's request carries the **signed document**, and the
  port gains `requiresSignedDocument` so the caller builds one only for
  providers that need it.
- **[[ADR-010]]** — the **XSD gate runs before every submission**, not only in
  CI.
- **[[DEC-055]]** — the scope: the persistence adapters' home, the QR's
  ownership and the CSC's, and the reconciliation's rules.

**What exists**: the whole client (`packages/fiscal/src/sifen/**`: messages,
serializer, parser, transport, facade, outcome mapping), the pure builder,
signer, mapper, profile assembly and allocation, the tenant's fiscal tables, and
the port with its asynchronous vocabulary. **What does not**: any code that
reads a tenant's private key, any code that builds a DE, any writer of
`xml_storage_key`, any claimer of `SIGNING`, and any consumer of `query`.

## The contract, pinned

### The document chain

```text
stored rows            fiscal_emitter_profile (+ activities) · fiscal_establishment
                       · fiscal_timbrado_range
allocation             allocateDocumentNumber -> dNumDoc + series (FISC-011)
identity               composeCdc -> the CDC · generateSecurityCode -> dCodSeg
profile assembly       assembleEmitterProfile(stored, establishment, activities,
                       range, allocated) -> EmitterFiscalProfile
mapping                buildDteRequestFromInvoice(invoice, profile, identity,
                       signatureTimestamp, qrContent) -> DteRequest
xml                    buildDteXml(DteRequest) -> the DE with a signature placeholder
signature              signDteXml({ xml, privateKeyPem, certificatePem, cdc })
qr                     buildQrContent(...) from the signature's digest, then fill
                       the QR placeholder   <- the QR is built AFTER signing
validation             validateDeAgainstOfficialXsd(signedXml, DTE_XSD_DIR)
storage                StoragePort.put(signedXml) -> xml_storage_key
submission             the provider posts a lot of one and answers SUBMITTED
```

**The order is not a preference.** The QR carries the signature's `DigestValue`
as its own parameter and the CDC as its `Id` (§24), so it cannot exist before
the signature does — and that is why `gCamFuFD`, which holds `dCarQR`, sits
**outside** the signed `DE` subtree (baseline §4). The builder therefore emits a
QR placeholder the stage fills, exactly as it already emits
`SIGNATURE_PLACEHOLDER`.

### The QR, from §24

```text
URL         https://ekuatia.set.gov.py/consultas/qr?          (test: /consultas-test/qr?)
parameters  nVersion=150 & Id=<cdc> & dFeEmiDE=<hex> & dRucRec=<ruc>
            & dTotGralOpe=<n> & dTotIVA=<n> & cItems=<n> & DigestValue=<hex> & IdCSC=<id>
hash        SHA-256 over (the parameters + the CSC), hexadecimal
final URL   URL + parameters + "&cHashQR=" + hash, then every & escaped as &amp;
```

`dFeEmiDE` and `DigestValue` enter as the **hexadecimal of their bytes**;
`dTotGralOpe`/`dTotIVA` are `0` when absent; `cItems` counts `E701`. **The CSC
is appended only to compute the hash and never enters the URL** (§13.8.3,
§13.8.4.2).

### The credential

One read serves **two** uses, because one certificate does (baseline §6): the
`privateKeyPem` signs the document, and the same key with `certificatePem`
authenticates the mutual-TLS call.
`FiscalCredentialPort.read({ tenantId, environment })` is the boundary; the
worker implements it in WU-B, and
`FiscalProviderModule.forRoot({ credentialPort })` is how it reaches the
provider.

### The submission path: a lot of one

`issue` submits through the **batch** service with a **lot holding one
document**. The Manual's schema admits 1–50 `rDE` per lot, the Guide frames
document sending as "en lotes", and the batch is the path whose answer is
asynchronous — which is what [[ADR-007]]'s capability, the `SUBMITTED` state and
the reconciliation stage exist for. The synchronous reception service stays
available in the facade and **is not used by the adapter**; a single-document
fast path is a later decision, recorded rather than implied. A multi-document
lot is a later optimization: the container and the facade already take a list.

## In Scope

- **[[ADR-009]], [[ADR-010]] and [[DEC-055]]**, `SIFEN-BASELINE.md` §24, and
  this Story (WU-A).
- **`@newsaas/fiscal-persistence`** — the Prisma-backed ports: the timbrado
  range store (moved from the API), the emitter-profile read, and the credential
  read (WU-B).
- **The QR** — a pure builder in `packages/fiscal` and the builder's QR
  placeholder (WU-C).
- **The worker's document stage** — the `SIGNING` claim, the chain above, the
  storage write, and the runtime XSD gate (WU-D).
- **`SifenDirectFiscalProvider`** — the port over the facade, the selection, and
  the credential-failure mapping (WU-E).
- **The reconciliation** — the sweep walking `SUBMITTED` (WU-F).

## Out of Scope

- **Contingency handling and the homologation run** — [[FISC-013]]. Nothing here
  is proven against SIFEN; the CSC's real value and the habilitación are its
  inputs.
- **The signed v150 query family** — still blocked on the consultation request's
  signature profile ([[FISC-010]] §23.6/§23.8). The reconciliation resolves
  through the batch query, which is unsigned and published.
- **KuDE rendering**, the portal surface, reports, notifications.
- **A per-tenant `SIFEN_ENVIRONMENT`** — deployment-level until a product
  decision changes it ([[ADR-008]] §3).
- **A batching window** (accumulating documents into a multi-document lot).

## Acceptance Criteria

**WU-A — the decisions and the baseline**

- [ ] [[ADR-009]] is accepted and records the document-bearing request, the
      capability flag, and the rule for a missing document.
- [ ] [[ADR-010]] is accepted and records the runtime XSD gate, the dependency
      move, the deployment input and the fail-closed rule.
- [ ] [[DEC-055]] is accepted and records the adapters' home, the QR and the
      CSC, and the reconciliation's rules including the `0360` answer.
- [ ] `SIFEN-BASELINE.md` §24 records the QR composition with its retrieval
      record, the sign-then-QR ordering, the **three** Manual defects found, and
      the DE chain.

**WU-B — the persistence adapters**

- [x] `@newsaas/fiscal-persistence` exists, depends only on workspace packages,
      and `packages/fiscal` still depends on neither Prisma nor the database
      package. **Its second consumer is [[WU-D]]'s**: the worker's wiring is
      where "consumed by both apps" closes.
- [x] The timbrado range store has **one** implementation: the API's store moved
      verbatim (git records both files as 100% renames) and its tests followed,
      and the allocation's live-PostgreSQL proof passes with the store in its
      new home.
- [x] The credential read returns the four-field credential —
      `{ certificatePem, privateKeyPem, notBefore, notAfter }` — for the
      tenant's **active** material in the requested environment, and `null` when
      there is none, with the private key read from the `SecretStore` by
      `credentialRef` and never logged. Three states are distinguished: no
      ACTIVE row, an ACTIVE row whose secret is gone (fail closed) and a corrupt
      secret (the store's own typed error propagates).
- [x] A cross-tenant read returns `null`: the material's tenant is part of the
      query, not of the caller's context — asserted on the query the client
      receives.

**WU-C — the QR**

- [x] `buildQrContent` reproduces **§13.8.4's worked example byte for byte**,
      including its `cHashQR`, from that example's own inputs. Verified
      independently with `node:crypto` before the code was written, so the test
      pins a reproduced fact.
- [x] `dFeEmiDE` and `DigestValue` enter as the hexadecimal of their bytes (each
      with its own assertion), and `dTotGralOpe`/`dTotIVA` are `0` when absent.
- [x] The CSC is appended **only** to the hashed string and never appears in the
      returned URL — asserted on the output.
- [x] Every `&` in the URL is escaped as `&amp;` before it enters the XML: the
      escape belongs to the fill, because the value is born after the document
      is already serialized.
- [x] The builder carries a QR placeholder the stage fills — `QR_PLACEHOLDER`,
      exactly 100 characters so `buildDteXml`'s own 100..600 rule accepts it
      before a signature exists — and the filled document **still validates
      against the official XSD and still verifies its signature**
      (`xml-crypto`). The builder needed no edit: it emits `dCarQR` verbatim
      through `escapeXmlText`, which is the identity for a placeholder with no
      XML-special character.

**WU-D — the worker's document stage**

- [x] The worker claims `QUEUED -> SIGNING`, and `SIGNING -> SENDING` before the
      provider is called; a failure in the stage lands on `ERROR` with the
      reason and no secret in it. The re-claim of an abandoned row **keeps the
      observed status**, because the guard admits no `SENDING -> SIGNING`.
- [x] The document is built **only when `requiresSignedDocument` is true**: with
      the fake, the stage returns before touching the builder, the storage or
      the gate — asserted.
- [x] The signed XML is stored **before** the XSD gate runs, so a refused
      document is inspectable; `xml_storage_key` is never written for a document
      that was not stored, and a lost claim after a successful put submits
      nothing.
- [x] The XSD gate runs on the **signed** document before submission, fails
      closed when the directory is unusable, and compiles the schema **once per
      process** — cached per directory, a failed compile never cached as a
      success. _(One gap is recorded as an advisory: a re-claimed `SENDING` row
      resends the stored bytes without re-running the gate, where [[ADR-010]] §3
      says "before every submission". A WU-F follow-up, not a blocker.)_
- [ ] The credential read serves both the signature and the mutual-TLS call, and
      the worker refuses to build a document without one
      (`CONFIGURATION_ERROR`). **Half of this is WU-E's**: the port is wired and
      read per call (WU-D1) and the stage maps an unavailable document to
      `CONFIGURATION_ERROR` (WU-D2), while the read itself — the signing read in
      the assembly ([[FISC-015]]) and the mTLS read in the provider (WU-E) — is
      where the refusal becomes observable.
- [x] `SIGNING` is claimable after an abandoned claim, so a worker that dies
      while signing is recovered rather than stranded. **The recovery is job
      redelivery through the lease CAS**, not the sweep: the sweep still walks
      `QUEUED`/`ERROR`, and extending it to `SUBMITTED` is WU-F's.

> **Narrowed 2026-10-08 by [[DEC-056]].** A read-only reconnaissance found that
> the assembly's **inputs** are unmodelled — the invoice's link to its timbrado
> range, the receptor's fiscal identity, the line's `iAfecIVA`/`ivaRate`, the
> unit of measure, the currency description and the CSC's storage — so the stage
> cannot build a document without inventing product data. The criteria above
> split cleanly: the claim, the credential, the custody (store-then-validate)
> and the gate are properties of the **stage** and stay here; the assembly moves
> to [[FISC-015]] and sits behind a seam that fails closed with a named reason.
> The same decision moves the fiscal number's allocation to **invoice
> confirmation**, so a printed invoice carries a number a timbrado authorises.
> The reconnaissance is recorded in
> `odd/tasks/fisc-012-sifen-direct-provider.md`, the options and the decision in
> DEC-056.
>
> **Split into two slices.** **D1 landed as `0ca390a`**: the port's `document`
> field and `requiresSignedDocument` ([[ADR-009]]), the worker's own
> secret-store composition root, the `FISCAL_CREDENTIAL_PORT` provider, the env
> entries and `libxmljs2` promoted to a runtime dependency ([[ADR-010]]). **D2**
> carries the claim transitions, the seam and the custody — the
> store-then-validate order, the `xml_storage_key` writer and the XSD gate's
> per-process compile.

**WU-E — the provider**

- [ ] `SifenDirectFiscalProvider` implements the port: `issue`, `query`,
      `cancel`, and `requiresSignedDocument === true`.
- [ ] `issue` submits a lot of one, maps the hand-over answer through the
      outcome mapping, and answers `SUBMITTED` with the provider reference.
- [ ] A request with `document: null` answers `CONFIGURATION_ERROR` naming the
      violation — never a throw, never a submission.
- [ ] A `null` credential read answers `CONFIGURATION_ERROR` (terminal), and a
      transient transport failure answers `TRANSIENT_FAILURE` (retryable).
- [ ] `FISCAL_PROVIDER` accepts `SIFEN_DIRECT`, the fake stays selectable
      outside production, and **a production boot still refuses the fake**.
- [ ] The sanitized `providerRequest` snapshot is a descriptor — the CDC, the
      service, the byte count — **not the document**, asserted.

**WU-F — the reconciliation**

- [ ] The sweep walks `SUBMITTED` in addition to `QUEUED`/`ERROR`, bounded by
      `SIFEN_BATCH_POLL_INTERVAL_MS` rather than the recovery default.
- [ ] **A permanent failure does not loop.** The sweep's `ERROR` re-drive is
      bounded, so a schema refusal or a missing fiscal profile reaches an
      operator instead of being resubmitted forever — the mechanism is decided
      in this work unit, and the `QUEUED` path keeps its existing semantics.
- [ ] `PROCESSING` leaves the row `SUBMITTED` and **never** triggers a
      resubmission; `retryAfterMs` bounds the next attempt.
- [ ] A terminal resolution applies `APPROVED`/`REJECTED` with its identity and
      `resolvedAt`, and a failed query leaves the row `SUBMITTED`.
- [ ] `attempt_count` counts submissions, never queries.
- [ ] The `0360` answer keeps its mapping and the re-drive, with the
      `PROCESSING` guardrail asserted — [[DEC-055]] Q3's answer, in a test.

**Gates**

- [ ] Lint, typecheck, unit tests, the live-PostgreSQL gate and the build pass
      for `@newsaas/fiscal`, `@newsaas/database`, `@newsaas/api` and
      `@newsaas/worker`, and the root gates pass.
- [ ] No protocol constant is written without a cited source in §23 or §24.

## Domain Invariants

- **A consumed number is never reused** ([[FISC-011]]): the allocation is a
  compare-and-swap, and the document is signed with the number it claimed.
- **The signed bytes are never re-serialized.** The signature covers exactly the
  bytes that are submitted ([[ADR-009]]).
- **The QR is built after the signature** and never enters the signed subtree.
- **The CSC and the private key never leave their boundaries**: no log, no
  snapshot, no URL, no error message.
- **A schema violation is refused locally** and never submitted ([[ADR-010]]).
- **`PROCESSING` never resubmits.** The Guide's blocking rules punish duplicate
  sends, and the sweep only re-queries.
- **The worker never trusts a provider id to decide a capability**; it asks the
  port ([[ADR-009]]).

## API

```text
None. This Story adds no route. The provider and the stage run in the worker.
```

## Database

One migration at most: none is expected. The `SIGNING` state, the guard edges
(`QUEUED -> SIGNING -> SENDING`, `SIGNING -> ERROR`) and `provider_reference`
already exist. If the stage needs a claimable `SIGNING` recovery edge, it is
added by a **new** migration, never in place.

## UI

- None. The staff surface already renders the statuses, including `SIGNING` and
  `SUBMITTED`.

## Work units

| WU   | Scope                                                                                       | Depends on |
| ---- | ------------------------------------------------------------------------------------------- | ---------- |
| WU-A | ADR-009, ADR-010, DEC-055, this Story, baseline §24, tracker — docs only                    | —          |
| WU-B | `@newsaas/fiscal-persistence`: the range store moved, the profile read, the credential read | WU-A       |
| WU-C | `buildQrContent` and the QR placeholder                                                     | WU-A       |
| WU-D | The worker's `SIGNING` stage, storage and XSD gate                                          | WU-B, WU-C |
| WU-E | `SifenDirectFiscalProvider`, the selection, the failure mapping                             | WU-B, WU-D |
| WU-F | The reconciliation sweep                                                                    | WU-E       |

## Implementation Summary

**WU-A — the decisions, the Story and the baseline.** [[ADR-009]], [[ADR-010]]
and [[DEC-055]] accepted 2026-10-08, and `SIFEN-BASELINE.md` **§24** written
from a retrieval that **corrects §14**: the QR was graded open and is pinned by
the Manual's §13.8, which the earlier extraction had dropped. The finding that
shaped the rest of the Story: **the QR carries the signature's digest**, so the
build order is `sign -> qr -> fill`, and the builder needs a placeholder for it.

**WU-B, WU-C, WU-D, WU-E and WU-F are not implemented.** The Story's status
stays `in-progress`.

## Verification

```text
WU-A   docs only: no code, no migration, no schema, so no package test or live-PG
       gate applies. `pnpm format-check` green.
```

## Tests Added

```text
None yet. WU-A adds documents.
```

## Known Limitations

- **Nothing here is proven against SIFEN.** The CSC's real value comes from the
  habilitación, the certificate is a fixture, and the test host is behind an F5
  gate ([[FISC-013]]).
- **The CSC is per-tenant secret material whose value only SIFEN issues.** The
  code path is testable with a fixture; the real value is an operator input.
- **`DTE_XSD_DIR` is an operational requirement.** A deployment that does not
  provide the schemas cannot submit — fail-closed by decision ([[ADR-010]]).
- **One certificate serves both uses**, so rotating it invalidates in-flight
  submissions; [[FISC-007]]'s rotation semantics apply.
- **The synchronous reception service is implemented and unused by the
  adapter.** A single-document fast path is a later decision.
- **A lot holds one document.** A batching window is a later optimization.
- **The `0360` re-drive is a reasoned choice, not a proof** ([[DEC-055]] Q3): it
  reads SIFEN's answer as "the lot does not exist", which is the same statement
  as `0420`; only a real service can confirm the reading.

## Technical Debt

- **The `SUBMITTED` row has no lease of its own**; the reconciliation's clock is
  `last_attempt_at`, reused from the submission claim ([[ADR-007]] §5 records
  the reuse). If the two ever need different semantics, a column is the fix.
- **The XSD schemas are fetched, not vendored**, so a deployment's gate depends
  on a step that runs outside this repository ([[ADR-010]], [[FISC-008]]).
- **The unbounded re-drive is a property of the sweep, not of this Story.**
  [[ADR-010]]'s Consequences name it: a permanent failure becomes an `ERROR` row
  the sweep re-drives, and re-driving a document whose data is invalid refuses
  again. WU-F's criteria bound it; if the bound ends up being a _code list_
  rather than an attempt count, that list needs a source or it becomes the next
  guess.

## Decisions / ADRs

- **[[ADR-009]]** — the port's request carries the signed document. Accepted
  2026-10-08.
- **[[ADR-010]]** — the XSD gate runs before every submission. Accepted
  2026-10-08.
- **[[DEC-055]]** — the scope: the adapters, the QR, the reconciliation.

## Files / Modules

```text
docs/04-adrs/ADR-009-the-port-request-carries-the-signed-document.md
docs/04-adrs/ADR-010-the-runtime-xsd-gate-before-submission.md
docs/07-decisions/DEC-055-fisc-012-scope-adapters-qr-and-reconciliation.md
docs/06-fiscal/SIFEN-BASELINE.md          §24 is the QR's source of record
odd/tasks/fisc-012-sifen-direct-provider.md   the work-unit plan
```

and, for the WUs that follow:

```text
packages/fiscal-persistence/**            the Prisma-backed ports (new package)
packages/fiscal/src/dte/dte.qr.ts         the QR builder (new)
packages/fiscal/src/dte/dte.builder.ts    the QR placeholder
packages/fiscal/src/fiscal-provider.port.ts   the document and the flag
packages/fiscal/src/sifen/sifen.provider.ts   the provider (new)
apps/worker/src/fiscal-submission/**      the stage, the storage, the sweep
apps/worker/src/config/worker-env.schema.ts   SECRET_STORE_*, DTE_XSD_DIR
apps/api/src/fiscal/timbrado/**           the store moves out
```

## Completion Notes

_Status must remain non-`done` until every acceptance criterion and gate
passes._
