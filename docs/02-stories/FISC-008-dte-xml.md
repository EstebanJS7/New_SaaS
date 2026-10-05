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
updated: 2026-10-05
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

**§22.11 of the baseline pins the receptor's identity, not §22.3.** §22.3 is the
2019 Manual's text, and nine Notas Técnicas amend that block; §22.11 is the
consolidated version, with each rule quoted from the note that last set it. The
field conditions below are **the ones NT 023 last set**:

```text
D201  iNatRec    1 = contribuyente, 2 = no contribuyente
D202  iTiOpe     1..4  (D202 = 3 B2G, D202 = 4 B2C)
D206  dRucRec    Obligatorio si D201 = 1 ; No informar si D201 = 2
D207  dDVRec     Obligatorio si existe D206  (algoritmo módulo 11)
D208  iTipIDRec  Obligatorio si D201 = 2 y D202 != 4
                 No informar si D201 = 1        <- NT 023 REMOVED "o D202=4"
                 1 Cédula paraguaya  2 Pasaporte  3 Cédula extranjera
                 4 Carnet de residencia  5 Innominado
                 6 Tarjeta Diplomática de exoneración fiscal  9 Otro
D209  dDTipIDRec Obligatorio si existe D208
D210  dNumIDRec  Obligatorio si D201 = 2 y D202 != 4 ; No informar si D201 = 1
                 length 1-20 ; innominado se completa con 0
```

**The receptor enumeration is not the schema's `tiTipDoc`.** `DE_Types_v150.xsd`
restricts `tiTipDoc` to `[1-4]`; the Manual's receptor type adds `5 Innominado`,
`6 Tarjeta Diplomática de exoneración fiscal` and `9`, which is the schema's
`tiTipDocRec` (`[1-6]|9`). The generator uses the **receptor** enumeration for
`D208` and must not share one constant with the emitter's.

**The identity document is forbidden only when `D201 = 1`.** The Manual and NT
002 both read `No informar si D201 = 1 o D202=4`; NT 023 removed the second
half. What actually constrains `Innominado` by operation type are `D208b`/1319
and `D208f`/1333, not a blanket `D202 = 4` prohibition. **A B2C document
(`D202 = 4`) may therefore carry an identity document**, and a generator that
implemented §22.3's old clause would reject a document the current rules allow.

The validations in force, each with the note that last set it, are the seven in
§22.11: `D202`/1300, `D202b`/1332, `D208b`/1319, **`D208c`/1321 with the
7,000,000 threshold NT 024 set** (NT 021 had 35,000,000), `D208e`/1331 including
`C002 = 7`, `D208f`/1333 and `D210`/1314. NT 003 excluded `D219`/1324 and
`D223`/1327 in favour of field conditions.

### The DE's internal groups

`rDE` and `tDE` are pinned by §21.1 and §21.2, but the members _inside_ `tDE`'s
groups are pinned by §21.6, which records them from the same retrieved
`DE_v150.xsd`:

- `dCodSeg` lives in **`gOpeDE`**, which carries nothing else beyond the
  emission type, its description and two optional free-text fields.
- `gDatGralOpe` is the wrapper — `dFeEmiDE`, an optional `gOpeCom`, `gEmis` and
  `gDatRec` — and the receptor block is **`gDatRec`**, where `dRucRec`/`dDVRec`
  precede the identity-document triplet and `cPaisRec`/`dDesPaisRe` are
  required.
- `iCondOpe` and `iIndPres` are **not** in `gOpeCom`: they are
  document-type-specific (`gCamCond` and `gCamFE`).
- `gDtipDE`, `gTotSub`, `gCamGen` and `gCamDEAsoc` members are **not**
  transcribed, so the generator carries them as caller-supplied ordered elements
  rather than encoding a provisional area (§22.10).

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

The shape. **Items 1 and 4 were corrected on 2026-10-05** once the artifacts
were actually inspected: it is seven schemas, not three, and a hermetic run
needs the includes rewritten. The reasons are in baseline §21.7.

1. **A dedicated CI job fetches the seven official artifacts a full DE
   validation needs** from `https://ekuatia.set.gov.py/sifen/xsd/` — the three
   originally named (`DE_v150.xsd`, `DE_Types_v150.xsd`,
   `xmldsig-core-schema.xsd`) plus the four `DE_v150.xsd` includes by absolute
   URL (`Paises_v100.xsd`, `Departamentos_v141.xsd`, `Monedas_v150.xsd`,
   `Unidades_Medida_v141.xsd`) — into a job-local directory that is never
   committed and never cached across runs. The job then **rewrites the five
   absolute `schemaLocation`s** to file names, because otherwise the validator
   reaches DNIT at validation time and a co-located file is ignored: with the
   network blocked, compilation fails with
   `global component '{...}tCDC' not found`.
