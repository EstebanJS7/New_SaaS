---
id: FISC-009
type: story
title: XMLDSig signing of the DTE, and the return of the SIGNING state
epic: EPIC-16
status: in-progress
priority: high
depends_on:
  - FISC-007
  - FISC-008
prd_sections:
  - "23"
permissions: []
branch: feat/epic-16-fisc-009-xades-signing
created: 2026-10-07
updated: 2026-10-07
---

# FISC-009 — XMLDSig signing of the DTE, and the return of the `SIGNING` state

## Objective

Produce the `<ds:Signature>` that [[FISC-008]] leaves as a placeholder, using
the tenant's signing material from [[FISC-007]], and restore the **`SIGNING`**
lifecycle state that [[DEC-047]] deliberately omitted while a fake stood in for
the provider.

This Story signs. It does not submit ([[FISC-010]]), does not choose a provider
([[FISC-012]]) and does not render a KuDE.

## A correction to this vault's vocabulary

The PRD's §23, the epic, the changelog, [[FISC-007]], [[FISC-008]] and
`docs/05-modules/Fiscal.md` all say **"XAdES signing"**. **The cited standard is
not XAdES.** `XAdES`, `QualifyingProperties` and `SignedProperties` appear
**zero times** in the three official schemas, and the Manual's own synthesis
(§7.9) reads:

> "Firma **XML Digital Signature, Enveloped**, X.509 v3, clave privada RSA 2048,
> RSA, RFC5639, SHA-256"

The PRD is **not edited** — approved scope is not silently rewritten by an
implementation. **The implementation target is the profile below**, and the name
in the vault comes from the PRD's wording. The consequence is a constraint: a
library that emits XAdES qualifying properties would add signed content the
profile does not ask for.

## Context

`docs/06-fiscal/SIFEN-BASELINE.md` §5 pins the profile completely, from the
Manual's §7.6, §7.7 and Schema XML 1. [[ADR-006]] chooses the library that
implements it, and is the gate for this Story.

The material this Story consumes already exists: [[FISC-007]] stores the
tenant's PKCS#12 material behind a `SecretStore`, extracts the certificate and
the private key, and classifies both RESTRICTED.

## The contract, pinned

### The signature profile — baseline §5

```text
Standard                XML Digital Signature, Enveloped (W3C xmldsig-core)
CanonicalizationMethod  http://www.w3.org/TR/2001/REC-xml-c14n-20010315
SignatureMethod         http://www.w3.org/2001/04/xmldsig-more#rsa-sha256
Reference URI           #<CDC>       (the CDC preceded by "#")
Transforms (exactly 2, in order)
                        http://www.w3.org/2000/09/xmldsig#enveloped-signature
                        http://www.w3.org/2001/10/xml-exc-c14n#
DigestMethod            http://www.w3.org/2001/04/xmlenc#sha256
KeyInfo                 X509Data > X509Certificate   (X.509 v3)
Key size                RSA 2048 (software); RSA 2048 or 4096 (hardware)
Digest                  SHA-2 / SHA-256
Encoding                Base64
```

**The two transforms are ordered and there are exactly two.** The first is the
enveloped transform, which removes the signature from its own digest; the second
is exclusive canonicalization.

**The `Reference URI` is the CDC preceded by `#`**, and the signed subtree is
the group **`A001`** — the `DE` element, whose `Id` attribute is that same CDC.
This is why [[FISC-008]] puts the CDC on `DE/@Id`: the signature refers to it by
that value.

**Eight elements are forbidden in a signed DE**, because the certificate already
carries them:

```text
X509SubjectName  X509IssuerSerial  X509IssuerName  X509SKI
KeyValue         RSAKeyValue       Modulus         Exponent
```

**The canonicalization pair is unusual and must not be "normalised".**
`CanonicalizationMethod` is the **2001 inclusive** c14n, while the second
**transform** is **exclusive** c14n. A library default that makes both exclusive
would produce a document that verifies locally and is rejected by SIFEN.

### The lifecycle state — `SIGNING` returns

`docs/05-modules/Fiscal.md` records that `SIGNING` is **deliberately absent**
from `fiscal_document_status` because signing was a real-adapter concern
([[DEC-047]]). This Story is that adapter, so the state comes back:

```text
enum             fiscal_document_status gains SIGNING
graph            QUEUED -> SIGNING -> SENDING
                 SIGNING -> ERROR      (a signing failure, which is ours)
```

**`SIGNING` is a claim, like `SENDING`.** The worker holds it while it signs, so
`SIGNING -> CANCELLED` is excluded for the same reason `SENDING -> CANCELLED`
is: a worker may be mid-work. The existing guard function and its trigger
enforce the graph in the database, and the enum value is added by migration.

## In Scope

- The pure signing function:
  `(xml, certificate, private key, cdc) -> signed xml`, implementing the profile
  above, with the eight forbidden elements **refused**.
- The `SIGNING` state: the enum value, the migration, the transition-guard
  function, and the worker stage that claims it, signs, and moves on.
- Verification: the signed document **validates against the official XSD**
  through the gate [[FISC-008]] built, and a **sign-then-verify round trip**
  using the certificate's public key.
- [[ADR-006]], which gates this Story.

## Out of Scope

- **Any DNIT call** — [[FISC-010]]. This Story produces a signed document and
  stops.
- **Storing the signed XML.** `xml_storage_key` exists and is written by
  nothing; where the document is persisted belongs with submission.
- **The QR and the CSC** — the `dCarQR` content is an input here, as it is in
  [[FISC-008]].
