---
id: FISC-008
type: story
title: DTE XML generation validated against the official XSDs
epic: EPIC-16
status: in-progress
priority: high
depends_on:
  - FISC-006
prd_sections:
  - "22"
  - "23"
permissions: []
branch: feat/epic-16-fisc-008-dte-xml
created: 2026-10-04
updated: 2026-10-04
---

# FISC-008 — DTE XML generation validated against the official XSDs

## Objective

Generate the Paraguayan electronic tax document — the `<rDE>` envelope with its
`<DE>` body — from a confirmed invoice, and validate it against the **official
DNIT schemas** before anything is signed or submitted.

This Story produces the XML and its validation. It does not sign ([[FISC-009]]),
does not call SIFEN ([[FISC-010]]) and does not choose a provider
([[FISC-012]]).

## Context

[[EPIC-16]] is SIFEN Direct, so this system builds the DE itself. PRD §23
forbids implementing protocol details from memory, so every constant below
traces to a cited official source.

[[FISC-006]] revalidated the baseline and recorded one gap that is exactly this
Story's input: **`DE_Types_v150.xsd` was not retrieved**, so no per-field
length, pattern or enumeration was pinned. **That gap is now closed**: the
retrieval and its facts are in `docs/06-fiscal/SIFEN-BASELINE.md` §21, which is
this Story's source of record for every field-level rule.

## The contract, pinned

Everything in this section is cited from `SIFEN-BASELINE.md` §3, §4, §13 and
§21, which in turn cite the official schemas and the Manual Técnico.

### The document root — `rDE` has exactly four ordered, required children

```text
dVerFor     [1..1]  pattern [1][5][0]   pinned to 150 BY PATTERN
DE          [1..1]  type tDE
(signature) [1..1]  the ds:Signature placeholder
gCamFuFD    [1..1]  type tgCamFuFD      OUTSIDE the signature
```

### The `DE` body — eleven ordered children

```text
dDVId        [1..1]  check digit of the CDC
dFecFirma    [1..1]  pattern \d{4}-\d\d-\d\dT\d\d:\d\d:\d\d  (no timezone, no fraction)
dSisFact     [1..1]
gOpeDE       [1..1]  operation: emission type, security code, issuer info
gTimb        [1..1]  timbrado
gDatGralOpe  [1..1]  general operation data
gDtipDE      [1..1]  document-type specific
gTotSub      [0..1]  totals
gCamGen      [0..1]  general fields
gCamDEAsoc   [0..99] associated documents
```

The order is schema-enforced. A DE with the same children in another order is
invalid, not merely unconventional.

### Field rules that shape the generator

| Field family                     | Pinned rule                                                                                                                                                                                                       |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CDC                              | `tCDC`: 44 characters, `[0-9]{2}([0-9]{7}[0-9A-D])[0-9]{34}` — position 10 admits `A`–`D`                                                                                                                         |
| RUC                              | `tRuc`: 3–8 chars, `[1-9][0-9]*[0-9A-D]?` — the check letter is **optional** here, unlike the certificate's `RUCXXXXXXXXX-X`                                                                                      |
| Establishment / expedition point | `tdEst` / `tdPunExp`: **zero-padded to three digits**                                                                                                                                                             |
| Document number                  | `tdNumDoc`: **exactly seven digits**                                                                                                                                                                              |
| Series                           | `tdSerieNum`: `[A-Z]{2}` — matches §13's series rule                                                                                                                                                              |
| Timestamp                        | `fecHhmmss`: `AAAA-MM-DDThh:mm:ss`, **no timezone suffix and no fractional seconds**                                                                                                                              |
| Validity dates                   | `minInclusive=2018-05-01`; no date may precede SIFEN's start                                                                                                                                                      |
| Money                            | **per-field scale, not one house style**: `tMontoBase` 23/8, `tMontoBase4` 19/4, `tMontoBase6` 10/4, `tTipoCambioBase` 9/4 and strictly positive, `tPorcDesc8` 11/8 bounded to 100, `tdTasaIVA` a 2-digit integer |
| Quantity                         | `tdCantProSer`: 18/8, bounded                                                                                                                                                                                     |
| Version                          | `dVerFor` and `tDVer`: a single digit; `dVerFor` is pinned to `150` by pattern                                                                                                                                    |

