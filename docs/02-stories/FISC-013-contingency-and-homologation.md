---
id: FISC-013
type: story
title:
  Contingency and the certification evidence run — what the sources pin, and
  what only DNIT can give
epic: EPIC-16
status: in-progress
priority: high
depends_on:
  - FISC-012
prd_sections:
  - "22"
  - "23"
permissions: []
branch: docs/epic-16-fisc-013-runbook
created: 2026-10-10
updated: 2026-10-13
---

# FISC-013 — contingency and the certification evidence run

## Objective

Turn the reviewed implementation into **evidence**: run the minimum tests the
DNIT's own guide requires in the test environment, and record the result —
including a negative or pending one. Its second half is contingency, and the
honest finding is that **DNIT has not defined a contingency protocol**, so what
this story can do is record the flag, the operational rules the sources _do_
pin, and the pending question.

## Context

A retrieval on 2026-10-10 read the two guides that govern this story, and they
answer most of what the epic's FISC-013 row left open.

**The habilitación is a procedure with six steps**, from the DNIT's own "Guía
paso a paso — Solicitud y Habilitación de Facturadores Electrónicos":

1. The taxpayer opens a **ticket** on the e-kuatia portal ("Contáctenos – Mesa
   de ayuda SIFEN") declaring the intention to be habilitado.
2. The DNIT **makes the test data available** and answers with the RUC, the test
   timbrado and the **generic CSC**.
3. The taxpayer accesses the **test environment** with the digital certificate.
4. The taxpayer runs the **minimum tests** of the Guía de Pruebas.
5. The taxpayer files the **Habilitación como Facturador Electrónico** in
   Marangatu (Form 364 v2), which requires an ACTIVE RUC, being up to date with
   tax obligations, Marangatu access, and the legal requirements of Decreto
   7795/17.
6. The DNIT **approves** and notifies through the Marandú mailbox.

And the conditions that follow: **the first document within six months** of
being habilitado, and **all documents electronically within twelve months** of
the first.

**The test environment's data set**, as the guide prints it: the test RUC, the
test timbrado, the start of validity, **one establishment** and **up to three
points of expedition**, the emitter's **real** registered data, a real
customer's data, a first item whose description must read _"DOCUMENTO
ELECTRÓNICO SIN VALOR COMERCIAL NI FISCAL - GENERADO EN AMBIENTE DE PRUEBA"_, a
**non-valid certificate** for the unauthorized-access test, and two CSC:

```text
IdCSC: 0001   CSC: ABCD0000000000000000000000000000
IdCSC: 0002   CSC: EFGH0000000000000000000000000000
```

The first of those is **the CSC the Manual's own QR example uses**, which is why
§24's worked example is reproducible with it.

**The minimum test matrix** (Guía de Pruebas, February 2026):

| Service                 | Scenario                                                                         | Minimum                                |
| ----------------------- | -------------------------------------------------------------------------------- | -------------------------------------- |
| Authentication          | mutual TLS against each of the seven services, with a **valid** certificate      | 1 per service                          |
| Authentication          | the same with a **non-valid** certificate                                        | recommended                            |
| Synchronous             | DE with correct data, per document type (FE, NCE, NDE, AFE, NRE)                 | **5 each**                             |
| Synchronous             | DE with incorrect data, per document type                                        | **5 each**                             |
| Asynchronous            | DE with correct data, per document type, **in one lot**                          | **5 each** (30–50 per lot recommended) |
| Asynchronous            | DE with incorrect data, per document type, in one lot                            | **5 each** (3–5 per lot recommended)   |
| Events, as **emitter**  | the **cancellation** event on any DE                                             | **5**                                  |
| Events, as **emitter**  | the **inutilización** event (voiding a number): 2 of FE, 1 each of NCE, NDE, AFE | **5**                                  |
| Events, as **receptor** | conformidad, disconformidad, desconocimiento, notificación de recepción, ajuste  | **3 each**                             |
| Query                   | each document type                                                               | 3 each                                 |
| KuDE                    | one graphical representation per document type                                   | 1 each                                 |
| KuDE                    | querying by QR, per document type                                                | 2 each                                 |

**The finding that changes the epic's plan.** The test matrix **requires the
events**: the cancellation event five times and the **inutilización** event five
times, both as the emitter. So the homologation cannot be completed by an
implementation that only issues — and [[FISC-016]] is not optional for this
story, it is on its critical path. The **inutilización** event is a _different_
event type from the cancellation, so it is either FISC-016's scope grown or a
story of its own.

**And the contingency, in the sources' own words.** The Manual §14 says of its
own contingency section:

> «Contingencia — Se elimina el contenido de esta sección, ya que sigue en etapa
> de definición»

and a table elsewhere marks "Contingencia (Futuro)". `SIFEN-BASELINE.md` §18
already records the consequence: there is **no protocol to implement**, and the
only contiguous fact is `dDesTipEmi = 2`, the flag that marks an emission as
contingent — which the DE model already carries (`dte.types.ts`'s
`dDesTipEmi: "Normal" | "Contingencia"`). What the sources _do_ pin
operationally is the KuDE: it is the printed representation, and it exists so a
document can be delivered while the system is unavailable.

## What this story can do before the epic closes

1. **The runbook** (WU-A): **landed 2026-10-13** at
   `docs/06-fiscal/SIFEN-HOMOLOGATION-RUNBOOK.md`. It needs no credential to
   write, and it is what makes the real run short.
2. **The decisions the run forces**: where the CSC lives ([[DEC-057]] Q3), which
   environment the deployment targets, what the test data's placeholders are,
   and how the contingency flag is treated.
3. **The events** (WU-B): the profiling of `Evento_v150.xsd` and
   `Evento_Types_v150.xsd` — the same work [[FISC-016]] needs, on **public
   artifacts**, with no credential required. It unblocks the cancellation, the
   inutilización and the receptor's five events, and it is the homologation's
   own prerequisite. **As landed**, the profiling answered the emitter's two
   payloads; the receptor's four have no builder and "ajuste" has no payload at
   all (see WU-B and the runbook's §4.4).
4. **The KuDE's generation**: one per document type, which is a rendering task
   with its own rules (the Manual's chapter 13 and the QR that §24 already
   pins).

## What this story cannot do without the DNIT

- **The habilitación itself** (steps 1, 2, 5 and 6) is an operator act: a
  ticket, an ACTIVE RUC up to date with its obligations, a certificate from a
  PSC, and the DNIT's approval.
- **The test run** (steps 3 and 4) needs the test environment's data set, which
  only the DNIT hands over.
- **The production CSC** is issued at the emitter's `ingreso`; the test one is
  generic and proves nothing about production.

## Work units

_Pinned by WU-A (2026-10-13), which is [[FISC-012]]'s pattern: the first one to
land fixes the list._

- [x] **WU-A — the runbook and the decisions.** Landed 2026-10-13. The procedure
      an operator follows, at `docs/06-fiscal/SIFEN-HOMOLOGATION-RUNBOOK.md`:
      the six steps with their performer, input, output and blocker; the
      requirements checklist; the test data's shape with the two generic CSCs
      and the production one's provenance; the matrix as a runnable checklist
      with what the repository does per row and what blocks it; the CSC's
      storage and environment ([[DEC-057]] Q3); the contingency flag's
      treatment; and the record of what is pending from DNIT. Its §5.5 lists the
      gaps the run exposes beyond the four decisions.
- [x] **WU-B — the events.** Landed by [[FISC-016]] rather than repeated here:
      the family is profiled in `SIFEN-BASELINE.md` §25, both emitter payloads
      are built and signed, the cancellation submits through the provider, and
      the inutilización has its own business surface. **The receptor's four
      payloads are still missing**, which is what five matrix rows need.
- [x] **WU-C — the KuDE.** Its profiling half **landed 2026-10-13** and was
      **completed 2026-10-15**: `SIFEN-BASELINE.md` §26 profiles the Manual's
      chapter 13 — the definition and what a KuDE is not, the characteristics
      and the content rule, the seven denominations with their pagination rules,
      the header/items/totals field map a renderer starts from, the **seven
      reference models read from the rasterized pages** (the four shapes they
      form, per-type), and what the chapter does not pin. **The renderer landed
      2026-10-15**: `packages/fiscal/src/kude/` builds the KuDE from
      `DteRequest` — the object `buildDteXml` serializes and the signer signs,
      so §13.2's content rule holds by construction — and renders it as a
      standalone printable HTML document, with the QR pinned by §24. Its bound
      is recorded in the status below: the assembly emits only the items under
      `gDtipDE`, so the sale condition, the cuotas, the motive, the per-rate IVA
      settlement and the AFE's and the NRE's own blocks are named absences
      rather than inventions. Three review advisories were [[TD-034]], now
      resolved; the review that approved those fixes raised four more, recorded
      as [[TD-035]].
- [ ] **WU-D — the run and its evidence.** The actual test matrix against the
      test environment, recorded in `docs/10-qa/CI-EVIDENCE.md` with its outcome
      — including a negative or pending one. Blocked on the DNIT (the
      habilitación and the test data set) and on the run blockers the runbook
      names: the CSC's registration surface, the batch composition, the
      synchronous and incorrect-data harnesses, and the receptor events.

## Out of scope

- **A contingency protocol.** DNIT has not defined one; this story records the
  flag and the pending question rather than inventing rules.
- **The document assembly** ([[FISC-015]]) and **the cancellation event**
  ([[FISC-016]]), which this story depends on rather than duplicates.

## Dependencies

- [[FISC-012]] — the adapter, the stage and the reconciliation, all reviewed and
  merged.
- [[FISC-015]] — the assembly, without which no DE can be built to send.
- [[FISC-016]] — the cancellation event, which the test matrix requires.
- **The operator's inputs**: a habilitación, a certificate from a PSC and the
  production CSC.

## Exit Criteria

- [ ] The runbook exists and names every step, requirement and test the sources
      pin, with its citation.
- [ ] The contingency flag's treatment is recorded, and the pending protocol is
      named as DNIT's rather than ours.
- [ ] The events the matrix requires are implemented and tested.
- [ ] The KuDE is generated for every document type the tenant issues.
- [ ] The test run's outcome is recorded in `docs/10-qa/CI-EVIDENCE.md`,
      including a negative or pending result.
- [ ] Lint/typecheck/tests/build green, `format-check` clean.

## Status

**Planned 2026-10-10.** Written from the retrieval above, which answered the
questions the epic's row left open and found that the test matrix requires the
events. Nothing is started: its first work unit is the runbook, and its last one
cannot begin until the DNIT hands over the habilitación and the test data.

**In progress 2026-10-13.** WU-A landed: the runbook exists, the story's work
units are pinned, and the four decisions carry their state. [[FISC-016]] closed
the events (WU-B). **The run itself (WU-D) is blocked** on the DNIT's
habilitación and test data set, and on the run blockers the runbook names — the
CSC's registration surface, the batch composition, the two harnesses with no
product surface, and the receptor events. WU-C, the KuDE, is **complete**: its
profiling half landed 2026-10-13 (`SIFEN-BASELINE.md` §26) and was completed
2026-10-15, when the seven reference models were read from the rasterized pages
and §26.4.6 was rewritten around them, and its renderer landed the same day in
`packages/fiscal/src/kude/`.

**What the renderer bound, and how the KuDE criterion is met as far as the
sources allow.** The builder reads the signed DE's own model, so a KuDE can only
show what the document carries. The assembly emits the items and nothing else
under `gDtipDE`, so the sale condition, the cuotas, the NCE's and the NDE's
motive, the per-rate IVA settlement and every one of the AFE's and the NRE's own
blocks are **named absences** — not blanks, and not inventions. A type code no
retrieved source profiles is refused rather than given a layout. That is the
honest reading of "the KuDE is generated for every document type the tenant
issues": the tenant issues the type its timbrado declares, and the renderer
serves the five §13.5 models while stating what each of them cannot show.
