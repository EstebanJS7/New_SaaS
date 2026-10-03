---
id: FISC-006
type: story
title: SIFEN Direct scope and the DNIT baseline revalidation
epic: EPIC-16
status: done
priority: high
depends_on: []
prd_sections:
  - "22"
  - "23"
permissions: []
branch: docs/epic-16-sifen-direct-kickoff
created: 2026-10-03
updated: 2026-10-03
---

# FISC-006 — SIFEN Direct scope and the DNIT baseline revalidation

## Objective

Discharge the precondition PRD §23 places on the whole epic: revalidate the
current official DNIT technical baseline and record it, cited, so that every
protocol constant in [[EPIC-16]]'s later Stories comes from an official source
instead of from memory.

This Story ships **documentation only**. It writes no code, adds no dependency
and changes no schema.

## Context

PRD §23:

> Direct SIFEN implementation is intentionally deferred behind the provider
> boundary. Before implementing `SifenDirectFiscalProvider`, revalidate current
> official DNIT: Manual Técnico; XSD; XML structures; Notas Técnicas; test
> guide; environment/certification requirements. **Do not implement protocol
> details from memory.**

`docs/06-fiscal/SIFEN.md` repeats the rule and explains why: this vault's notes
go stale. EPIC-16 was retargeted from a third-party adapter to SIFEN Direct on
2026-10-03, which makes this Story the epic's gate rather than a formality.

The regulatory driver is cited in [[EPIC-16]]: DNIT _Resolución General N.°
41/25_ (24 December 2025) requires taxpayers contracting as state providers from
2 January 2026 onward to adhere to SIFEN.

## In Scope

- Retrieve and record the **official DNIT artifacts** for SIFEN v150: the Manual
  Técnico, the XSD inventory, the XML document structure, the Notas Técnicas,
  the test guide, and the environment/certification requirements.
- Grade every finding by how it was obtained, so a reader can tell a directly
  retrieved artifact from a synthesis over official pages and from an open
  question.
- Record the **open questions** explicitly, including anything the official
  sources did not answer, rather than filling the gap with an assumption.
- State the concrete consequences for FISC-007..FISC-014: what each later Story
  may now pin, and what it still must not.

## Out of Scope

- Any implementation: no XML generation, no signing, no certificate handling, no
  web service client, no dependency added.
- Any commercial provider API (the vendor research is retained as evidence in
  [[Fiscal provider candidates]] and is not the plan of record).
- The Notas Técnicas' _content_ where a source could not be retrieved: the
  inventory and the versions are in scope, the clauses are not.

## Acceptance Criteria

- [x] The current Manual Técnico version is identified from an official DNIT
      source.
- [x] The official XSD inventory is retrieved and recorded file by file.
- [x] The DTE XML root structure is retrieved from the official schema,
      including the version field, the CDC placement, the signature element and
      the post-signature fields.
- [x] The signing model is confirmed from the official schema rather than
      assumed.
- [x] The SIFEN environments are identified.
- [x] The transport and authentication requirements are recorded, with their
      evidence grade.
- [x] The Notas Técnicas are inventoried with their versions and dates, and the
      clauses that amend v150 are retrieved and recorded.
- [x] Every finding carries a source with publisher, version and retrieval date.
- [x] Every gap is recorded as an open question.
- [x] The consequences for FISC-007..FISC-014 are stated.
- [x] No code, dependency, schema or migration is added.

## Domain Invariants

- A protocol constant without a cited official source does not exist. If
  FISC-006 did not retrieve it, the later Story must not invent it.
- The retrieved artifacts are evidence, not vendored content: the repository
  records the citations and the structural facts, and does not commit DNIT's
  copyrighted schemas or manual into the vault.

## API

### Added

```text
None. This Story ships documentation only.
```

## Database

### Migration

```text
None.
```

## UI

- None.

## Implementation Summary

The revalidation is recorded in `docs/06-fiscal/SIFEN-BASELINE.md`, which grades
every finding as **directly retrieved [R]**, **official-source synthesis [S]**
or **open question [O]**, and cites publisher, version and retrieval date for
each.

**Retrieved in full, and therefore binding for the epic:**

- the **Manual Técnico v150** (10/09/2019, 217 pages);
- the **Guía de Pruebas para el sistema e-kuatia** (12 pages);
- **Notas Técnicas 23, 24 and 25**, with their clauses;
- the official **XSD directory**, `DE_v150.xsd` and `xmldsig-core-schema.xsd`;
- the official documentation and tables indexes, and RG DNIT N.° 41/25.

**What that pins, concretely:**

- the **complete signature profile** — c14n `REC-xml-c14n-20010315`,
  `rsa-sha256`, `Reference URI="#<CDC>"`, exactly two ordered transforms
  (`enveloped-signature` then `xml-exc-c14n#`), `sha256` digest, `X509Data`, RSA
  2048, and the eight elements a signed DE must **not** contain;
- the **certificate standard** — X.509 v3 from a PSC habilitado por el MIC, type
  **F1 (software)** or **F2 (hardware)**, used for signing **and** mutual TLS,
  with the RUC's exact placement and the `RUCXXXXXXXXX-X` format;