### Enumerations

§21.5 records the enumerations the emitted documents depend on, transcribed from
the schema: `tiTipEmi`, `tiTiDE`, `tiTipTra`, `tiCondOpe`, `tiTiPago`,
`tiAfecIVA`, `tiNatRec`, `tiNatVen`, `tiTipDoc`, `tiTipDocRec`, `tiIndPres`,
`tiTipCont`, `tiMotEmi`, `tiTImp`, `tiForProPa`, `tiDenTarj`, `tiTipIDRespDE`.

**What the schema does not give**: the _meaning_ of each value for the issuer.
The schema states which values are legal; the Manual Técnico's tables state what
each one means. The tables' contents are still unread (§19 question 7), so this
Story pins the allowed values and **must not invent semantics** for them.

## The decision this Story needs before its acceptance criterion is reachable

The acceptance criterion is "a DTE XML validates against the official XSD before
any submission", and the schemas are **copyrighted**. [[FISC-006]]'s domain
invariants forbid committing them: "the retrieved artifacts are evidence, not
vendored content".

So the validation strategy is a real decision, recorded as §19 question 9 and
left open on 2026-10-04:

1. **Fetch in a dedicated job.** A CI job downloads the three schemas and runs
   the validation suite against them; the suite skips when they are absent.
   Truest to "official XSD", at the cost of a network dependency in one job.
2. **Derive a local subset.** Commit a hand-written schema carrying only the
   constraints this system must satisfy, derived from and cited against the
   official one. No network, no vendoring — but it is our schema, not DNIT's, so
   it can drift and it proves less.
3. **Validate against the schemas where they are present**, i.e. option 1 with
   the skip made explicit and the run recorded as evidence rather than assumed.

**This Story must not start its validation implementation until that choice is
made**, because it determines the test architecture.

## In Scope

- The DE XML generator: `rDE` with its four children, `DE` with its eleven, in
  the schema's order, with `dVerFor` pinned to `150` and the CDC as the `DE`
  `Id`.
- Field-level conformance: the identity, numbering, date, money, quantity and
  enumeration rules pinned above, each traced to §21.
- Schema validation of the generated document, per the decision above.
- The CDC: its 44-character composition and its check digit (`dDVId`), built
  from the fields §13 pins (timbrado, establishment, expedition point, document
  type, number, series).
- The fixtures: a confirmed-invoice-to-DE fixture whose expected XML is pinned
  by the schema, not by a golden file written from our own output.

## Out of Scope

- **Signing.** XAdES, the signature profile and the `SIGNING` lifecycle state —
  [[FISC-009]]. This Story produces the unsigned `rDE` with the signature
  placeholder.
- **Timbrado and numbering ranges as tenant configuration** — [[FISC-011]]. This
  Story consumes the six-field sequence; it does not model where a tenant's
  ranges are stored or validated.
- **Any DNIT call, WSDL or SOAP action** — [[FISC-010]].
- **The provider selection** — [[FISC-012]].
- **KuDE rendering** — out of the epic's scope.
- **The Manual's table semantics.** The allowed values are pinned; what each
  value means for the issuer is not, and is not invented here.
- **Notas Técnicas 26 and 27.** Unretrieved. If one amends a validation rule,
  this Story's rules change with it, and that is recorded as a risk rather than
  assumed away.

## Acceptance Criteria

- [ ] The generator emits `rDE` with its four children in schema order, all
      required, `dVerFor` = 150.
- [ ] The generator emits `DE` with its eleven children in schema order, with
      the required/optional cardinality the schema pins (`gTotSub` and `gCamGen`
      optional, `gCamDEAsoc` `0..99`).
- [ ] The CDC is 44 characters and matches `tCDC`, and `dDVId` carries its check
      digit.
