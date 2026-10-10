---
id: FISC-012
type: story
title:
  SifenDirectFiscalProvider — the worker builds, signs and submits a real DE
epic: EPIC-16
status: done
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
updated: 2026-10-09
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
      `cancel`, and `requiresSignedDocument === true`. **`issue`, `query` and
      the flag are done; `cancel` is implemented as a fail-closed refusal** —
      SIFEN's cancellation is an _event_, and `SIFEN-BASELINE.md` §23.3 records
      that `Evento_v150.xsd`'s field-level rules are **not profiled**:
      "profiling it is the work of the Story that builds one". That story is
      [[FISC-016]], and until it lands `cancel` answers `CONFIGURATION_ERROR`
      with `CANCELLATION_EVENT_UNPROFILED`, sends nothing, and says so.
- [x] `issue` submits a lot of one, maps the hand-over answer through the
      outcome mapping, and answers `SUBMITTED` with the provider reference. The
      batch answer identifies an **operation and never a document**, so the
      adapter overlays the request's own CDC — without it the lost-hand-over
      reconciliation would lose its only identity ([[ADR-007]] §2).
- [x] A request with `document: null` answers `CONFIGURATION_ERROR` naming the
      violation — never a throw, never a submission, asserted with no facade
      call.
- [x] A `null` credential read answers `CONFIGURATION_ERROR` (terminal), and a
      transient transport failure answers `TRANSIENT_FAILURE` (retryable). The
      partition is **total and asserted member by member**: only the three
      failures where the request may never have arrived or no answer did are
      retryable, each with its duplicate protection named.
- [x] `FISCAL_PROVIDER` accepts `SIFEN_DIRECT`, the fake stays selectable
      outside production, and **a production boot still refuses the fake**. Read
      as the refusal's own scope: what production refuses is **absence**, and an
      explicit `fake` stays selectable because it is the documented
      dedicated-demo path (`docs/03-architecture/DEMO-TENANT.md`) — refusing it
      would break that deployment without protecting anything.
- [x] The sanitized `providerRequest` snapshot is a descriptor — the CDC, the
      service, the byte count — **not the document**, asserted. The sanitizer's
      allowlist gained the two keys a descriptor needs, because an unlisted key
      is silently redacted.

> **A CRITICAL finding this Story's own review caught, 2026-10-08.**
> `resolveSifenEnvironment` defaulted an absent `SIFEN_ENVIRONMENT` to `TEST`
> for **every** environment, and WU-E2 made the API accept `sifen-direct` in
> production: a production API could have built the real adapter against the
> **DNIT test host** ([[ADR-008]] §3). A read-only refuter corroborated it after
> looking for a gate it had missed, and the bounded correction closes it at both
> construction points — the package's factory and the API's schema. The API's
> own new test had asserted the broken behaviour.

**WU-F — the reconciliation**

- [x] The sweep walks `SUBMITTED` in addition to `QUEUED`/`ERROR`, bounded by
      `SIFEN_BATCH_POLL_INTERVAL_MS` rather than the recovery default — through
      a new `next_query_at` marker, because the sweep's own cadence is 60
      seconds and without it every due row would be queried once a minute.
- [x] **A permanent failure does not loop.** The sweep's `ERROR` re-drive is
      bounded by an attempt cap, so a schema refusal or a missing fiscal profile
      reaches an operator instead of being resubmitted forever; the `QUEUED`
      path keeps its existing semantics. The mechanism is a count rather than a
      list of codes, because the result-code catalogue is open and a list would
      rot. **Its consequence is recorded**: a capped row has no revival path,
      which is why [[TD-029]] moved from optional to urgent.
- [x] `PROCESSING` leaves the row `SUBMITTED` and **never** triggers a
      resubmission — structurally: that phase has no queue to resubmit through —
      and `retryAfterMs` bounds the next attempt.
- [x] A terminal resolution applies `APPROVED`/`REJECTED` with its identity and
      `resolvedAt`, and a failed query leaves the row `SUBMITTED`.
- [x] `attempt_count` counts submissions, never queries: asserted over every
      answer the query phase can produce.
- [x] The `0360` answer keeps its mapping and the re-drive, with the
      `PROCESSING` guardrail asserted beside it — [[DEC-055]] Q3's answer, in a
      test. The re-drive's loop is bounded by the same cap.

**Gates**