2. **The job asserts the fetch before it validates.** HTTP status and a minimum
   byte size per file, because a captive-portal HTML error page is a 200 with
   the wrong bytes; a schema-shape check catches what the size floor cannot. A
   fetch that does not produce all seven artifacts **fails the job**; it does
   not degrade to a skip.
3. **In that job the validation is required, not skippable.** The ordinary
   developer and local run skips the schema-validation suite when the schemas
   are absent, and that skip is explicit and visible — it names the directory
   and the command that prepares it. The dedicated job runs the same suite with
   the skip disabled, so **a green run can never be the product of having
   validated nothing**.
4. **The run is recorded in `docs/10-qa/CI-EVIDENCE.md`** with the run id, the
   revision, the artifact sizes and the number of validation cases executed — so
   the claim "it validates against the official XSD" is checkable rather than
   asserted.
5. **A missing schema is a gate failure, not a silent pass.** Without (2) and
   (3) a green job would be indistinguishable from a job that validated nothing,
   which is the failure mode this option exists to prevent.
6. **The validated document is addressed through a local five-line entry
   schema**, because `DE_v150.xsd` declares no top-level element: `<rDE>` is a
   `complexType`. The entry schema declares
   `<xs:element name="rDE" type="rDE"/>` and `xs:include`s DNIT's file, so every
   constraint is still DNIT's.
7. **The validated signature is structural, not cryptographic.** The XSD's
   `ds:SignatureType` requires `SignedInfo`, so the `<Signature/>` placeholder
   this Story emits is schema-invalid and an unsigned DE cannot pass. The
   fixture substitutes a block with the real structure and placeholder contents;
   the real signature is [[FISC-009]]'s.

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
- **The CDC as a validated input**, not as a composed value. §22.9 records that
  the Manual's §10.1 composition is a visual element the PDF extraction dropped
  and that the digit-verifier document's URL is dead, so the composition and the
  check-digit algorithm are **not pinned**. The generator validates the CDC
  against `tCDC` and carries `dDVId` as supplied; composing them is a separate
  concern that waits for a pinned algorithm.
- The security code `dCodSeg`, whose rules **are** fully pinned by §10.3: nine
  random digits, zero-padded, non-sequential, unrelated to the document or the
  issuer, and never equal to `dNumDoc`.
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
- **`Tabla 3 – Actividades Económicas` (`D131`)**. **`D104` left this list on
  2026-10-05**: the Manual's TABLA 1 prints all eight régimenes inline, and the
  earlier "references them but does not contain them" claim was wrong — it came
  from reading the chapter-10 rows that point at the tables, while chapter 15
  was invisible to the extractor (baseline §22.6). `D131` remains: the Manual
  prints a link and that target now returns an HTML portal shell, so the
  generator cannot validate `cActEco` against a catalogue yet. The **geography**
  tables are retrieved and are in scope: `D111` departamento, `D113` distrito
  and `D115` ciudad come from the official
  `CÓDIGO DE REFERENCIA GEOGRAFICA_NOVIEMBRE_2025` spreadsheet (18
  departamentos, 272 distritos unique nationally, 6,766 ciudades).
- **The rule text of Notas Técnicas 001–022.** All 27 notes (001–027) are
  retrieved and profiled in §22.10, and the four non-receptor areas were
  **transcribed on 2026-10-05** (§22.12–§22.14); what remains untranscribed is
  the notes whose only effect is on _events_ (NT 018's transport rules, NT 019,
  NT 027), which belong to [[FISC-010]]. **Eighteen touch DE fields and ten
  amend validations, and nine amend the receptor block alone** — `D200`, `D201`,
  `D202`, `D208`, `D210` — which is exactly the block this Story's contract pins
  from the 2019 Manual. The receptor block is **no longer provisional** (§22.11
  consolidates it); the non-receptor areas are, and they are the remaining
  reason WU-C is blocked.
- **The `dCodRes` catalogue**, which belongs to [[FISC-012]] rather than here.
- **NT 24's receptor amendment is inherited, not re-derived**: NT 24 changed
  `D208c` (code 1321) about the receptor's identity document type and a
  7,000,000 threshold. NT 26 and 27 do not touch it, so FISC-006's record stands
  and this Story implements the post-note rule.

## Acceptance Criteria

Work-unit boundaries, so a reader knows what is proven and what is not: **WU-A**
is the builder (`packages/fiscal/src/dte/**`), **WU-B** is the CI
schema-validation job, and **WU-C** is the invoice → request mapping, which is
blocked on the non-receptor notes' rule text.

### Satisfied by WU-A

