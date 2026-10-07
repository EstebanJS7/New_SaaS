---
id: ADR-006
type: adr
title: The XMLDSig signing dependency
status: accepted
date: 2026-10-07
supersedes: []
superseded_by:
related_epics:
  - EPIC-16
related_decisions:
  - DEC-047
  - DEC-053
related_stories:
  - FISC-009
  - FISC-007
approval_record:
  decision_proposal: none
  decision_status: accepted
  decision_approval_date: 2026-10-07
---

# ADR-006 — The XMLDSig signing dependency

## Decision Summary

The DE is signed with **`xml-crypto`** (6.3.3, MIT), as a **direct dependency of
`packages/fiscal`**. It implements the profile [[FISC-006]] pinned, element for
element, and it is the only new runtime dependency this Story adds.

**`pkijs` and `asn1js` stay exactly as [[ADR-005]] added them** — parsing the
PKCS#12 container — because **they cannot sign XML**. That is not an opinion:
the installed `pkijs@3.4.1` contains **zero occurrences of `xmldsig`**; it
implements CMS/PKCS#7, X.509, PKCS#12, OCSP and CRL, which is a different
serialization of a signature. ADR-006 exists to state that explicitly, because
the epic asked it to and because "we already have a crypto library" is exactly
the assumption that would otherwise go unexamined.

## Context

[[FISC-009]] has to produce the `<ds:Signature>` that [[FISC-008]] leaves as a
placeholder. The profile is fully pinned by the official sources and recorded in
`SIFEN-BASELINE.md` §5, from the Manual's §7.6, §7.7 and Schema XML 1:

```text
Standard                XML Digital Signature, Enveloped (W3C xmldsig-core)
CanonicalizationMethod  http://www.w3.org/TR/2001/REC-xml-c14n-20010315
SignatureMethod         http://www.w3.org/2001/04/xmldsig-more#rsa-sha256
Reference URI           #<CDC>
Transforms (exactly 2)   http://www.w3.org/2000/09/xmldsig#enveloped-signature
                        http://www.w3.org/2001/10/xml-exc-c14n#
DigestMethod            http://www.w3.org/2001/04/xmlenc#sha256
KeyInfo                 X509Data > X509Certificate   (X.509 v3)
Key size                RSA 2048 (software); RSA 2048 or 4096 (hardware)
Digest                  SHA-2 / SHA-256
Encoding                Base64
```

and eight elements are **forbidden** in a signed DE, because the certificate
already carries them: `X509SubjectName`, `X509IssuerSerial`, `X509IssuerName`,
`X509SKI`, `KeyValue`, `RSAKeyValue`, `Modulus`, `Exponent`.

**A correction to this vault's vocabulary, recorded rather than renamed.** The
PRD's §23, the epic, the changelog, [[FISC-007]], [[FISC-008]] and
`docs/05-modules/Fiscal.md` all say **"XAdES signing"**. The cited standard is
**not XAdES**: `XAdES`, `QualifyingProperties` and `SignedProperties` appear
**zero times** in all three official schemas, and the Manual's own synthesis
(§7.9) reads _"Firma **XML Digital Signature, Enveloped**, X.509 v3, clave
privada RSA 2048, RSA, RFC5639, SHA-256"_.

The PRD is **not edited**: approved scope is not silently rewritten by an
implementation. This ADR and the Story record that the **implementation target
is the profile above**, and that the name in the vault comes from the PRD's
wording. The practical consequence is a constraint, not a preference: **a
library that emits XAdES qualifying properties adds signed content the profile
does not ask for**, and the signed bytes are exactly what SIFEN validates.

## Why an ADR is Required

`AGENTS.md` requires a concrete requirement before a new dependency, and this
one is architectural rather than incidental:

- it sits in the **Fiscal provider boundary**, which `DOCUMENTATION-RULES.md`
  names as an ADR case;
- it is **security-critical**: the bytes it canonicalizes are the bytes that get
  signed, so a wrong canonicalization does not fail a build — it produces
  documents SIFEN rejects, or verifications that pass against the wrong content;
- the epic states that **ADR-006 is the gate for [[FISC-009]]**, and that it
  must say whether the signing path reuses [[ADR-005]]'s family or adds another
  library.

## Decision

**`xml-crypto`, pinned to `^6.3.3`, as a dependency of `packages/fiscal`.**

Verified in the installed package rather than assumed from its README, because
each of these is a profile requirement:

```text
lib/c14n-canonicalization.js         http://www.w3.org/TR/2001/REC-xml-c14n-20010315
lib/exclusive-canonicalization.js    http://www.w3.org/2001/10/xml-exc-c14n#
lib/enveloped-signature.js           http://www.w3.org/2000/09/xmldsig#enveloped-signature
lib/signature-algorithms.js          http://www.w3.org/2001/04/xmldsig-more#rsa-sha256
lib/hash-algorithms.js               http://www.w3.org/2001/04/xmlenc#sha256
lib/signed-xml.js                    X509Data / X509Certificate
```

Its transitive dependencies are `xpath`, `@xmldom/xmldom` and
`@xmldom/is-dom-node` — four packages total, all permissively licensed, none
native, none requiring a build step.

