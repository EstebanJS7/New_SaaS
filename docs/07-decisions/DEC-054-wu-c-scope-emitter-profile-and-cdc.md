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

The composition is pinned. The **check digit is not**: §10.2 names `módulo 11`,
the verifier document's URL now serves the portal's HTML shell, and the Manual
plus all 27 Notas Técnicas contain **one usable specimen**, which shows that a
plain-sum variant reproduces it and the RUC-style weighting does not — but one
equation does not fix a variant.

- **A. Compose it, with the DV as a documented candidate variant.** The
  composition is cited, the candidate is recorded as provisional, and the
  document becomes self-contained. The risk is specific and severe: **the CDC is
  the document's identity**, a wrong check digit makes the identity wrong, and
  §6.5 means a rejected DE is resubmitted with the _same_ CDC — so the error is
  not recoverable by resending. It would also make `dDVId` a computed value
  while the vault says the algorithm is unpinned, which is exactly the class of
  claim this epic exists to prevent.
- **B. Keep it an input until a second specimen or the verifier document
  arrives.** The mapper takes `cdc` and `dDVId`. **The second-specimen search
  was run and came up empty**: chapter 13's KuDE examples were rendered as
  images and they stop before the CDC, page 198 prints the display rule ("CDC en
  once grupos de 4 posiciones") but no value, and the Guía de Pruebas has no
  44-digit run at all. The whole retrieved corpus yields **one** usable
  specimen. So the sources that remain are the verifier document under a current
  URL, the Prevalidador, and — the reliable one — **[[FISC-013]]'s homologation
  run**, which produces many real specimens and settles the variant by volume
  instead of by argument.
- **C. Compose it and let SIFEN reject a wrong DV.** Rejected: it spends a real
  document identity to learn something a rendered page can tell us for free.

**Recommendation: B, with the rendering attempt as the immediate next step.** If
chapter 13 yields a second specimen that agrees with the plain-sum variant, the
case for composing becomes strong and this decision can be revisited cheaply.

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