- [x] The generator emits `rDE` with its four children in schema order, all
      required, `dVerFor` = 150. _(`dte.builder.test.ts`: structure)_
- [x] The generator emits `DE` with its eleven children in schema order, with
      the required/optional cardinality the schema pins (`gTotSub` and `gCamGen`
      optional, `gCamDEAsoc` `0..99`).
- [x] The CDC is validated as 44 characters matching `tCDC`, and `dDVId` is
      carried as supplied. **The generator does not compose the CDC nor compute
      its check digit**, because §22.9 records that neither algorithm is pinned.
- [x] Establishment and expedition point are zero-padded to three digits; the
      document number is exactly seven digits; the series matches `[A-Z]{2}`.
- [x] `dFecFirma` matches `fecHhmmss` with no timezone suffix and no fractional
      seconds. The same rule is enforced on `dFeEmiDE`.
- [x] Every monetary field carries the fraction digits its own type pins, and
      every quantity uses `tdCantProSer`'s scale: `tMontoBase` 23/8,
      `tMontoBase4` 19/4, `tMontoBase6` 10/4, `tTipoCambioBase` 9/4 strictly
      positive, `tPorcDesc8` 11/8 bounded to 100, `tdTasaIVA` a 2-digit integer.
      Money crosses as a string and is never parsed into a float: the bound and
      threshold comparisons use exact decimal arithmetic over digit strings.
- [x] Every enumerated field carries a value the schema allows, and no value is
      emitted that §21.5 does not record.
- [x] The receptor block follows §22.11's consolidated rules, not §22.3's: RUC
      and check digit when `D201 = 1`, an identity document when `D201 = 2` and
      `D202 != 4`, and the identity document forbidden **only** when `D201 = 1`.
- [x] `D208` uses the receptor enumeration (`tiTipDocRec`, which includes
      `5 Innominado` and `6 Tarjeta Diplomática de exoneración fiscal`) and not
      the emitter's `tiTipDoc`.
- [x] A test-environment document carries the exact literal "DE generado en
      ambiente de prueba - sin valor comercial ni fiscal" as the emitter's name.
      The literal is required in `test` and not imposed in `production`.
- [x] The receptor validations are enforced: `D202` (1300), `D202b` (1332),
      `D208b` (1319), `D208c` (1321) with the **7,000,000** threshold NT 024
      set, `D208e` (1331) including `C002 = 7`, `D208f` (1333) and `D210`
      (1314).
- [x] `dTiCam` is absent when the currency is PYG, and obligatory when
      `dCondTiCam = 1` for any other currency (§22.4).
- [x] No B2G document is rejected for a missing `gCompPub`: NT 26 excluded those
      rules (§22.7). The generator encodes no `gCompPub` requirement at all.
- [x] No validity date precedes 2018-05-01.
- [x] The generator is deterministic: the same request produces byte-identical
      XML. It has no ambient clock and no randomness, which is why `dFecFirma`
      and `dCodSeg` enter as validated input rather than being generated here.
- [x] No fiscal content is logged at CONFIDENTIAL or above (PRD §41). The
      builder has no logger.

### Rewritten — WU-B (the CI schema-validation job), approved 2026-10-05

The original wording said the job "fetches the three official schemas" and that
"the generated document validates against the official XSD". Both were **checked
against the published artifacts and both were wrong**: it is seven artifacts,
not three, and an _unsigned_ DE cannot validate at all. The maintainer approved
the rewrite below, and the reasons are in baseline §21.7.

- [x] `dCodSeg` is nine random digits, zero-padded, non-sequential, unrelated to
      the document and the issuer, and never equal to `dNumDoc`. **WU-A enforces
      every decidable part** (nine digits, value ≥ 1, never equal to `dNumDoc`,
      zero-padding accepted) **and does not generate it**: randomness inside the
      builder would break the determinism criterion above. The generator belongs
      where a random source exists — still open.
- [x] A dedicated CI job fetches **the seven official artifacts a full DE
      validation needs** — the three originally named plus `Paises_v100.xsd`,
      `Departamentos_v141.xsd`, `Monedas_v150.xsd` and
      `Unidades_Medida_v141.xsd`, which `DE_v150.xsd` `xs:include`s — asserts
      **each** fetch by HTTP status **and** a minimum byte size, and runs the
      schema-validation suite with the skip **disabled**, so a green run cannot
      be the product of validating nothing. _(`fetch-dte-schemas.mjs`, the
      `xsd-validation` job)_
- [x] The prepared directory is **hermetic**: the five absolute
      `schemaLocation`s in the fetched `DE_v150.xsd` are rewritten to file
      names, and a directory that still resolves anything over HTTP is refused
      rather than validated. Proven by running the suite with the network
      blocked.