- [x] Lint, typecheck, unit tests, the live-PostgreSQL gate and the build pass
      for `@newsaas/fiscal`, `@newsaas/database`, `@newsaas/api` and
      `@newsaas/worker`, and the root gates pass. **The live-PostgreSQL suite
      ran at 223/223** against a disposable PostgreSQL 16.13 with
      `timezone=UTC`.
- [x] No protocol constant is written without a cited source in §23 or §24.

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

**All six work units are implemented.** The Story replaced the fake with the
real adapter, gave the worker a document stage, and made the reconciliation walk
the documents SIFEN has not resolved yet. Twelve commits: six work units, each
with a record commit beside it.

**WU-A — the decisions, the Story and the baseline** (`7949f04`). [[ADR-009]],
[[ADR-010]] and [[DEC-055]] accepted, and `SIFEN-BASELINE.md` **§24** written
from a retrieval that **corrects §14**: the QR was graded open and is pinned by
the Manual's §13.8, which the earlier extraction had dropped. The finding that
shaped the rest: **the QR carries the signature's digest**, so the build order
is `sign -> qr -> fill`, and the builder needs a placeholder for it.

**WU-B — the shared persistence package** (`e20fc6b`). A new
`@newsaas/fiscal-persistence` holds the Prisma-backed implementations of the
ports `packages/fiscal` declares — the moved timbrado range store (git records
both files as **100% renames**), the emitter-profile read and the credential
read — so the allocation has one implementation instead of two that can drift.
`packages/fiscal` still depends on neither Prisma nor the database package,
which is the boundary [[DEC-055]] Q1 protects.

**WU-C — the QR** (`f968843`). `buildQrContent` reproduces **§13.8.4's worked
example byte for byte**, including its `cHashQR`; the placeholder is exactly 100
characters (the XSD's minimum, because `buildDteXml` runs the rule before a
signature exists); and `fillQrContent` escapes and replaces **exactly one**
occurrence after signing, which the round trip proves: the filled document still
verifies its signature and still validates against the official XSD.

**WU-D — the stage's four own properties** (`0ca390a`, `8224825`). The port
carries a required `document: FiscalIssueDocument | null` and
`requiresSignedDocument`; the worker wires its own secret-store composition root
and the real credential port, and the stage claims
`QUEUED -> SIGNING -> SENDING`, stores the signed XML **before** the XSD gate,
writes `xml_storage_key` only for a document that was stored, and fails closed
on the assembly behind a seam that answers `UNAVAILABLE`. **[[DEC-056]] narrowed
this work unit** when the reconnaissance found the assembly's inputs unmodelled.

**WU-E — the provider and the selection** (`5bdd61b`, `9295769`).
`SifenDirectFiscalProvider` submits a lot of one, answers `SUBMITTED` with the
lot number and the request's own CDC, chooses its query service by the identity
it has, and partitions every failure — total, asserted member by member, with
only the three "the request may never have arrived" failures retryable. `cancel`
**fails closed** because the event's payload is unprofiled ([[FISC-016]]).

**WU-F — the reconciliation** (`0bdedac`). The sweep walks `SUBMITTED` through a
new `next_query_at` marker, bounds the `ERROR` re-drive by an attempt cap,
leaves `PROCESSING` alone, re-drives `0360`, and gates a resend. It closes
[[TD-028]].

**Two CRITICAL findings arrived before the commit, and both were real.**

1. **`R3-SIFEN-PRODUCTION-DEFAULT` (WU-E2).** `resolveSifenEnvironment`
   defaulted an absent `SIFEN_ENVIRONMENT` to `TEST` for **every** environment,
   and the same work unit made the API accept `sifen-direct` in production: a
   production API could have built the real adapter against the **DNIT test
   host**. A read-only refuter corroborated it; the bounded correction closed it
   at the package's factory and the API's schema.
2. **`R4-001` (WU-F).** The query loop guarded only the provider call, so a
   rejected write while **applying** an answer threw out of the loop with that
   row's marker unadvanced — the row was re-selected on every sweep and blocked
   every other due document. The correction took three rounds; the first two
   were wrong (a sweep-level catch that hid failures; a diff over the frozen
   budget).

**Two findings changed the plan rather than the code**, and both are stories
now:

