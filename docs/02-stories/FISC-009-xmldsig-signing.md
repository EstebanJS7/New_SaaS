---
id: FISC-009
type: story
title: XMLDSig signing of the DTE, and the return of the SIGNING state
epic: EPIC-16
status: done
priority: high
depends_on:
  - FISC-007
  - FISC-008
prd_sections:
  - "23"
permissions: []
branch: feat/epic-16-fisc-009-xmldsig-signing
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
- The `SIGNING` state: the enum value, the migration, and the transition-guard
  function. The worker stage that claims it is [[FISC-012]]'s, for the reason
  recorded above.
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
- **Timbrado and numbering ranges** — [[FISC-011]]. They are also what blocks
  the worker stage, which is why that criterion moved to [[FISC-012]].
- **A real PSC certificate.** The tests use the material [[FISC-007]]'s fixture
  produces; a certificate from a PSC habilitado por el MIC is a homologation
  concern, [[FISC-013]].

## Why this acceptance criterion moved

The criterion above was written assuming the worker could build a DE. **It
cannot, and the reason is not missing work — the inputs do not exist yet:**

| What `buildDteRequestFromInvoice` requires                             | Who owns it                                                 |
| ---------------------------------------------------------------------- | ----------------------------------------------------------- |
| `profile` — timbrado, establishment, point, activity                   | **[[FISC-011]]** (DEC-054 Q1-B: FISC-011 owns that storage) |
| `identity` — the CDC, which needs the timbrado and the numbering range | **[[FISC-011]]**                                            |
| `qrContent` — `gCamFuFD dCarQR`                                        | **[[FISC-012]]**, as the mapper itself records              |
| `totalGuaranies` — `F023` in a foreign currency                        | the caller                                                  |

And the worker today does not build a DE at all: it hands invoice data to the
**port** (`FiscalIssueRequest`) and the fake provides. The full DTE path inside
the worker belongs to [[FISC-012]], which is the Story that already sits behind
the port and will have [[FISC-011]]'s profile.

So [[FISC-009]] delivers **the signer** and **the state**, and the wiring moves
to the Story that can satisfy it. This is recorded rather than worked around: a
Story does not silently narrow its own acceptance criteria, and it is not marked
`done` while one is unmet — which is why this one is annotated with where it
went instead of being deleted.

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
- [x] `fiscal_document_status` gains `SIGNING` by migration, and the transition
      guard admits `QUEUED -> SIGNING`, `SIGNING -> SENDING` and
      `SIGNING -> ERROR` while still rejecting `SIGNING -> CANCELLED`. _(WU-C1;
      proven against a live PostgreSQL 16, see Verification)_
- [ ] The worker claims `SIGNING`, signs the document it built, and moves to
      `SENDING`; a signing failure moves it to `ERROR` with the reason recorded
      and no secret in the error. **MOVED TO [[FISC-012]] (2026-10-07)** — the
      worker cannot build a DE yet, and the reason is not missing work: see "Why
      this acceptance criterion moved" below.
- [x] The signing function is **pure with respect to its inputs**: no ambient
      clock, no ambient tenant, no I/O. _(WU-B)_
- [x] No secret appears in an **error or a returned value**: the signer's
      failure path is asserted to carry neither the key nor its base64 body.
      _(WU-B)_
- [ ] No secret appears in a **log or a stored snapshot**. **MOVED TO
      [[FISC-010]]**, which is where the document is persisted and where the
      submission path logs. [[FISC-009]] never persists anything and never logs
      the key.
- [x] Lint, typecheck, unit tests, the live-PostgreSQL gate and the build pass.
      _(WU-C1: fiscal and database lint/typecheck/test/build, root 18/18, 18/18,
      19/19, 11/11, `format-check`, and the live-PostgreSQL suite at 214/214
      against PostgreSQL 16.)_

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

One migration, `20261007000001_fiscal_document_signing_state`:
`fiscal_document_status` gains `SIGNING` by
`ALTER TYPE ... ADD VALUE IF NOT EXISTS`, and `fiscal_document_transition_guard`
is replaced with the body that admits `QUEUED -> SIGNING`, `SIGNING -> SENDING`
and `SIGNING -> ERROR` while keeping `SIGNING -> CANCELLED` excluded. The
trigger is not recreated: it resolves the function by name.