- [x] The generated document validates against the official XSD in that job,
      **through a local five-line entry schema** that declares
      `<xs:element name="rDE" type="rDE"/>` — necessary because `DE_v150.xsd`
      declares no top-level element — and with a signature block that is
      structurally complete while its contents are placeholders, because
      `ds:SignatureType` requires `SignedInfo` and the real signature is
      [[FISC-009]]'s.
- [x] A malformed document fails that validation, so the gate is proven to
      discriminate rather than to pass everything. Four negative cases: a
      version other than `150`, the right children in the wrong order, the
      unsigned `<Signature/>` placeholder, and a directory that cannot be used.
- [x] A fetch that does not produce all seven schemas fails the job rather than
      degrading to a skip, and the assertion is itself tested without a network:
      a captive-portal HTML page, a short body, a non-200 status and a schema of
      the wrong namespace each fail.
- [ ] The run is recorded in `docs/10-qa/CI-EVIDENCE.md` with the run id, the
      revision, the artifact sizes and the number of validation cases executed.
      **Recorded locally** (seven sizes, 100 cases, the hermetic proof); the CI
      run id follows the push and the PR, which the maintainer owns.
- [x] Lint, typecheck, unit tests, the live-PostgreSQL gate and the build pass.

### Open — WU-C (the invoice → request mapping)

- [ ] `dTiCam` is absent when the currency is PYG, and **every item of a
      document carries the same currency**. The PYG half is enforced; the
      per-item half cannot be until an item model exists, because `gCamItem` is
      one of the groups whose members §21.6 records as untranscribed.
- [ ] Lint, typecheck, unit tests, the live-PostgreSQL gate and the build pass.

## Domain Invariants

- **No protocol constant without a cited official source.**
- **The receptor block is implemented from §22.11, not from §22.3.** §22.3 is
  the 2019 Manual's text, and nine Notas Técnicas amend that block; §22.11 is
  the consolidated version with each rule quoted from the note that last set it.
  **The generator must never read §22.3 for a receptor condition.**
- **§22.3's `No informar si D201 = 1 o D202=4` clause is superseded.** NT 023
  (27/08/2024) removed the `o D202=4` half, so the receptor's identity document
  is forbidden only when the receptor is a contributor. Implementing the old
  clause would reject a B2C document the current rules allow.
- **If §21 or §22.11 does not record a rule, this Story does not encode it.**
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

**WU-A — the builder — is implemented.** `packages/fiscal/src/dte/**` holds the
pure `typed request -> XML string` function and its validators:

```text
dte.types.ts    the request, the pinned enumerations and the quoted constants
dte.rules.ts    DteValidationError + assertValidDteRequest, one rule per cited section
dte.builder.ts  buildDteXml(request): string  — no clock, no randomness, no I/O
dte.builder.test.ts  22 cases over the sections this Story pins
```

The public surface is exported from `packages/fiscal/src/index.ts`.

**Structure.** `rDE`'s four children and `DE`'s eleven are emitted in schema
order, `dVerFor` is the literal `150`, `dSisFact` is `1`, the `<Signature>`
placeholder carries the xmldsig namespace on its own tag, and `gCamFuFD` is
emitted outside `</DE>`. The internal groups follow §21.6, which is why
`dCodSeg` sits inside `gOpeDE` and the receptor block inside `gDatGralOpe >`
`gDatRec`.

**The receptor is §22.11.** `D208`'s obligation is enforced for `D201 = 2` with
`D202 != 4`, the identity document is forbidden **only** when `D201 = 1` — so a
B2C document carrying one is accepted, which §22.3's old clause would have
rejected — and the seven validations (`1300`, `1332`, `1319`, `1321`, `1331`,
`1333`, `1314`) are enforced with NT 024's 7,000,000 threshold.

**What is deliberately not here.** The CDC is validated and `dDVId` is carried
as supplied (§22.9). `dCodSeg` is validated, never generated. `gDtipDE`,
`gTotSub`, `gCamGen` and `gCamDEAsoc` are caller-supplied ordered element trees,
because their members are not transcribed and §22.10 marks those areas
provisional.

**WU-B — the validation gate — is implemented.** The acceptance criterion is now
checkable rather than asserted:

```text
packages/fiscal/src/dte/xsd-artifacts.ts      the seven artifacts, the assertions, the rewrite
packages/fiscal/src/dte/xsd-validator.ts      the entry schema and libxml2 validation
packages/fiscal/src/dte/dte.fixture.ts        the schema-valid request + structural signature
packages/fiscal/src/dte/xsd-artifacts.test.ts 9 cases, no network
packages/fiscal/src/dte/xsd-validation.test.ts 7 cases, network-free when prepared
packages/fiscal/scripts/fetch-dte-schemas.mjs the CI/local preparation CLI
.github/workflows/ci.yml                      the dedicated `xsd-validation` job
```