- [ ] Establishment and expedition point are zero-padded to three digits; the
      document number is exactly seven digits; the series matches `[A-Z]{2}`.
- [ ] `dFecFirma` matches `fecHhmmss` with no timezone suffix and no fractional
      seconds.
- [ ] Every monetary field carries the fraction digits its own type pins, and
      every quantity uses `tdCantProSer`'s scale.
- [ ] Every enumerated field carries a value the schema allows, and no value is
      emitted that §21.5 does not record.
- [ ] No validity date precedes 2018-05-01.
- [ ] The generated document **validates against the official XSD** under the
      strategy the maintainer chooses, and that validation runs in a gate.
- [ ] A malformed document fails that validation, so the gate is proven to
      discriminate rather than to pass everything.
- [ ] The generator is deterministic: the same invoice and the same clock
      produce byte-identical XML.
- [ ] No fiscal content is logged at CONFIDENTIAL or above (PRD §41).
- [ ] Lint, typecheck, unit tests, the live-PostgreSQL gate and the build pass.

## Domain Invariants

- **No protocol constant without a cited official source.** If §21 does not
  record a rule, this Story does not encode it.
- **The schemas are not vendored.** Citations and structural facts are recorded;
  DNIT's files are not committed.
- **The XML is built from the confirmed invoice**, not from a re-derived money
  snapshot: the invoice is immutable and the DE reads it through the existing
  boundary.
- **Money never becomes a float.** The decimals cross as strings with the scale
  their type pins.
- **The generator is pure with respect to its inputs**: no ambient clock, no
  ambient tenant, no I/O.

## API

```text
None. This Story adds no route.
```

## Database

```text
No migration. The DE is derived from a confirmed invoice and the tenant's
timbrado data; where that data is stored is FISC-011's scope.
```

## UI

- None.

## Implementation Summary

_Not implemented._ The contract is pinned; the validation strategy decision is
open and blocks the acceptance criterion, not the implementation of the
generator.

## Verification

```text
Not run.
```

## Tests Added

Planned, once the validation strategy is chosen:

- Schema conformance: the generated document validates against the official
  schema, and a deliberately malformed document does not.
- Child order: a document with the correct children in the wrong order is
  rejected.
- `dVerFor`: any value but 150 is rejected.
- CDC: length and pattern, including position 10's `A`–`D` range, and the check
  digit.
- Zero-padding and widths: establishment, expedition point, document number,
  series.
- Timestamp shape: no timezone suffix, no fractional seconds.
- Money scales: each monetary type's fraction digits, and the `tTipoCambioBase`
  strictly-positive bound.
- Enumeration bounds: a value outside each pinned enumeration is rejected.
- Determinism: identical inputs produce byte-identical output.

## Known Limitations

- **Notas Técnicas 26 and 27 are unretrieved.** NT 23/24/25 already changed
  validation rules, so a later note may change what this Story encodes.
- **The Manual's tables are unread**, so enumeration _semantics_ are not pinned
  — only the allowed values.
- **The validation strategy is undecided** (§19 question 9), so the acceptance
  criterion is not yet reachable.
- **The timbrado's storage model is not this Story's**, so the generator
  consumes a six-field sequence it does not own.

## Technical Debt

- None created by the pin. If the chosen validation strategy weakens the proof
  (option 2), that weakening is recorded as debt at that point rather than here.

## Decisions / ADRs

- No ADR is required for the generator: it encodes a cited protocol, which is an
  implementation of approved scope.
- **[[ADR-006]] belongs to [[FISC-009]]**, the signing dependency, and is not
  needed here.
- The validation strategy is a Decision, not an ADR, once chosen.

## Files / Modules

```text
packages/fiscal/src/dte/**            the generator and its types
docs/06-fiscal/SIFEN-BASELINE.md      §21 is the source of record for every rule
odd/tasks/epic-16-sifen-direct.md     the epic tracker
```

## Completion Notes

_Status must remain non-`done` until every acceptance criterion and gate
passes._
