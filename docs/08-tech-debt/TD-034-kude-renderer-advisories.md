---
id: TD-034
type: tech-debt
title:
  The KuDE renderer's three advisories — a throwing sum, a rebuilt QR sentence,
  and an untested branch
status: open
severity: low
owner: fiscal
created: 2026-10-15
updated: 2026-10-15
related:
  - FISC-013
---

# TD-034 — the KuDE renderer's advisories

Three findings from FISC-013 WU-C's review were accepted as debt rather than
fixed. Each carries the coordinates a later reader needs, because the review's
full text is not retained.

They are recorded rather than corrected because the review's own disposition
made them non-blocking — none opened a correction and no correction transition
was offered for that candidate — and editing the candidate after its authority
was burned would invalidate the approval without producing a new one. So they
are the next unit's work, and the fix belongs in a candidate that can be
reviewed on its own merits.

## 1. The decimal sum throws on a value it cannot read

`packages/fiscal/src/kude/kude.builder.ts`, `addDecimalStrings`. The sum feeds
`BigInt` the digits it parses out of each subtotal, so a value that is not a
plain decimal string — an empty one, or anything with a sign or an exponent —
raises `SyntaxError` from inside the renderer instead of degrading.

That contradicts the module's own contract twice over: `formatKudeAmount`
already guards with a regex and returns an unreadable value unchanged "rather
than silently coercing it", and the builder's whole design is that a value the
DE does not carry becomes a named absence rather than a failure. A KuDE is
generated from data the tenant influences, so a renderer that throws on it is a
renderer that can be stopped by a malformed field.

**The fix**: guard the sum the way `formatKudeAmount` guards the display, and
let an unreadable subtotal become the absence the rest of the module would
report. A test belongs with it: a subtotal that is not a decimal string must
produce an absence, not an exception.

## 2. The QR sentence is rebuilt instead of read from the profile

`packages/fiscal/src/kude/kude.html.ts`, `qrSentenceFor`. The renderer composes
the sentence itself and special-cases the autofactura, so the four other types
print "Consulte la validez de este documento electrónico…" where §26.4.6 prints
the sentence that **names the document type** — "…de esta Factura Electrónica…",
"…de esta Nota de Crédito Electrónica…" and so on.

The correct literal already exists and is already tested: `KUDE_TYPE_PROFILES`
carries `qrSentence` per type, and the model simply never passes it to the
document. So this is a value the model holds and the page ignores — the kind of
drift that is invisible until someone compares a printed KuDE against the
chapter.

**The fix**: put the profile's `qrSentence` on `KudeDocument` and print that, so
there is one source for the sentence rather than two.

## 3. The receptor's identity branch has no test

`packages/fiscal/src/kude/kude.builder.ts`, the `receptorIdentity` row. The row
prints the RUC when the receptor is a contributor and the identity document when
it is not (§22.11's rule), and the fixture only exercises the contributor
branch, so the other one is untested.

**The fix**: a case with `iNatRec = 2` and a `dNumIDRec`, asserting the row
carries the identity document and not a RUC.