The tooling is exported from `@newsaas/fiscal/testing`, not from the package
index: it is scaffolding, and the prepared schemas are copyrighted artifacts
that are never committed.

**Two corrections to this Story's own wording came out of building it**, both
verified against the published artifacts and both recorded in baseline §21.7:
**it is seven schemas, not three** (`DE_v150.xsd` includes four companion tables
and `DE_Types_v150.xsd`), and **an unsigned DE cannot validate at all**, because
`ds:SignatureType` requires `SignedInfo`. The maintainer approved the rewrite.

**Not this work unit.** The invoice → request mapping is WU-C and remains
blocked.

## Verification

```text
WU-A + WU-B on feat/epic-16-fisc-008-dte-xml, 2026-10-05:

  pnpm fetch:dte-schemas /tmp/dte-xsd-live
    -> 7 official schemas fetched, sizes matching the 2026-10-04 retrieval
    -> 5 absolute includes rewritten; 0 absolute URLs left in DE_v150.xsd

  DTE_XSD_DIR=/tmp/dte-xsd-live DTE_XSD_REQUIRED=1 pnpm --filter @newsaas/fiscal test
    -> 100 passed / 100 (30 of them new in WU-B), schema-validation suite RUNNING

  same run with HTTP(S)_PROXY pointed at a dead port
    -> 100 passed / 100: validation is hermetic, no network at validation time

  no DTE_XSD_DIR (schemas absent, skip allowed)
    -> 93 passed, 7 skipped, title names the directory and the preparing command

  DTE_XSD_REQUIRED=1 with no schemas
    -> FAILS, naming all seven missing artifacts

  pnpm --filter @newsaas/fiscal lint       pass
  pnpm --filter @newsaas/fiscal typecheck  pass
  pnpm --filter @newsaas/fiscal test       84 passed / 84 (22 of them new)
  pnpm --filter @newsaas/fiscal build      pass

  pnpm format-check                        pass (whole repo)
  pnpm lint                                pass (18/18)
  pnpm typecheck                           pass (18/18)
  pnpm test                                pass (19/19; API 1107 passed, live-PG skipped)
  pnpm build                               pass (11/11)
  pnpm --filter @newsaas/api test:live-pg  213 passed / 213 (live PostgreSQL)

  Not run: the XSD-validation suite and its CI job — that is WU-B.
```

## Tests Added

WU-A adds 22 cases in `packages/fiscal/src/dte/dte.builder.test.ts`:

- Child order for `rDE` and `DE`, and that `DE` closes before the signature
  placeholder and before `gCamFuFD`.
- Schema order inside `gOpeDE`, `gTimb`, `gOpeCom`, `gEmis` and `gDatRec`.
- CDC: length and pattern, including position 10's `A`–`D` range, and that
  `dDVId` is carried verbatim rather than computed.
- `dCodSeg`: nine digits, value ≥ 1, accepted zero-padding, and rejection when
  it equals `dNumDoc`.
- Widths and shapes: `dEst`, `dPunExp`, `dNumDoc`, `dNumTim`, `dSerieNum`, and
  the 2018-05-01 lower bound on `dFeIniT`.
- Timestamp shape on `dFecFirma` and `dFeEmiDE`: no timezone, no fractional
  seconds.
- Money scales per type, the `tTipoCambioBase` strictly-positive bound, the
  `tPorcDesc8` ≤ 100 bound, `tdCantProSer`, and the integer-only `tdTasaIVA`.
- Currency: `dTiCam` absent for PYG, obligatory for `dCondTiCam = 1` otherwise.
- The receptor block: RUC + DV for a contributor; identity document forbidden
  for `D201 = 1`; accepted for B2C; required for `D202 != 4`; `tiTipDocRec`
  admitting 5 and 6 and rejecting 7; `D202`, `D202b`, `D208b`, `D208c` (both
  sides of 7,000,000 and the `iTipTra = 13` escape), `D208e` and `D208f`.
- B2G without `gCompPub` is not rejected.
- The test-environment literal, required in `test` and not imposed in
  `production`.
- Enumeration bounds outside §21.5, `gActEco` 1..9 and `gCamDEAsoc` 0..99.
- Determinism and XML escaping.

WU-B adds 16 more, in two files:

`xsd-artifacts.test.ts` (9, **no network** — the assertion that makes a green
run meaningful is itself tested):

- The artifact list is exactly the seven names, and each recorded size is above
  its floor.