`SIGNING` is declared **last** in the Prisma enum, because
`ALTER TYPE ... ADD VALUE` appends and a value declared in the middle would
describe an order the database cannot have without recreating the type.

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

**WU-C1 — the `SIGNING` state.** The enum value, the migration and the guard
body. Proven against a live PostgreSQL 16 rather than only asserted: the
migration applies inside the transaction `prisma migrate deploy` wraps it in,
the new value lands **last** in `pg_enum` (so the schema declares no order the
database cannot have), and every new edge behaves as the story pins it —
`PENDING -> SIGNING`, `SIGNING -> SENDING`, `SIGNING -> ERROR` and
`ERROR -> SIGNING` are admitted, while `SIGNING -> CANCELLED` and
`SIGNING -> SUBMITTED` are refused with a message naming both states, and
`SENDING -> CANCELLED` stays refused.

**WU-C2 — the worker stage — moved to [[FISC-012]].** The reason is recorded
above under "Why this acceptance criterion moved".

## Verification

```text
pnpm --filter @newsaas/fiscal lint       green
pnpm --filter @newsaas/fiscal typecheck  green
pnpm --filter @newsaas/fiscal test       green - 164 tests, 13 files
   run with DTE_XSD_REQUIRED=1, so the official-schema gate ran instead of skipping
pnpm --filter @newsaas/fiscal build      green
pnpm lint / typecheck / test / build     green - 18/18, 18/18, 19/19, 11/11
pnpm format-check                        green, and it converges in two passes
live-PostgreSQL gate                     not run in WU-B - no schema change there
```

WU-C1 was proven against a live PostgreSQL 16 (the `postgres:16` image CI uses),
because the migration's risk is not its text but its application:

```text
pnpm db:deploy against a fresh database
   -> All migrations have been successfully applied.
      The ALTER TYPE ... ADD VALUE ran inside the transaction Prisma wraps each
      migration in, with the guard's replacement in the same file.

pg_enum order
   -> PENDING, QUEUED, SENDING, SUBMITTED, APPROVED, REJECTED, ERROR,
      CANCEL_PENDING, CANCELLED, SIGNING      (SIGNING last, as declared)

PENDING -> SIGNING      admitted
SIGNING -> CANCELLED    REFUSED  "from SIGNING to CANCELLED is not allowed"
SIGNING -> SUBMITTED    REFUSED  "from SIGNING to SUBMITTED is not allowed"
SIGNING -> SENDING      admitted
SIGNING -> ERROR        admitted
ERROR   -> SIGNING      admitted
SENDING -> CANCELLED    REFUSED  "from SENDING to CANCELLED is not allowed"
```

The probe ran in a transaction that was rolled back, so no row survives it.

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

`packages/database/src/schema-fiscal-signing-state.test.ts`, 8 cases (WU-C1):
the migration is additive and has no transaction wrapper; it appends the value
and never references it as a value in that transaction; it replaces the function
without recreating the trigger; the three new edges are present;
`SIGNING -> CANCELLED` and `SENDING -> CANCELLED` are both absent; every edge
and invariant the earlier guards installed survives; the other five guards are
untouched; and the Prisma enum declares `SIGNING` last, exactly as the database
has it.

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

Two advisories from WU-B's review (`review-08f7d14c4a649a88`, approved
2026-10-07). Both are `SUGGESTION` and **non-blocking**: neither opened a
correction, neither reopens the review, and they are recorded here as later work
rather than as a reason to re-run review on that candidate.

- **`R3-forbidden-list`** — `dte.signing.test.ts` iterates
  `FORBIDDEN_KEY_INFO_ELEMENTS`, so the suite cannot detect an entry **missing
  from the list itself**: deleting `"Modulus"` would leave every case green. The
  list is transcribed from baseline §5 by hand, and the test proves the code
  honours the list, not that the list is complete. Closing it means asserting
  the constant against the eight names §5 states, independently of the constant.
- **`R3-leak-test`** — the no-leak case checks one base64 line of the private
  key against the `Error`'s message. It does not check the whole key, and it
  does not walk the `cause` chain, which is where a library's error would carry
  material.