- **KuDE rendering**, the portal surface, reports.
- **Timbrado and numbering ranges** — [[FISC-011]].
- **A real PSC certificate.** The tests use the material [[FISC-007]]'s fixture
  produces; a certificate from a PSC habilitado por el MIC is a homologation
  concern, [[FISC-013]].

## Acceptance Criteria

- [ ] The signature carries `CanonicalizationMethod` =
      `http://www.w3.org/TR/2001/REC-xml-c14n-20010315` — **inclusive**, not
      exclusive.
- [ ] The signature carries `SignatureMethod` =
      `http://www.w3.org/2001/04/xmldsig-more#rsa-sha256`.
- [ ] The `Reference` `URI` is `#` followed by the CDC, and the signed subtree
      is the `DE` element whose `Id` is that CDC.
- [ ] The `Reference` carries **exactly two** `Transform` elements, in this
      order: `http://www.w3.org/2000/09/xmldsig#enveloped-signature`, then
      `http://www.w3.org/2001/10/xml-exc-c14n#`.
- [ ] `DigestMethod` = `http://www.w3.org/2001/04/xmlenc#sha256`.
- [ ] `KeyInfo` carries `X509Data > X509Certificate` and nothing else, and the
      **eight forbidden elements are absent**; a signature that contains any of
      them is refused rather than emitted.
- [ ] The signature block is placed **between `</DE>` and `<gCamFuFD>`**, which
      is the position [[FISC-008]] leaves for it.
- [ ] The signed document **validates against the official XSD** in the CI job
      [[FISC-008]] built.
- [ ] A **sign-then-verify round trip** succeeds with the certificate's public
      key, and **fails** when the signed content is altered after signing.
- [ ] `fiscal_document_status` gains `SIGNING` by migration, and the transition
      guard admits `QUEUED -> SIGNING`, `SIGNING -> SENDING` and
      `SIGNING -> ERROR` while still rejecting `SIGNING -> CANCELLED`.
- [ ] The worker claims `SIGNING`, signs the document it built, and moves to
      `SENDING`; a signing failure moves it to `ERROR` with the reason recorded
      and no secret in the error.
- [ ] The signing function is **pure with respect to its inputs**: no ambient
      clock, no ambient tenant, no I/O.
- [ ] No secret appears in a log, an error, a returned value or a stored
      snapshot.
- [ ] Lint, typecheck, unit tests, the live-PostgreSQL gate and the build pass.

## Domain Invariants

- **No protocol constant without a cited official source.** Every algorithm URI
  above traces to baseline §5.
- **The profile is asserted, not inherited from a library default.** A test
  names each of the five algorithm URIs and the certificate placement, so a
  dependency upgrade that changes a default fails the suite rather than the
  invoice.
- **A wrong signature is not a build failure.** It is a document SIFEN rejects,
  and the Manual's §6.5 means a rejected DE is resubmitted with the **same** CDC
  — so the round trip and the XSD gate are the proof, not the presence of XML.
- **The private key never leaves the signing call.** It is RESTRICTED material
  ([[ADR-005]]); it is never logged, never returned, and never persisted by this
  Story.

## API

```text
None. This Story adds no route. The signing stage runs in the worker.
```

## Database

One migration: `fiscal_document_status` gains `SIGNING`, and the
`fiscal_document_transition_guard` function admits the three new edges.

## UI

- None.

## Implementation Summary

_Not implemented._ [[ADR-006]] is accepted, so nothing blocks the
implementation.

## Verification

```text
Not run.
```

## Tests Added

Planned:

- The profile, element by element: each algorithm URI, the ordered transforms,
  the reference URI and the certificate placement.
- The eight forbidden elements, each one refused.
- The signature's position between `</DE>` and `<gCamFuFD>`.
- The signed document validating against the official XSD.
- The round trip: verify with the public key succeeds, and fails on altered
  content.
- The purity of the signing function: the same inputs produce identical output.
- The lifecycle: the new enum value, the three admitted edges, and
  `SIGNING -> CANCELLED` still rejected.

## Known Limitations

- **The vault says "XAdES" and the standard says XMLDSig.** Recorded above and
  in [[ADR-006]]; the PRD is untouched.
- **The certificate is a fixture, not a PSC certificate.** Homologation is
  [[FISC-013]].
- **The signed document is not stored.** `xml_storage_key` remains written by
  nothing until submission needs it.
- **The signature is not checked against a CRL.** SIFEN does that at validation
  time (baseline §5), and the emitter does not attach the list.
- **The `SIGNING` claim has no lease of its own.** It reuses the submission
  handler's claim mechanism, so a worker that dies while signing is recovered by
  the existing sweep rather than by a new one.

## Technical Debt

- None created by the design. If the library's canonicalization has to be worked
  around, that workaround is recorded at that point rather than here.

## Decisions / ADRs

- **[[ADR-006]]** — the signing dependency. Accepted 2026-10-07: `xml-crypto`,
  with `pkijs`/`asn1js` staying what [[ADR-005]] added them for, because `pkijs`
  has no XMLDSig support at all.

## Files / Modules

```text
packages/fiscal/src/dte/dte.signing.ts        the pure signer and its profile
docs/04-adrs/ADR-006-xmldsig-signing-dependency.md
docs/06-fiscal/SIFEN-BASELINE.md              §5 is the source of record
packages/database/prisma/schema.prisma        the SIGNING enum value
apps/worker/src/fiscal-submission/**          the signing stage
odd/tasks/epic-16-sifen-direct.md             the epic tracker, T5
```

## Completion Notes

_Status must remain non-`done` until every acceptance criterion and gate
passes._
