---
id: DEC-054
type: decision
title: WU-C's scope, the emitter fiscal profile and the CDC's check digit
status: proposed
date: 2026-10-05
related_epics:
  - EPIC-16
related_stories:
  - FISC-008
  - FISC-011
prd_change_required: false
---

# DEC-054 — WU-C's scope, the emitter fiscal profile and the CDC's check digit

## Context

[[FISC-008]] is delivered as three work units. WU-A (the builder) and WU-B (the
schema-validation gate) are implemented, gated and review-approved. **WU-C — the
invoice → `DteRequest` mapping — was blocked**, and on 2026-10-05 a read-only
investigation re-derived its blocker list. Two of the three items on it were
wrong, and a fourth appeared:

1. **`D104` is not blocked.** The Manual's TABLA 1 prints all eight régimenes
   inline (baseline §22.6). The vault's "the Manual references them but does not
   contain them" was a **PDF-extraction artifact**: chapter 15 was invisible
   because the extractor dropped its tables.
2. **The CDC's composition is not blocked.** It is a picture of a table on the
   Manual's page 56; rendering the page recovers all eleven fields with their
   order and widths, and the Manual's worked example decomposes into exactly
   those widths and matches the KuDE specimen byte for byte (§22.9).
3. **The non-receptor notes are not blocked, they were untranscribed.** They are
   now transcribed in §22.12 (currency and exchange), §22.13 (titles,
   transaction type, affected obligations and the new TABLA 12) and §22.14
   (items, with NT 013's per-item IVA formulas).
4. **A blocker that was not on the list: the emitter fiscal profile and the
   timbrado.** A confirmed invoice supplies lines, currency, `confirmedAt` and
   the customer. It supplies **none** of the emitter's fiscal identity (RUC +
   check digit, razón social, address, coded geography, phone, email,
   activities, contributor type, régimen), and **nothing** holds a timbrado or a
   numbering range. `Tenant` and `Branch` carry a name each;
   `TenantSettingsService` ships `sales`, `scheduling` and `portal` only;
   `FiscalDocument.cdc` is written from the provider's result and the fake
   returns `null`.

So WU-C cannot be "invoice → request" as written. It is **"invoice snapshot + a
supplied emitter/timbrado profile → request"**, and where that profile lives is
a scope decision this document puts to the maintainer.

## The two questions

### Q1 — Where do the emitter fiscal profile and the timbrado live?

The values are tenant data, not constants in our code: a tenant's RUC, its
régimen, its activities and its timbrado ranges are facts about that tenant, and
the same DE must be reproducible from them. Three options:

- **A. A new "tenant fiscal profile" story, before WU-C.** A dedicated aggregate
  (or a typed settings namespace) holding the emitter identity and the timbrado
  ranges, with its own migration, permission, validation and audit. WU-C then
  reads it. **Most correct, most work, and it is really FISC-011's territory
  extended backwards.**
- **B. FISC-011 owns it, and WU-C takes the profile as an input.** WU-C ships
  now, as a pure mapper from `(invoice snapshot, profile)` to `DteRequest`, with
  the profile as a parameter — exactly the seam the CDC already uses in WU-A.
  FISC-011 later supplies the profile from persistence, and the mapper does not
  change. **Recommended**: it unblocks WU-C today, it keeps the mapper pure and
  testable, and it puts the storage decision where the numbering-range decision
  already is.
- **C. WU-C reads whatever it can find and the rest is stubbed.** Rejected: it
  would put guessed emitter data into a document whose identity is unrecoverable
  — the Manual's §6.5 requires a rejected DE to be resubmitted with the same
  CDC, so a wrong field is not a retry, it is a new document.

**Recommendation: B.** The mapper is the valuable, testable artifact; the
storage model is FISC-011's and should not be invented inside a mapping task.

### Q2 — Does the CDC get composed now, or stay an input?

**This question changed on 2026-10-06: both halves of the CDC are now pinned.**

- The **composition** was recovered on 2026-10-05. It is a picture of a table on
  the Manual's page 56, obtained by rendering the page; the eleven fields with
  their order and widths are in baseline §22.9, and the Manual's worked example
  decomposes into exactly those widths and matches the KuDE specimen byte for
  byte.
