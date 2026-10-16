---
id: TD-035
type: tech-debt
title:
  The KuDE renderer's second advisory round — a sign the guard admits and the
  sum mishandles, and the printed consultation address
status: open
severity: low
owner: fiscal
created: 2026-10-15
updated: 2026-10-15
related:
  - FISC-013
  - TD-034
---

# TD-035 — the KuDE renderer's second advisory round

Four findings from the review that approved TD-034's fixes were accepted as debt
rather than fixed, for the same reason as the first round: their disposition is
informational, none opened a correction, and editing the candidate after its
authority was burned would have invalidated the approval without producing a new
one.

**The review's full text is not retained**, so each item below carries the
coordinates the closure published and this reader's own reading of them, marked
as a reading rather than as the reviewer's words. Anyone acting on one should
re-derive the claim from the code before treating it as settled.

## 1. The guard admits a sign the sum mishandles

`packages/fiscal/src/kude/kude.builder.ts:167` — `isDecimal`, whose pattern is
`/^-?\d+(\.\d+)?$/`, one line above `addDecimalStrings`'s own comment calling
its inputs "non-negative decimal strings".

**The reading**: the two disagree, and the code is the one that matters. A
negative value passes the guard, and then
`sum.toString().padStart(scale + 1, "0")` pads **before the sign** — `-5` at
scale 0 becomes `0-5`, and the slices that follow return a string that is not a
number at all. So the guard should either refuse the sign it does not support,
or the arithmetic should carry it; today it admits one and produces nonsense.

## 2. The printed consultation address is the QR's composition prefix

`packages/fiscal/src/kude/kude.html.ts:178` — the QR block's `<p class="url">`,
which prints `document.qr.consultationUrl`.

**The reading**: that value comes from `QR_CONSULTATION_URLS`, which is the
**prefix the QR's content is composed from** —
`https://ekuatia.set.gov.py/consultas/qr?` and its test sibling, both ending in
a bare `?`. The address the reference models print under the QR is the
consultation page, `https://ekuatia.set.gov.py/consultas/` (§26.4.6, and the
samples on pages 199–205). Those are two different strings for two different
purposes, and this row is using the wrong one: a reader who typed what is
printed would land on a page expecting query parameters.

## 3. The unreadable-subtotal absence names fields it did not check

`packages/fiscal/src/kude/kude.builder.ts:330-332` — the reason string for the
`SUBTOTAL:` absence.

**The reading**: it says "dSubExe, dSub5 and dSub10 are not decimal values", but
the condition that raises it is that **at least one** of them is unreadable, and
the message does not say which. That is the class of defect this epic has hit
before in the other direction — a message that describes a condition the code no
longer has — and the fix is to name the offending field rather than the set.

## 4. The unreadable-subtotal test does not pin the reason

`packages/fiscal/src/kude/kude.builder.test.ts:341` — the assertions on the
absence.

**The reading**: the case asserts the absence's **label** but not its
**reason**, so the string item 3 is about can change without a test noticing. A
test that pins the label and the reason together is what would have made item 3
fail here instead of in a review.