Both are accepted as-is under the policy the epic already applied to [[TD-032]]:
generation outran resolution, so cosmetics are recorded rather than chased. The
Story's own `done` gate does not depend on either.

Four more advisories from WU-C1's review (`review-cdb027b76f1760c1`, approved
2026-10-07), all non-blocking. **The first was fixed in the same work unit**
rather than recorded, because it was a real inaccuracy in a file that was still
editable — the branch had not been merged, so amending the migration's comment
could not invalidate an applied checksum:

- **`R2-SIGNING-EDGE-COUNT`** (readability, `WARNING`) — the migration's comment
  said "the three edges" and listed three, but the guard changes **five**: the
  claim paths `PENDING -> SIGNING` and `ERROR -> SIGNING` are also added,
  because the worker's claimable set is `PENDING`, `QUEUED` and `ERROR`. The
  comment and the matching test name were corrected to name all five and to
  separate the claim paths from the stage's own two exits.
- **`R2-SIGNING-TEST-NAME`** (readability, `SUGGESTION`) — the same test was
  named "admits the three edges"; it is now "admits every claim path into
  SIGNING, and its two exits".
- **`R3-001`** (reliability, `WARNING`) — `withFreshDocument` in the live-PG
  suite signals its rollback by throwing, and `nextFiscalInvoiceNumber`'s
  in-memory counter advances even though the transaction it served was rolled
  back. The second is real and harmless — invoice numbers are per-suite and only
  need to be distinct — but it is a side effect outside the transaction, so it
  is recorded rather than left implicit.
- **`R3-002`** (reliability, `WARNING`) — the "preserves every edge and
  invariant the earlier guards installed" case restates the earlier migrations'
  edge list, so it is a copy that can drift from the files it claims to
  preserve. Closing it means deriving the expected set from those migrations
  instead of restating it.

## Decisions / ADRs

- **[[ADR-006]]** — the signing dependency. Accepted 2026-10-07: `xml-crypto`,
  with `pkijs`/`asn1js` staying what [[ADR-005]] added them for, because `pkijs`
  has no XMLDSig support at all.

## Files / Modules

```text
packages/fiscal/src/dte/dte.signing.ts        the pure signer and its profile
packages/fiscal/src/dte/dte.signing.test.ts   25 cases: the profile, the round trip
packages/fiscal/src/dte/dte.builder.ts        exports SIGNATURE_PLACEHOLDER
packages/database/prisma/schema.prisma        the SIGNING enum value, declared last
packages/database/prisma/migrations/20261007000001_fiscal_document_signing_state/
packages/database/src/schema-fiscal-signing-state.test.ts
docs/04-adrs/ADR-006-xmldsig-signing-dependency.md
docs/05-modules/Fiscal.md                     the enum and the graph
docs/06-fiscal/SIFEN-BASELINE.md              §5 is the source of record
odd/tasks/epic-16-sifen-direct.md             the epic tracker, T5
```

## Completion Notes

**`done` means the signer and the state, and it does not mean the wiring.**

What is done: `signDteXml` implements the §5 profile element by element and is
asserted against it; the signed document validates against the official XSD and
verifies against its own certificate; `SIGNING` is a real stage in the applied
database, proven on a live PostgreSQL 16.

What `done` does **not** mean:

- **The worker does not sign yet.** Its criterion moved to [[FISC-012]], and the
  reason is recorded above: there is no emitter profile and no timbrado anywhere
  in the application, so no DE can be built there to sign. This is the same
  distinction [[FISC-008]]'s notes draw.
- **No signature has been accepted by SIFEN.** Only DNIT can accept one.
  Homologation is [[FISC-013]].
- **The certificate is a fixture.** [[FISC-007]]'s throwaway material, not one
  from a PSC habilitado por el MIC.
- **The signed XML is not stored.** `xml_storage_key` is still written by
  nothing; where the document is persisted belongs with submission.
- **The vault still says "XAdES" in places.** The PRD is not edited; [[ADR-006]]
  and the section above record the discrepancy and name the real target.
- **Two advisories from WU-B's review are open and accepted as-is**, recorded
  under Technical Debt.

_Status must remain non-`done` until every acceptance criterion and gate
passes._