- A real schema body is accepted; a captive-portal HTML page is rejected.
- A short body is rejected on size and a non-200 on status; a schema of the
  wrong namespace is rejected as not a schema.
- Absolute includes are rewritten, a relative one is left alone, and a document
  that still resolves anything over HTTP is refused.
- A complete fetch prepares all seven artifacts and a usable directory; **one
  missing artifact fails the whole preparation** and leaves no usable directory
  behind.
- An unprepared directory is reported unusable with the missing names, and a
  directory whose entry schema was never rewritten is flagged.

`xsd-validation.test.ts` (7, network-free once prepared):

- The prepared directory holds all seven artifacts.
- **The built document validates against the official XSD**, once the signature
  block is structurally complete.
- **It does not validate with the unsigned `<Signature/>` placeholder** — the
  error names the signature, which is why [[FISC-009]] exists.
- A version other than `150` fails, and so does the right children in the wrong
  order — proven by the schema rather than by string position.
- A B2C receptor carrying an identity document is **both accepted by §22.11 and
  schema-valid**, which §22.3's old clause would have refused.
- An unusable directory is refused instead of reporting a pass.

## Known Limitations

- **`D104` régimen is retrieved; `D131` actividades económicas is not.** TABLA 1
  prints all eight régimenes inline (baseline §22.6), so `D104` is no longer a
  limitation. **`D131` still is**: the Manual prints a link whose target now
  returns an HTML portal shell. **WU-A validates `cActEco`'s shape
  (`[0-9A-Z]{1,8}`, `1..9` occurrences) and does not validate its values against
  a catalogue**, which is the honest half of the constraint.
- **The non-receptor DE rules are transcribed but not implemented.** Currency
  and exchange, titles/transaction type, affected obligations and items were
  read from the 2019 Manual and amended by later notes; **their rule text is now
  recorded** in baseline §22.12, §22.13 and §22.14. What is missing is the code:
  §22.14's per-item IVA formulas and §22.13's `D031`/`D032` catalogue are not
  encoded, and the currency rules in §22.12 are only partly enforced. **This is
  WU-C's substance**, and it is no longer a retrieval gap — it is work.
- **`D208c` is enforced more coarsely than §22.12 records it.** The note text
  selects the field by currency — `F023` when `D015 != PYG`, `F014` when
  `D015 = PYG` — and NT 008 adds that `F023` must not be informed at all for a
  PYG document. The builder compares a single supplied `totalGuaranies` and only
  when the caller supplies it, so **a PYG document is not checked against its
  operation total, and the "`F023` must not exist for PYG" rule is not
  enforced**. Recorded as a correction to make against the newly transcribed
  rule, not silently left.
- **`D206`/`D207` are enforced from §22.11's identification model, and the
  converse is not.** A contributor receptor (`D201 = 1`) must carry `dRucRec`
  and `dDVRec`, and must not carry an identity document. The reverse — refusing
  a RUC on a non-contributor — comes from §22.3's `No informar si D201 = 2`
  clause, which §22.11 does not restate and NT 020 (the note that touched
  `D206`) does not have its rule text transcribed for. **So a non-contributor
  receptor carrying a RUC is emitted rather than refused**, by the rule "if §21
  or §22.11 does not record a rule, do not encode it". Closing it needs NT 020's
  text, the same work WU-C waits on.
- **Description fields (`dDesTipTra`, `dDesTImp`, `dDesIndPres`, the geography
  descriptions, `dDTipIDRec`) are not constrained to their XSD enumerations.**
  `tdDes*` values are the Manual's tables' to explain and §21.5 transcribes
  several of them abbreviated, so only the _code_ enums are enforced. A pairing
  such as `iTipIDRec = 5` ⇒ `dDTipIDRec` = "Innominado" is **not** validated,
  because neither §21 nor §22.11 states that mapping.
- **The structural contract is unaffected.** The notes amend observations and
  validations, not `DE_v150.xsd`/`DE_Types_v150.xsd`, so the `rDE`/`tDE`
  structure, the child order, the patterns and the money scales this Story pins
  remain current.
- **NT 24's receptor amendment is inherited, not re-derived** — see the note in
  "Out of Scope".
- **The CDC is not composed here, and the reason changed on 2026-10-05.** Its
  **composition is now pinned** (§22.9): it is a picture of a table on the
  Manual's page 56, recovered by rendering the page, and the Manual's worked
  example decomposes into exactly those widths and matches the KuDE specimen
  byte for byte. What is still unpinned is **the check digit**: §10.2 names
  `módulo 11`, the verifier document's URL now serves the portal's HTML shell,
  and the Manual plus all 27 notes contain **one usable specimen** — enough to
  show that a plain-sum variant reproduces it and the RUC-style weighting does
  not, but not enough to fix a variant. So this Story validates a supplied CDC
  instead of minting one, because composing it would publish a document identity
  whose check digit cannot be verified, and the Manual's §6.5 requires a
  rejected DE to be resubmitted with the **same** CDC. The cheapest fix is a
  second specimen: chapter 13's KuDE examples are graphics too, so rendering
  those pages the same way is the next attempt.
