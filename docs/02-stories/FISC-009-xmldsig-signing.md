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

- [x] The signature carries `CanonicalizationMethod` =
      `http://www.w3.org/TR/2001/REC-xml-c14n-20010315` — **inclusive**, not
      exclusive. _(WU-B)_
- [x] The signature carries `SignatureMethod` =
      `http://www.w3.org/2001/04/xmldsig-more#rsa-sha256`. _(WU-B)_
- [x] The `Reference` `URI` is `#` followed by the CDC, and the signed subtree
      is the `DE` element whose `Id` is that CDC. _(WU-B)_
- [x] The `Reference` carries **exactly two** `Transform` elements, in this
      order: `http://www.w3.org/2000/09/xmldsig#enveloped-signature`, then
      `http://www.w3.org/2001/10/xml-exc-c14n#`. _(WU-B)_
- [x] `DigestMethod` = `http://www.w3.org/2001/04/xmlenc#sha256`. _(WU-B)_
- [x] `KeyInfo` carries `X509Data > X509Certificate` and nothing else, and the
      **eight forbidden elements are absent**; a signature that contains any of
      them is refused rather than emitted. _(WU-B)_
- [x] The signature block is placed **between `</DE>` and `<gCamFuFD>`**, which
      is the position [[FISC-008]] leaves for it. _(WU-B)_
- [x] The signed document **validates against the official XSD** in the CI job
      [[FISC-008]] built. _(WU-B)_
- [x] A **sign-then-verify round trip** succeeds with the certificate's public
      key, and **fails** when the signed content is altered after signing.
      _(WU-B)_
- [ ] `fiscal_document_status` gains `SIGNING` by migration, and the transition
      guard admits `QUEUED -> SIGNING`, `SIGNING -> SENDING` and
      `SIGNING -> ERROR` while still rejecting `SIGNING -> CANCELLED`. _(WU-C)_
- [ ] The worker claims `SIGNING`, signs the document it built, and moves to
      `SENDING`; a signing failure moves it to `ERROR` with the reason recorded
      and no secret in the error. _(WU-C)_
- [x] The signing function is **pure with respect to its inputs**: no ambient
      clock, no ambient tenant, no I/O. _(WU-B)_
- [ ] No secret appears in a log, an error, a returned value or a stored
      snapshot. _(WU-B covers the error and the returned value; the log and the
      stored snapshot belong to [[FISC-010]], where the document is persisted.)_
- [ ] Lint, typecheck, unit tests, the live-PostgreSQL gate and the build pass.
      _(Green through WU-B except the live-PostgreSQL gate, which WU-C exercises
      when the enum and the guard change.)_

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

**WU-A — the ADR and this Story.** [[ADR-006]] accepted 2026-10-07: `xml-crypto`
6.3.3 as a dependency of `packages/fiscal`. `pkijs`/`asn1js` stay what
[[ADR-005]] added them for, because `pkijs` cannot sign XML.

**WU-B — the signer.** `packages/fiscal/src/dte/dte.signing.ts`:
`signDteXml({ xml, privateKeyPem, certificatePem, cdc })` returns the document
with the signature in place of the placeholder. The five algorithm URIs, the
certificate placement and the eight forbidden elements are constants of the
module, so a caller can assert the profile without reaching into its internals.
`dte.builder.ts` now exports `SIGNATURE_PLACEHOLDER` — the exact line the signer
removes — so the signer never guesses at the builder's serialization.

**Two findings the implementation produced, both recorded rather than worked
around:**

1. **The signature is a SIBLING of `DE`.** The schema's `rDE` carries
   `<xs:element name="DE" type="tDE"/>` followed by
   `<xs:element ref="ds:Signature"/>`, and `tDE` contains no signature. So the
   enveloped transform removes nothing — the signature is not a descendant of
   the referenced element — and it is present because the profile requires it,
   not because it changes the digest.
2. **`@xmldom/xmldom` is deliberately NOT declared.** Its `index.d.ts` opens
   with `/// <reference lib="dom" />`, which pulls the whole DOM lib into this
   Node-only package's compilation; declaring it re-typed an unrelated WebCrypto
   union in the PKCS#12 fixture and broke `typecheck`. It stays transitive,
   `xml-crypto` does every parse, and the signer's own XML work is two exact
   string operations. [[ADR-006]] records this.

**WU-C — the `SIGNING` state — is not implemented yet.**

## Verification

```text
pnpm --filter @newsaas/fiscal lint       green
pnpm --filter @newsaas/fiscal typecheck  green
pnpm --filter @newsaas/fiscal test       green - 164 tests, 13 files
   run with DTE_XSD_REQUIRED=1, so the official-schema gate ran instead of skipping
pnpm --filter @newsaas/fiscal build      green
pnpm lint / typecheck / test / build     green - 18/18, 18/18, 19/19, 11/11
pnpm format-check                        green, and it converges in two passes
live-PostgreSQL gate                     not run - no schema change in WU-B
```

## Tests Added

`packages/fiscal/src/dte/dte.signing.test.ts`, 25 cases:

- Each of the five algorithm URIs, read from the produced signature.
- The reference URI, and the two transforms in the profile's order.
- The certificate in `X509Data > X509Certificate`, byte-equal to the fixture's
  DER.
- The eight forbidden elements, one case each.
- The position: immediately after `</DE>`, nothing but whitespace between, and
  before `<gCamFuFD`.
- The round trip: verification succeeds, and fails on altered content.
- Purity: identical output for identical inputs, and no key material returned.
- Four refusals: the wrong `Id`, a document that is not a DE, a missing
  placeholder, and an error that does not carry the key.

`packages/fiscal/src/dte/xsd-validation.test.ts` gained one case: **the really
signed document validates against the official XSD.** It is deliberately
separate from the structural-fixture case above it — the structural block passes
the same gate, which is exactly why "structure is not a signature" needed its
own assertion.

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