**`@xmldom/xmldom` stays transitive and is deliberately NOT declared**, even
though the signer needs to inspect XML. Its `index.d.ts` opens with
`/// <reference lib="dom" />`, so declaring it pulls the **whole DOM lib** into
this Node-only package's compilation. That is not theoretical: it re-typed an
unrelated WebCrypto union in the PKCS#12 fixture (`AesGcmParams` began to
require an `iv`) and broke `typecheck` in a file this Story does not touch.
`xml-crypto` performs every parse, and `dte.signing.ts` does only two exact
string operations over a document our own builder produced: removing the
placeholder line the builder exports, and asserting the shape of the signature
`xml-crypto` returned. Avoiding a `lib="dom"` leak in a package that parses
PKCS#12 and signs is worth more than the convenience of a second parser.

**Scope of the dependency**: `packages/fiscal` only. The API and the worker
reach it through the package's public surface, never directly.

**What it does not decide.** The library canonicalizes and signs; it does not
decide _what_ is signed. The reference, the two ordered transforms, the digest
algorithm and the certificate placement are asserted by our own tests against
§5, so a library default cannot quietly become our profile.

## Alternatives Considered

### Hand-rolled signing on `node:crypto`

Rejected. `crypto` can do RSA-SHA256 over bytes, and the remaining work is
**canonicalization** — inclusive c14n 2001 for `SignedInfo`, exclusive c14n as
the second transform, and the enveloped transform that removes the signature
from its own digest. That is the part of the protocol where improvisation is
most expensive: the canonical bytes _are_ the signed content, so a subtle
difference produces a signature SIFEN rejects, or a verification that succeeds
against content nobody intended. No dependency is saved that is worth that risk,
and the W3C specification is a substantial thing to implement correctly.

### `xadesjs` (with `xmldsigjs` and `pkijs`)

Rejected. It is a full XAdES stack — `x:QualifyingProperties`,
`SignedProperties`, and a second reference with its own digest — for a profile
that **is not XAdES**. Emitting those elements would add signed content the
profile does not request, and would pull in three packages on top of the two
[[ADR-005]] already added. Its `xmldsigjs` layer is the only part this Story
needs, and `xml-crypto` covers that more directly.

### Shelling out to `xmlsec1`

Rejected. It is the reference implementation and it is excellent, but it is a
**system binary**, and the MVP's deployables are `web`, `api` and `worker` on
Node. A native toolchain dependency in the signing path of three deployables is
a larger change than the problem, and it moves the profile into command-line
flags rather than into reviewed code.

### Extending `pkijs`

Not possible, and this is the finding the epic asked for. `pkijs` is a
CMS/PKCS#7 and X.509 toolkit; XML signature is a different format with its own
canonicalization. **Zero `xmldsig` occurrences in the installed package.** Its
role stays what [[ADR-005]] chose it for.

## Consequences

- **Four packages added**, MIT-licensed, none native: `xml-crypto` and its three
  transitive dependencies.
- **The signing path now exists inside the Fiscal boundary**, which means the
  boundary holds a private key _and_ the code that uses it. [[ADR-005]] already
  classified that material RESTRICTED and forbids logging it; this ADR adds that
  the signing function must never receive a secret it does not use and must
  never return anything but the signed document.
- **The canonicalization is the library's**, so its version is part of the
  protocol. A patch that changes how it canonicalizes changes every signature,
  so the dependency is pinned and the profile is asserted by test rather than
  trusted to a default.
- **A wrong signature is not a build failure.** It is a document SIFEN rejects —
  and the Manual's §6.5 means a rejected DE is resubmitted with the **same**
  CDC, so a bad signature is not repaired by resending. That is why the Story's
  verification includes a sign-then-verify round trip and validation of the
  signed document against the official XSD.
- **The vault's "XAdES" wording stays**, with the discrepancy recorded here, in
  the Story and in `docs/05-modules/Fiscal.md`.

## Migration / Rollout

No data migration. The dependency lands with [[FISC-009]], which also returns
the `SIGNING` lifecycle state that [[DEC-047]] deliberately omitted while a fake
stood in for the provider.

## Guardrails

1. **The dependency is pinned and its algorithms are asserted.** A test names
   each of the five algorithm URIs and the certificate placement, so a library
   upgrade that changes a default fails the suite rather than the invoice.
2. **The eight forbidden elements are refused, not merely omitted.** If the
   produced signature contains any of them, signing fails.
3. **The signature is verified with the certificate's public key** in the same
   suite, so "it produced XML" is never mistaken for "it produced a valid
   signature".
4. **The signed document is validated against the official XSD** by the gate
   [[FISC-008]] built, which is the only thing that proves the signature's
   placement is the one the schema allows.
5. **The signing function is pure with respect to its inputs**: no ambient
   clock, no ambient tenant, no I/O. The key and certificate arrive as
   arguments.
6. **The private key never appears in an error, a log or a returned value.**

## References

- `docs/06-fiscal/SIFEN-BASELINE.md` §5 (the signature profile), §6 (the
  certificate standard), §7 (transport, whose synthesis line names XML Digital
  Signature Enveloped).
- `docs/04-adrs/ADR-005-tenant-signing-material-secretstore.md` — the material
  this signing path consumes.
- `docs/07-decisions/DEC-047-fiscal-trigger-event-and-queue-boundary.md` — why
  `SIGNING` was absent.
- `docs/02-stories/FISC-009-xmldsig-signing.md` — the Story this gates.
- `docs/06-fiscal/SIFEN.md` — the boundary rule.