- **The validation gate depends on DNIT being reachable — once, at fetch time.**
  The dedicated job fetches the schemas from `ekuatia.set.gov.py`; if DNIT is
  down the job fails rather than skipping, which is deliberate but is a real
  external dependency of the gate. **Validation itself is hermetic**: the five
  absolute includes are rewritten to file names and the suite passes with the
  network blocked, so DNIT being unreachable cannot make the validation half of
  the job behave differently from the fetch half.
- **The validated signature block is structural, not cryptographic.** The gate
  cannot validate a document with the `<Signature/>` placeholder this Story
  emits, because `ds:SignatureType` requires `SignedInfo`; the fixture
  substitutes the real structure with base64-valid placeholder contents. The
  gate therefore proves the _document_ is schema-valid given a well-formed
  signature, and producing that signature is [[FISC-009]]'s. Recorded rather
  than papered over.
- **The entry point is a local five-line schema, not DNIT's.** `DE_v150.xsd`
  declares no top-level element, so `<rDE>` has to be made addressable. The
  entry schema declares nothing but the element and includes DNIT's file; a
  reviewer who wants zero of our XSD can use DNIT's container protocol instead,
  at the cost of validating a wrapper the sender does not send.
- **The item area is supplied by the fixture, not by a typed group.** The XSD
  requires only `dCodInt`, `dDesProSer`, `cUniMed`, `dDesUniMed` and
  `dCantProSer` inside `gCamItem`, so the fixture supplies exactly those; the
  Manual's conditional rules for items remain provisional per §22.10, and the
  mapping from a confirmed invoice is WU-C's blocked work.
- **`libxmljs2` is a native devDependency**, added on 2026-10-05 with the
  maintainer's approval because a pure-JS validator would be a weaker engine and
  a system `xmllint` would add a second reason for the suite to skip. It is
  test-only: nothing in the package's production surface imports it.
- **The timbrado's storage model is not this Story's**, so the generator
  consumes a six-field sequence it does not own.

## Technical Debt

- **[[TD-032]]** carries WU-B's eight non-blocking review advisories, with the
  fetch having no timeout and no retry first in line.
- None created by WU-A. The two gaps WU-A deliberately leaves open — a `dCodSeg`
  generator and the `D206` converse — are recorded above as known limitations
  with the source that would close each, not as debt.
- If the chosen validation strategy weakens the proof (option 2 of the
  strategy), that weakening is recorded as debt at that point rather than here.

## Review Record — WU-A

Native review `review-5f02ddd057fd6758`, tier **medium**, one lens
(`review-reliability`), 8 changed files and 2201 original changed lines against
base tree `5cd215f3`. **Closed `approved`**, and the acknowledgement burned its
authority; delivery stays ordinary repository policy.

Two **non-blocking** findings were recorded, both `WARNING` and both
`informational` — neither opened a correction and neither reopens the review:

| Id           | Lens        | Location                                             |
| ------------ | ----------- | ---------------------------------------------------- |
| `R3-D208C`   | reliability | `dte.rules.ts:444-455` (the `D208c` threshold check) |
| `R3-DCODSEG` | reliability | `dte.rules.ts:216-224` (the `dCodSeg` check)         |

Both locations are the two gaps this Story already records as known limitations,
which is consistent with the findings being informational rather than blocking.
**The reviewer's own message text is not reproduced here**: the lineage's
authority was burned by its acknowledgement and its detail is no longer
retrievable, so the finding identity, lens, severity, disposition and location
are recorded rather than a paraphrase that would be ours, not theirs.

## Review Record — WU-B

Native review `review-7a00fe71a5c544dd`, tier **high** (the CI job trips
`shell_source`), **four lenses** (`risk`, `resilience`, `readability`,
`reliability`), 16 changed files and 2129 original changed lines against base
tree `554f456b`. It closed in two steps.

**One `CRITICAL` and one bounded correction.** `R2-control-flow` (`readability`,
`deterministic`, `introduced`) claimed that `inspectDteSchemas` records a
missing artifact without avoiding the following size check, so `contents` would
be read unassigned and the function would throw on the first absent file —
breaking the explicit skip path. **That premise did not reproduce**: the
`continue` was present in the frozen candidate, TypeScript strict mode rejects
an unassigned use outright, and two cases already exercised the path. The
correction landed anyway, in `580de4a`, because the flagged construct — a
`continue` inside a `catch` — is exactly what got misread: `contents` is now a
`const` of a never-throwing read, narrowed by an explicit guard before any use.
A case was added beside it: removing one artifact and shrinking another must
report **both**. 32 diff lines, inside the 200-line budget. The targeted
validator admitted the correction and the review then closed `approved`.

