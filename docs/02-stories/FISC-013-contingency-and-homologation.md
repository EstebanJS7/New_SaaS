---
id: FISC-013
type: story
title:
  Contingency and the certification evidence run — what the sources pin, and
  what only DNIT can give
epic: EPIC-16
status: planned
priority: high
depends_on:
  - FISC-012
prd_sections:
  - "22"
  - "23"
permissions: []
branch:
created: 2026-10-10
updated: 2026-10-10
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

1. **The runbook** (WU-A): the six steps, the requirements checklist, the test
   data's shape and the test matrix, written as the procedure an operator
   follows. It needs no credential to write, and it is what makes the real run
   short.
2. **The decisions the run forces**: where the CSC lives ([[DEC-057]] Q3), which
   environment the deployment targets, what the test data's placeholders are,
   and how the contingency flag is treated.
3. **The events** (WU-B): the profiling of `Evento_v150.xsd` and
   `Evento_Types_v150.xsd` — the same work [[FISC-016]] needs, on **public
   artifacts**, with no credential required. It unblocks the cancellation, the
   inutilización and the receptor's five events, and it is the homologation's
   own prerequisite.
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

_Provisional: pinned when the first one lands, which is [[FISC-012]]'s pattern._

**WU-A — the runbook and the decisions.** The procedure, the checklist, the test
data's shape and the matrix; the CSC's storage and environment ([[DEC-057]] Q3);
the contingency flag's treatment; and the record of what is pending from DNIT.

**WU-B — the events.** The profiling of the event schemas and the implementation
of the event the homologation requires (the inutilización), sharing
[[FISC-016]]'s profiling rather than repeating it.

**WU-C — the KuDE.** The graphical representation, one per document type, with
the QR already pinned by §24.

**WU-D — the run and its evidence.** The actual test matrix against the test
environment, recorded in `docs/10-qa/CI-EVIDENCE.md` with its outcome —
including a negative or pending one.

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