- The **check digit** closed on 2026-10-06. The document §10.2 cites — whose
  `set.gov.py` URL serves the portal's HTML shell — lives on the DNIT domain:
  `dnit.gov.py/documents/20123/224893/Dígito+Verificador.pdf`, HTTP 200, 21,199
  bytes, 3 pages. It prints `Pa_Calcular_Dv_11_A` in PL/SQL, Visual Basic and C:
  **weights `2..11` from the right, restarting, with
  `resto > 1 ? 11 - resto : 0`**, and a non-digit character replaced by its
  ASCII value. It reproduces the Manual's own worked CDC and the **RUC** check
  digit in all four example documents, including the two whose CDC digit does
  not match — which is the signature of illustrative CDCs written by hand over
  real RUCs, not of a wrong algorithm.

So the honest framing is no longer "can we?" but "do we want to?". The options:

- **A. Compose it now — RECOMMENDED.** Composing is a solved problem:
  concatenate the eleven fields at their widths and apply the function to the
  43-digit prefix. The document becomes self-contained and `dDVId` stops being
  something a caller can get wrong. **This is a scope change**, and that is the
  only reason it is not already done: FISC-008's acceptance criterion says the
  generator does not compose the CDC nor compute its check digit "because §22.9
  records that neither algorithm is pinned", and that premise is now false. The
  criterion is approved, so relaxing it is the maintainer's call — not a
  documentation edit, and not a silent implementation.
- **B. Keep it an input indefinitely.** Defensible: the criterion is approved,
  the field is an input either way, and the mapper can keep taking it. But the
  reason has weakened from "we cannot" to "we have not decided to", and a caller
  that supplies a wrong CDC is a failure mode we could now remove.
- **C. Compose it and let SIFEN reject a wrong DV.** Rejected: the algorithm is
  cited now, so a rejection teaches nothing, and the Manual's §6.5 means a
  rejected DE is resubmitted with the **same** CDC — a wrong identity is not
  repaired by resending.

**A note on how this changed, kept because it is the lesson.** An earlier
version of this decision argued for keeping the CDC as an input on the strength
of an "elimination": four specimens, and no weight sequence of period ≤ 3 with
weights 1..9 reproducing them. That search **never entered the space the real
algorithm lives in** — weights up to **11**, period **10** — so it was true
about a family the algorithm is not in, and it should not have been read as
evidence that the check digit was unknowable. It was, in fact, retrievable the
whole time: the Manual cites the document, and the document is one HTTP request
away on the DNIT domain. **Searching harder for a _document_ beat reasoning
harder about _specimens_.**

## The proposed WU-C scope, if both recommendations are accepted

```text
packages/fiscal/src/dte/dte.mapper.ts
  buildDteRequestFromInvoice(
    snapshot: ConfirmedInvoiceSnapshot,     // invoice + lines + customer
    profile: EmitterFiscalProfile,          // supplied; FISC-011 owns storage
    identity: DocumentIdentity,             // cdc, dDVId, environment, clock
  ): DteRequest
```

with `EmitterFiscalProfile` carrying the `gEmis`/`gTimb` values, and
`DocumentIdentity` carrying the CDC. The mapper is pure: no I/O, no ambient
clock, no tenant context — the same discipline `buildDteXml` already follows,
and for the same reason (determinism is an acceptance criterion of this Story).

The item area is the mapper's real work, and §22.14 now gives it formulas rather
than guesses: `E735 dBasGravIVA`, the new `E737 dBasExe`, the
`F002`/`F004`/`F005` totals, and the six validations (`1910`, `1911`, `1921`,
`2353`, `2357`, `2359`) that a mapper must satisfy before the builder ever sees
the request.

## Consequences if accepted

- [[FISC-008]]'s WU-C becomes a mapper work unit with two inputs, and the
  Story's Out of Scope grows: the emitter profile's **storage**, its permission
  and its audit belong to [[FISC-011]] and to the story that Q1 selects.
- **A correction to shipped code becomes due**: §22.12 records that `D208c`
  selects `F023` or `F014` by currency and that NT 008 forbids `F023` for a PYG
  document, while the builder compares a single supplied `totalGuaranies` and
  only when the caller supplies it. That is a small, cited fix and it should
  land before the mapper starts feeding it.
- [[FISC-011]] gains a named obligation: it must hold the emitter profile, not
  only the numbering ranges.

## Status

**Proposed.** Both questions are the maintainer's; nothing here is implemented.
