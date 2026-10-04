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

### The receptor block — conditional, and a different enumeration

§22.3 of the baseline pins the receptor's identity as **conditional on two other
fields**, which no schema expresses:

```text
D201  iNatRec    1 = contribuyente, 2 = no contribuyente
D202  iTiOpe     1..4  (D202 = 3 B2G, D202 = 4 B2C)
D206  dRucRec    Obligatorio si D201 = 1 ; No informar si D201 = 2
D207  dDVRec     Obligatorio si existe D206  (algoritmo módulo 11)
D208  iTipIDRec  Obligatorio si D201 = 2 y D202 != 4 ; No informar si D201 = 1 o D202 = 4
                 1 Cédula paraguaya  2 Pasaporte  3 Cédula extranjera
                 4 Carnet de residencia  5 Innominado
                 6 Tarjeta Diplomática de exoneración fiscal  9 Otro
D209  dDTipIDRec Obligatorio si existe D208
D210  dNumIDRec  Obligatorio si D201 = 2 y D202 != 4 ; innominado se completa con 0
```

**The receptor enumeration is not the schema's `tiTipDoc`.** `DE_Types_v150.xsd`
restricts `tiTipDoc` to `[1-4]`; the Manual's receptor type adds `5 Innominado`,
`6 Tarjeta Diplomática de exoneración fiscal` and `9`, which is the schema's
`tiTipDocRec` (`[1-6]|9`). The generator uses the **receptor** enumeration for
`D208` and must not share one constant with the emitter's.

**A B2C document (`D202 = 4`) carries no identity document at all**, by the
`No informar` rule.

### The test-environment literal

`D105 dNomEmi` carries a rule no schema encodes and that homologation depends on
(§22.5):

> "En caso de ambiente de prueba, debe contener obligatoriamente el literal «DE
> generado en ambiente de prueba - sin valor comercial ni fiscal»"

The generator emits that literal as the emitter's name whenever it builds a
test-environment document. Without it the document is schema-valid and the test
environment rejects it.

### Enumerations

§21.5 records the enumerations the emitted documents depend on, transcribed from
the schema: `tiTipEmi`, `tiTiDE`, `tiTipTra`, `tiCondOpe`, `tiTiPago`,
`tiAfecIVA`, `tiNatRec`, `tiNatVen`, `tiTipDoc`, `tiTipDocRec`, `tiIndPres`,
`tiTipCont`, `tiMotEmi`, `tiTImp`, `tiForProPa`, `tiDenTarj`, `tiTipIDRespDE`.

**What the schema does not give**: the _meaning_ of each value for the issuer.
The schema states which values are legal; the Manual Técnico's tables state what
each one means. The tables' contents are still unread (§19 question 7), so this
Story pins the allowed values and **must not invent semantics** for them.

## The validation strategy — decided 2026-10-04

The acceptance criterion is "a DTE XML validates against the official XSD before
any submission", and the schemas are **copyrighted**: [[FISC-006]]'s domain
invariants forbid committing them. The maintainer chose **fetching them in a
dedicated CI job, with the evidence made mandatory** — §19 question 9 of
`SIFEN-BASELINE.md` is resolved by this section.

The shape, pinned:

1. **A dedicated CI job fetches the three official schemas** from
   `https://ekuatia.set.gov.py/sifen/xsd/` — `DE_v150.xsd`, `DE_Types_v150.xsd`,
   `xmldsig-core-schema.xsd` — into a job-local directory that is never
   committed and never cached across runs.
2. **The job asserts the fetch before it validates.** HTTP status and a minimum
   byte size per file, because a captive-portal HTML error page is a 200 with
   the wrong bytes. A fetch that does not produce all three schemas **fails the
   job**; it does not degrade to a skip.
3. **In that job the validation is required, not skippable.** The ordinary
   developer and local run skips the schema-validation suite when the schemas
   are absent, and that skip is explicit and visible. The dedicated job runs the
   same suite with the skip disabled, so **a green run can never be the product
   of having validated nothing**.
4. **The run is recorded in `docs/10-qa/CI-EVIDENCE.md`** with the run id, the
   revision, the three artifact sizes and the number of validation cases
   executed — so the claim "it validates against the official XSD" is checkable
   rather than asserted.
5. **A missing schema is a gate failure, not a silent pass.** Without (2) and
   (3) a green job would be indistinguishable from a job that validated nothing,
   which is the failure mode this option exists to prevent.

The rejected alternatives, and why:

- **Derive a local subset.** No network and no vendoring, but it is our schema,
  not DNIT's, so it can drift from the official constraints and it proves less
  than the thing the acceptance criterion names.
- **Fetch in the ordinary test run.** It would make every developer run and
  every unrelated CI job depend on DNIT being reachable, and a network failure
  would look like a code failure.

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
- **Four table contents** (`D113` distritos, `D115` ciudades, `D104` régimen,
  `D131` actividades económicas). The Manual states where they apply; their
  values are unread, so the generator cannot populate those fields from a
  validated catalogue yet.
- **The `dCodRes` catalogue**, which belongs to [[FISC-012]] rather than here.
- **NT 24's receptor amendment is inherited, not re-derived**: NT 24 changed
  `D208c` (code 1321) about the receptor's identity document type and a
  7,000,000 threshold. NT 26 and 27 do not touch it, so FISC-006's record stands
  and this Story implements the post-note rule.

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
- [ ] The receptor block follows its conditional rules: RUC and check digit when
      `D201 = 1`, an identity document when `D201 = 2` and `D202 != 4`, and
      **nothing** when `D202 = 4`.
- [ ] `D208` uses the receptor enumeration (`tiTipDocRec`, which includes
      `5 Innominado` and `6 Tarjeta Diplomática de exoneración fiscal`) and not
      the emitter's `tiTipDoc`.
- [ ] A test-environment document carries the exact literal "DE generado en
      ambiente de prueba - sin valor comercial ni fiscal" as the emitter's name.
- [ ] `dTiCam` is absent when the currency is PYG, and every item of a document
      carries the same currency.
- [ ] No B2G document is rejected for a missing `gCompPub`: NT 26 excluded those
      rules (§22.7).
- [ ] No validity date precedes 2018-05-01.
- [ ] A dedicated CI job fetches the three official schemas, asserts each fetch
      (HTTP status and a minimum size), and runs the schema-validation suite
      with the skip **disabled**, so a green run cannot be the product of
      validating nothing.
- [ ] The generated document validates against the official XSD in that job.
- [ ] A malformed document fails that validation, so the gate is proven to
      discriminate rather than to pass everything.
- [ ] The run is recorded in `docs/10-qa/CI-EVIDENCE.md` with the run id, the
      revision, the three artifact sizes and the number of validation cases
      executed.
- [ ] A fetch that does not produce all three schemas fails the job rather than
      degrading to a skip.
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

_Not implemented._ The contract is pinned and the validation strategy is
decided, so nothing blocks the implementation any more.

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

- **Four table contents are unread** (`D113` distritos, `D115` ciudades, `D104`
  régimen, `D131` actividades económicas), so the generator cannot populate
  those fields from a validated catalogue yet.
- **NT 24's receptor amendment is inherited, not re-derived** — see the note in
  "Out of Scope".
- **The validation gate depends on DNIT being reachable.** The dedicated job
  fetches the schemas from `ekuatia.set.gov.py`; if DNIT is down the job fails
  rather than skipping, which is deliberate but is a real external dependency of
  the gate.
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