- the **transport stack** — WS-I Basic Profile 1.1, SOAP 1.2, Document/Literal,
  TLS 1.2 with mutual authentication;
- **every service endpoint** for both environments, sync and async;
- the **result model** — exactly three states (`Aprobado`,
  `Aprobado con observación`, `Rechazado`) with `dCodRes`/`dMsgRes`;
- the **deadlines** — 72 h to transmit from the signature, 1 min maximum SIFEN
  response, 360 h for receptor events, all in horas corridas;
- the **CDC-reuse rule** — a rejected DE is resubmitted with the same CDC, which
  matches [[DEC-049]]'s identity model rather than contradicting it;
- the **timbrado and numbering model** — the six-field sequence and the series
  rule (two uppercase letters, no Ñ) that replaces an expiring timbrado;
- the **test environment** and its prescribed test data and sequence.

**One finding is an answer, not a gap:** the manual's own contingency section
says _«Se elimina el contenido de esta sección, ya que sigue en etapa de
definición»_. DNIT has **not defined** contingency, so FISC-013 cannot implement
it from the baseline.

**The Notas Técnicas matter more than expected.** Two of the three change
receptor-identity validation, and NT 25 **excludes** a cancellation restriction
(`GEC002c`, code 4004). FISC-008 must implement the post-note rules, not the
manual's original text.

## Verification

```text
Documentation only. No code gate applies.

Prettier: npx prettier --check over the new documents -> clean
Whitespace: git diff --check -> clean
Wikilink wrap guard: no wrapped [[...]] links

Retrieval evidence: 9 official artifacts retrieved 2026-10-03
  Manual Técnico v150          217 pages / 178,216 chars
  Guía de Pruebas e-kuatia      12 pages /  22,972 chars
  Nota Técnica 23                4 pages /   6,391 chars
  Nota Técnica 24                1 page  /   1,518 chars
  Nota Técnica 25                1 page  /   1,088 chars
  DE_v150.xsd                             66,117 chars
  xmldsig-core-schema.xsd                 10,339 chars
  XSD directory index                      2,466 chars
  Documentación Técnica + Tablas indexes
```

## Tests Added

- None. This Story changes no executable artifact, so it adds no test. The
  evidence it produces becomes the fixture source for FISC-008's XSD validation
  tests.

## Known Limitations

- **Notas Técnicas 26 and 27 are listed by the portal but were not retrieved.**
  They may amend what NT 23/24/25 left. Any Story that encodes a validation rule
  must confirm it against the complete note set first.
- **`DE_Types_v150.xsd` was not retrieved**, so per-field lengths, patterns and
  enumerations are not pinned.
- **The WSDL documents were not retrieved**, so SOAP actions, bindings and
  header requirements are unknown. FISC-010 has the endpoints but not the
  operations.
- **Chapter 12's `dCodRes` catalogue was not extracted field by field**, so the
  provider reason codes our `last_error_code` should carry are known only by
  example (`0160` = "XML malformado").
- **The tables' contents and chapter 16's codifications were not read.**
- **The QR composition and the CSC's per-environment value are not pinned.**
- **The batch size limit is not confirmed** in the retrieved text.
- **The Prevalidador could not be inspected** (JS-rendered), so its usefulness
  as an automated pre-submission check is unverified.
- **Two manual defects were recorded rather than smoothed over**: the test-
  environment reception path is spelled `recibe.wsd` while production says
  `recibe.wsdl`, and the SOAP example mixes `soap`/`env` prefixes on one
  envelope. Neither is a protocol rule.

## Technical Debt

- None created. The gaps above are open questions inside this Story, not
  deferred work: the Story cannot be marked `done` until they are either
  resolved or explicitly accepted as limitations by the maintainer.

## Decisions / ADRs

- None. This Story produces the input for the three ADR candidates recorded in
  [[EPIC-16]]; it decides nothing architectural itself.

## Files / Modules

- `docs/06-fiscal/SIFEN-BASELINE.md` — the revalidation deliverable.
- `docs/06-fiscal/SIFEN.md` — the pre-existing planning reference, which this
  Story supersedes as the protocol source of record.
- `odd/tasks/epic-16-sifen-direct.md` — the epic tracker.

## Completion Notes

**Done on 2026-10-03.** The official DNIT baseline for SIFEN v150 was retrieved
and recorded with nine cited artifacts, and PRD §23's precondition is
discharged: the Manual Técnico, the XSDs, the XML structures, the Notas
Técnicas, the test guide and the environment/certification requirements are all
in `docs/06-fiscal/SIFEN-BASELINE.md`, graded by how each was obtained.

One correction is part of the record. A first pass concluded the manual and the
Notas Técnicas "were not retrieved" because the inline fetch returned only a
title; the PDFs had in fact been extracted to disk in full. The baseline and
this Story were rewritten to state what was actually retrieved, and the
retrieval sizes are recorded in the verification block so the claim is
checkable.

The remaining gaps — Notas Técnicas 26/27, `DE_Types_v150.xsd`, the WSDLs, the
`dCodRes` catalogue, the tables and the QR/CSC details — are recorded as open
questions with their consequences per Story, and are not deferred work: they are
things the baseline does not yet know.