**Eight non-blocking findings**, all recorded in [[TD-032]]: three `WARNING`
(`R3-001`, `R4-fetch-no-retry-timeout`, and `R2-evidence-count`), five
`SUGGESTION`, none of which opened a correction. **One of them caught a factual
error in this Story's own evidence**: the CI record claimed 30 new cases for
WU-B when 22 of those are WU-A's; the real figure is 16, and the file is
corrected. The most substantive remaining one is the fetch having no timeout and
no retry, which is the first item in [[TD-032]]. The reviewer's prose is not
reproduced here, for the same reason as above: a lineage's detail is gone once
its authority is burned.

## Decisions / ADRs

- No ADR is required for the generator: it encodes a cited protocol, which is an
  implementation of approved scope.
- **[[ADR-006]] belongs to [[FISC-009]]**, the signing dependency, and is not
  needed here.
- The validation strategy is a Decision, not an ADR, once chosen.
- **WU-A added §21.6 to `SIFEN-BASELINE.md`.** The generator needs the members
  of `tDE`'s internal groups, and §21.2 only recorded `rDE` and `tDE`'s
  top-level children. Rather than infer group membership, the same retrieved
  `DE_v150.xsd` was re-read and its groups transcribed, so every structure the
  builder emits cites the vault rather than an assumption. §21.6 states which
  groups remain untranscribed.

## Files / Modules

```text
packages/fiscal/src/dte/dte.types.ts        the typed request and its constants
packages/fiscal/src/dte/dte.rules.ts        the validators, one rule per cited section
packages/fiscal/src/dte/dte.builder.ts      buildDteXml(request): string
packages/fiscal/src/dte/dte.builder.test.ts
packages/fiscal/src/dte/xsd-artifacts.ts    the seven artifacts, assertions, include rewrite
packages/fiscal/src/dte/xsd-artifacts.test.ts
packages/fiscal/src/dte/xsd-validator.ts    the entry schema + libxml2 validation
packages/fiscal/src/dte/xsd-validation.test.ts
packages/fiscal/src/dte/dte.fixture.ts      the schema-valid fixture + structural signature
packages/fiscal/src/index.ts                the package's public surface
packages/fiscal/src/testing.ts              the scaffolding surface
packages/fiscal/scripts/fetch-dte-schemas.mjs .github/workflows/ci.yml (xsd-validation)
pnpm-workspace.yaml                         allowBuilds: libxmljs2
docs/06-fiscal/SIFEN-BASELINE.md            §21.5 enumerations, §21.6 the internal groups,
                                            §21.7 what validating requires,
                                            §22.9 the CDC/dCodSeg, §22.11 the receptor
docs/10-qa/CI-EVIDENCE.md                   the WU-B gate record
odd/tasks/epic-16-sifen-direct.md           the epic tracker, T4
```

## Completion Notes

_Status must remain non-`done` until every acceptance criterion and gate
passes._ WU-A and WU-B are implemented, gated and review-approved; **WU-C
remains blocked**, so the Story stays `in-progress`.

**WU-C's blocker list was re-derived on 2026-10-05** by a read-only
investigation, and two of the three items on it were wrong:

- **`D104` is not blocked.** The Manual's TABLA 1 prints all eight régimenes
  inline (baseline §22.6); the earlier "references but does not contain" claim
  came from a PDF extractor that dropped chapter 15's tables.
- **The CDC's composition is not blocked.** It is a picture of a table on page
  56, recovered by rendering the page; the Manual's worked example decomposes
  into exactly those widths and matches the KuDE specimen byte for byte (§22.9).
  Only the **check digit** remains open.
- **The non-receptor notes are not blocked, they are untranscribed.** The
  material is already on disk: the eight relevant notes total ~18 KB of
  extracted text.
- **And there is a blocker that was not on the list**: the emitter fiscal
  profile and the timbrado. A confirmed invoice supplies lines, currency,
  `confirmedAt` and the customer; it supplies **none** of the emitter identity,
  the timbrado sequence, coded geography, the unit of measure, currency
  descriptions or the exchange rate. No model holds them and no story owns them,
  so WU-C is re-scoped to take a **supplied** emitter/timbrado profile as an
  input — the same seam the CDC uses — and where that profile is stored is a
  decision that is recorded as a proposal, not taken here.