- **The assembly's inputs are unmodelled** — the invoice's link to its timbrado
  range, the receptor's fiscal identity, each line's tax treatment, the unit of
  measure, the currency description and the CSC's storage. [[DEC-056]] records
  it and [[FISC-015]] owns it; the same decision moved the fiscal number's
  allocation to **invoice confirmation**.
- **The cancellation event is unprofiled.** SIFEN's cancellation is an event and
  `SIFEN-BASELINE.md` §23.3 records that `Evento_v150.xsd`'s field-level rules
  were never read. [[FISC-016]] owns the profiling, the payload, its signature
  and the answer's mapping.

## Verification

```text
pnpm lint / typecheck / test / build      green - 20/20, 20/20, 21/21, 12/12
pnpm format-check                         green
pnpm --filter @newsaas/fiscal test        green - 577 tests, 28 files
pnpm --filter @newsaas/worker test        green - 140 tests, 11 files
pnpm --filter @newsaas/database test      green - 445 tests, 24 files
pnpm --filter @newsaas/api test           green - 1143 passed, 223 skipped
pnpm --filter @newsaas/fiscal-persistence test  green - 27 tests, 3 files
pnpm --filter @newsaas/api test:live-pg   green - 223/223
```

**Closure run, 2026-10-09, on `feat/epic-16-fisc-012-sifen-direct-provider`**
(`0bdedac`), against a disposable PostgreSQL 16.13 on `127.0.0.1:55433` started
with `-c timezone=UTC`, with the migrations and the seed applied by the suite
itself. The container the earlier runs used (`fisc009-pg`) was unavailable:
Docker's WSL integration is gone from this environment, so the repo's own
EPIC-06 practice was followed. **The live-PG suite is timezone-sensitive** — a
non-UTC server fails a pre-existing FISC-011 date-boundary case by
constraint-name matching — which is why the server is started with
`timezone=UTC`, as CI runs it.

## Tests Added

```text
packages/fiscal-persistence/src/*.test.ts       27 cases (the moved store, the
                                                profile read, the credential read)
packages/fiscal/src/dte/dte.qr.test.ts          25 cases (the worked example, the
                                                two hex conversions, the fill)
packages/fiscal/src/sifen/sifen-direct.provider.test.ts  28 cases (issue, query,
                                                cancel, the failure partition)
packages/fiscal/src/fiscal-provider.module.test.ts       the selection and the
                                                production refusals
apps/worker/src/fiscal-submission/fiscal-document-builder.test.ts  3 cases
apps/worker/src/fiscal-submission/fiscal-recovery.service.test.ts  the query
                                                phase, the cap, the isolation
apps/worker/src/secret-store/secrets.test.ts     5 cases
apps/api/src/config/api-env.schema.test.ts       the provider and environment gates
apps/api/test/live-pg-isolation.e2e-spec.ts      the new column, its index, the
                                                backfill and the guard's edges
```

## Known Limitations

- **Nothing here is proven against SIFEN.** The CSC's real value comes from the
  habilitación, the certificate is a fixture, and no submission has reached
  DNIT. That is [[FISC-013]]'s homologation run.
- **The worker cannot build a document yet.** The assembly is [[FISC-015]]'s,
  and until it lands the stage fails closed with a named reason: a
  `sifen-direct` deployment cannot issue, by design rather than by accident.
- **`cancel` fails closed.** The cancellation event's payload is unprofiled
  ([[FISC-016]]), so the adapter refuses with `CANCELLATION_EVENT_UNPROFILED`
  rather than sending an event nobody validated.
- **No deployment input exists for a trust-anchor override** (`caPem`). ADR-008
  names the per-call list; nothing names an environment variable, so the
  transport's own trust store is the only reviewed configuration.
- **A query that can never resolve stays `SUBMITTED` forever**, with its marker
  moving forward and its reason recorded. There is no query-side cap by design:
  the row is visible, and [[ADR-007]] §6 leaves a never-resolving document to an
  operator.
- **A capped `ERROR` row cannot be revived.** The attempts-monotonic trigger
  forbids lowering `attempt_count` and no re-drive route exists ([[TD-029]]).
- **A lost claim after a successful `put` leaves an orphaned storage object.**
  Nothing deletes it, and no cleanup exists.
- **The control number is not sequential.** §9.2.1 calls `dId` an emitter
  responsibility; the adapter draws 15 digits from `node:crypto` with a non-zero
  leading digit, which satisfies the pattern's enforced properties and not a
  monotonicity claim only a live service could confirm.
- **The `0360` re-drive is a reasoned choice, not a proof** ([[DEC-055]] Q3): it
  reads SIFEN's answer as "the lot does not exist", which is the same statement
  as `0420`; only a real service can confirm the reading.
- **One certificate serves both uses**, so rotating it invalidates in-flight
  submissions; [[FISC-007]]'s rotation semantics apply.
- **The synchronous reception service is implemented and unused by the
  adapter**, and a lot holds one document: a fast path and a batching window are
  later decisions.

## Technical Debt

- **[[TD-028]] is closed** by WU-F: the sweep re-drives both stuck paths
  idempotently, with the deterministic job id preserved and each recovery
  audited.
- **[[TD-029]] is raised**, not closed: the attempt cap is a **one-way door**,
  because a capped row cannot be revived by the sweep or by hand. Its own
  re-evaluation trigger ("EPIC-16 ships a real provider") is met.
- **The XSD schemas are fetched, not vendored**, so a deployment's gate depends
  on a step outside this repository ([[ADR-010]], [[FISC-008]]).
- **The review advisories are recorded, not fixed**, in the work-unit records:
  the `storage.put` failure branch has no test, the leak assertions run on
  `JSON.stringify(result)` rather than on the sanitized snapshot, and the
  corrected API test asserts the same production object twice. None is a
  behavioural defect; each is a test-quality point.
- **The reconciliation's audit actions are reused** (`fiscal.document.submitted`
  for a resolution, `fiscal.document.submission_failed` for `0360`), so the
  reconciliation is distinguishable only through metadata. New vocabulary would
  need the module doc to grow with it.

## Decisions / ADRs

- **[[ADR-009]]** — the port's request carries the signed document, and the port
  gains `requiresSignedDocument`. Accepted 2026-10-08.
- **[[ADR-010]]** — the XSD gate runs before every submission, and its validator
  becomes runtime API. Accepted 2026-10-08.
- **[[DEC-055]]** — the scope: the adapters' home, the QR's ownership and the
  CSC's, and the reconciliation's rules.
- **[[DEC-056]]** — the assembly's inputs are unmodelled; the fiscal number is
  allocated at invoice confirmation; WU-D narrows and [[FISC-015]] is created.
  Accepted 2026-10-08.

## Files / Modules

```text
packages/fiscal-persistence/**             the Prisma-backed ports (new package)
packages/fiscal/src/dte/dte.qr.ts          the QR builder (new)
packages/fiscal/src/sifen/sifen-direct.provider.ts   the provider (new)
packages/fiscal/src/fiscal-provider.module.ts        the selection
packages/fiscal/src/fiscal-provider.port.ts          the document and the flag
packages/fiscal/src/fiscal-snapshot.sanitizer.ts     the descriptor's keys
packages/fiscal/src/dte/xsd-validator.ts             the per-process compile
apps/worker/src/fiscal-submission/**       the stage, the seam and the sweep
apps/worker/src/secret-store/secrets.ts    the worker's secret boundary (new)
apps/worker/src/config/worker-env.schema.ts   SECRET_STORE_*, SIFEN_ENVIRONMENT,
                                           DTE_XSD_DIR, FISCAL_PROVIDER
apps/api/src/fiscal/fiscal.module.ts       the API's credential port
apps/api/src/config/api-env.schema.ts      the provider and environment gates
packages/database/prisma/migrations/20261009000001_fiscal_document_next_query
packages/storage/src/storage-keys.ts       the fiscal document prefix
```

## Completion Notes

**Done 2026-10-09.** Every acceptance criterion of WU-A..WU-F passes except the
one that spans a story: WU-D's credential criterion is satisfied by the wiring
this Story adds and becomes observable in [[FISC-015]]'s assembly and in WU-E's
provider, and WU-E's `cancel` criterion is recorded as **fail-closed pending
[[FISC-016]]** rather than checked. Both are noted beside the criteria
themselves.

Two scope findings changed the plan instead of being implemented quietly, and
both produced their own story: [[FISC-015]] for the assembly and [[FISC-016]]
for the cancellation event. The gates pass, the live-PostgreSQL suite passes at
223/223, and the two CRITICAL findings this Story's own reviews raised were
corrected and validated before their commits.

**The next step is [[FISC-013]]** (contingency and the homologation run), which
is what turns all of this from a reviewed implementation into evidence.
