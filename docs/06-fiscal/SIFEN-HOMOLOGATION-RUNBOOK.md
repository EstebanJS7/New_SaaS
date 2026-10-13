---
type: fiscal-runbook
status: active
country: PY
manual_version: "150"
verified: 2026-10-13
updated: 2026-10-13
---

# SIFEN homologation runbook

The procedure an operator follows to take this product through the DNIT's
habilitación as an electronic issuer (_facturador electrónico_) and through the
minimum test run the DNIT's own test guide prescribes.

Three documents cover this subject and none of them is this one:

- `SIFEN-BASELINE.md` is the **protocol record**. Every constant the epic
  encodes traces to a finding there, and a constant that is not there must not
  be written.
- `docs/02-stories/FISC-013-contingency-and-homologation.md` is the **plan and
  the research**: the six steps, the minimum matrix, and the finding that the
  matrix requires the events.
- This document is the **runbook**: the ordered procedure, with who performs
  each step, what it needs, what it produces, what blocks it, and what this
  repository can already do for each row of the matrix.

It was written before the run, not after. The run cannot start without the DNIT
(step 2 hands over the test data set), and a written procedure is what keeps the
run short once the data arrives.

**Out of scope, by the sources' own words.** A contingency protocol — the
Manual's §14 is empty and says so (§5.4). The KuDE's graphical representation
(WU-C) and the receptor events are named here as blocked, not implemented here.
Nothing in this document is a production switch.

## Evidence grading

The baseline's table, and this document uses it the same way.

| Grade   | Meaning                                                                                                                                                              |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **[R]** | **Directly retrieved** — the artifact itself was fetched and read. Binding.                                                                                          |
| **[S]** | **Official-source synthesis** — from official DNIT pages whose own text could not be extracted. Must be confirmed against the artifact before a Story pins anything. |
| **[O]** | **Open** — not answered by any retrieved source. Recorded as a question, never filled with an assumption.                                                            |

A procedural claim below that appears only in the _Guía paso a paso_ and not in
the Manual is marked as such, so an operator who finds the DNIT's pages in
disagreement knows which document to open.

## Sources

| Id  | Document                                                                                                         | Retrieved   | What it pins here                                                                  |
| --- | ---------------------------------------------------------------------------------------------------------------- | ----------- | ---------------------------------------------------------------------------------- |
| S1  | _Guía paso a paso — Solicitud y Habilitación de Facturadores Electrónicos_, 15 pages                             | 2026-10-10  | The six steps, the three formal notes (Formatos N° 1–3), the requirements, the CSC |
| S2  | _Guía de Pruebas para el sistema e-kuatia_, February 2026, 12 pages                                              | 2026-10-10  | The test data's shape, the service sequence, the minimum counts per scenario       |
| S3  | _Manual Técnico v150_ (10/09/2019), 217 pages                                                                    | 2026-10-03+ | §14's emptiness, §6.2/§6.2.1, §8.2.2, §10.1, §13.8 (through the baseline's §24)    |
| S4  | _Recomendaciones y mejores prácticas para SIFEN_ (Guía para el desarrollador, October 2024), 13 pages            | 2026-10-10  | The two hosts, the batch rules, the polling cadence, the Prevalidador              |
| S5  | `docs/06-fiscal/SIFEN-BASELINE.md` — §11, §15, §18, §22.5, §23.7, §24, §25                                       | 2026-10-03+ | The record's own findings, cited where this runbook reads the Manual through it    |
| S6  | This repository's implementation, cited by path (never as protocol evidence; it answers only "can we do it yet") | 2026-10-13  | Every row of §4's checklist                                                        |

**[O] The Manual v150 extraction this vault holds stops at page 100.** Chapters
13 (KuDE, page 193), 14 (contingency, page 210) and 15 (codifications) are
outside it. Their content reaches this document through the Manual's own
**changelog**, the baseline's §24 (which reads §13.8 in full) and the baseline's
§18. Where a §14 claim appears below, its source is the changelog line, not a
page this vault read.

## 1. The six steps

**[R] S1, all six.** The steps are the DNIT's own; the wording below is a
translation, and the Spanish forms (Formatos N° 1, 2 and 3) are what actually
travels.

| #   | Who performs it                     | Needs as input                                                                                                             | Produces                                                                                                                                            | Blocked by                                                                                                         |
| --- | ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| 1   | The taxpayer's legal representative | An e-kuatia account, the note's facts (representative's name and _cédula_, RUC, the certificate, a working billing system) | A **ticket number** from the Mesa de ayuda SIFEN, which is the thread every later step answers on                                                   | Nothing technical. The note asserts what the law requires; the ticket is the evidence of the request               |
| 2   | The DNIT (the taxpayer receives)    | The ticket from step 1                                                                                                     | The **test data set**: RUC, test timbrado, validity start, establishment 001, expedition points 001–003, the document list and the two generic CSCs | **The DNIT's own availability.** Only the DNIT hands this over; there is no self-service path                      |
| 3   | The taxpayer's technical team       | The test data set plus a PSC-issued certificate with the emitter's RUC and EKU `clientAuth`                                | A mutually authenticated session against the test host, per service                                                                                 | A certificate that does not carry the emitter's RUC, or that lacks the EKU the guide requires                      |
| 4   | The taxpayer's technical team       | The test data set, the certificate and the minimum matrix (§4)                                                             | The run's results, per row, and the evidence of each (§7)                                                                                           | The **KuDE** and the **receptor events** are not available yet (§4.2); a licensed document range for the void rows |
| 5   | The taxpayer's legal representative | A Marangatu access key, an **ACTIVE** RUC, obligations up to date, and the legal requirements of Decreto 7795/17           | **Form 364 v2 in state _Aceptado_**, and a Marandú mailbox message with the print link                                                              | Marangatu itself refuses to advance when the RUC is not ACTIVE or the obligations are not up to date               |
| 6   | The taxpayer, then the DNIT         | The ticket from step 1, the run's outcome, and the Form 364's number                                                       | The notice through the same ticket, and then the **SET's approval**, notified in the Marandú mailbox                                                | **The DNIT's approval.** Nothing the taxpayer can do substitutes for it                                            |

**[R] S1, step 2's block, verbatim in shape.** The reply names the RUC, the
timbrado, the validity start, `Establecimiento: 001`,
`Punto de Expedición: 001 – 002 – 003`, the five document types and the two
CSCs. The two CSCs are printed as `IdCSC: 1` and `IdCSC: 2` in S1 and as
`IdCSC: 0001` and `IdCSC: 0002` in S2 — the same pair, written with and without
padding. The QR's own field is four characters (S5 §24.3), which is what the
padding is for.

**[R] S1, step 4's scope.** The run is not only issuance: S1 lists emission and
delivery of the DE, obtaining approval as a DTE, the later query, the
registration of the associated events, and _"la estructuración correcta del QR y
CDC en su representación gráfica KuDE"_. That sentence is why the KuDE (§4.2)
sits on the critical path and not in a later polish.

**[R] S1, step 5's own framing.** The filing is made in Marangatu → _Facturación
y Timbrado_ → _Solicitudes/Documentos Electrónicos_ → _HABILITACION DE
FACTURADOR ELECTRONICO_. The modality is **"Sistema Contribuyente"**: the guide
says a taxpayer affected by Resolución General N° 105/21 must select it, and it
is the modality for the system the taxpayer runs. The screen captures the
taxpayer's economy activities, the document types requested, and each
establishment's expedition points; the guide recommends selecting every
registered activity.

**[R] The two commitments that start counting at approval** (S1, and repeated at
the top of the guide): the first tax document within **six months** of the
habilitación, and **all** tax documents electronically within **twelve months**
of the first electronic document — unless the SET designates a shorter term.
Both are product deadlines, not protocol details: an integration that is
habilitado and idle expires its own habilitación.

**[S] What only S1 says, and the Manual does not.** The six steps are a
procedure, and the Manual describes no habilitación workflow of its own — it
describes the documents, the services and the validations. So for steps 1, 2, 5
and 6, the guide is the only source in this vault, and its own PDF is the one to
open if the DNIT's portal disagrees with this page.

## 2. The requirements checklist

**[R] S1 for the legal and Marangatu items, S2 for the technical ones.** Tick
each before opening the ticket; the first two also gate step 5 inside Marangatu,
where the system itself refuses to advance.

- [ ] **RUC in state ACTIVE.** Marangatu blocks the filing otherwise.
- [ ] **Tax obligations up to date.** The same block.
- [ ] **Marangatu access key** (user and key) for the legal representative.
- [ ] **The legal requirements of Decreto N° 7795/17** for habilitación as an
      electronic issuer.
- [ ] **A digital certificate from a PSC** authorized by the MIC / ACRaíz, with
      the emitter's RUC in it and EKU `clientAuth` (S2 §4.1 — the extension is
      what lets the same certificate serve the mutual TLS handshake).
- [ ] **A billing system that can emit, receive and preserve DTEs and their
      events** — this repository is that system; the requirement is checked
      against the matrix in §4, not by inspection.
- [ ] **The e-kuatia ticket open** (step 1) and its number recorded.
- [ ] **The test data set in hand** (step 2): RUC, test timbrado, validity
      start, establishment and expedition points.
- [ ] **A throwaway or self-generated certificate for the non-valid case** (S2
      §4.1's second scenario). It must still be a loadable PKCS#12 with a key of
      at least 2048 bits — that is this repository's own floor
      (`MINIMUM_RSA_MODULUS_BITS` in
      `packages/fiscal/src/signing-material/pkcs12.ts`), not a DNIT rule.
- [ ] **A real customer's data** for the test documents' receptor (S2 §2,
      observation 4).
- [ ] **A test item whose description will carry the required literal** in the
      first line of every test document (S2 §2; see §3 for the literal and the
      discrepancy with the Manual's own).
- [ ] **The two generic CSCs loaded for the test environment** in this
      deployment. The read exists; the write surface does not (§5.1).
- [ ] **The Form 364 v2 filed and in state _Aceptado_** (step 5).
- [ ] **The test outcome reported on the same ticket** (step 6), with the Form
      364's number.
- [ ] **The six-month and twelve-month commitments acknowledged** and owned.

## 3. The test data's shape

**[R] S2 §2, which is the table.** The guide prints the set with the values it
does not know as `(Campo X)`. That is the guide's own placeholder, and it means
the value comes from the DNIT or from the taxpayer — never from this runbook.

| Set                     | Field                          | Value or rule                                                                                                                         | Source          |
| ----------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| Timbrado                | Number                         | The test timbrado's value is the taxpayer's RUC, with an optional leading `0`; the check digit is not used (the guide's own sentence) | S2 §2           |
| Timbrado                | Validity start                 | The date of the habilitación as facturador electrónico, generated through the SGTM                                                    | S2 §2           |
| Timbrado                | Establishment                  | `001`, one establishment, generated through the SGTM                                                                                  | S2 §2           |
| Timbrado                | Expedition points              | Up to three (`001`–`003` in S1's reply)                                                                                               | S2 §2           |
| Timbrado                | Applies to every DE            | The timbrado and its whole data set must appear in **all** documents: FE, NCE, NDE, AFE and NRE                                       | S2 §2           |
| Emitter                 | RUC, check digit, name         | `(Campo X)` — and the values must be the taxpayer's **real registered** data, as they stand in Marangatu                              | S2 §2           |
| Emitter                 | Name in a test document        | A literal is **mandatory**; the two sources print two different ones (§3.1)                                                           | S2 §2, S5 §22.5 |
| Receptor and first item | RUC, check digit, address      | Real customer data                                                                                                                    | S2 §2           |
| Receptor and first item | The first item's description   | `"DOCUMENTO ELECTRÓNICO SIN VALOR COMERCIAL NI FISCAL - GENERADO EN AMBIENTE DE PRUEBA"`                                              | S2 §2           |
| CSC                     | `IdCSC 0001` / `CSC ABCD0000…` | `ABCD0000000000000000000000000000` — the value the Manual's own QR example uses, which is why §24's example is reproducible           | S2 §2           |
| CSC                     | `IdCSC 0002` / `CSC EFGH0000…` | `EFGH0000000000000000000000000000`                                                                                                    | S2 §2           |
| Certificate             | The non-valid certificate      | `NO está registrado o NO reúne las condiciones tecnológicas exigidas por el SIFEN` — essential for the unauthorized-access test       | S2 §2           |

**[R] S2's own closing rule.** "Todos los demás datos deben estar conforme a lo
establecido en el Manual Técnico y sus notas técnicas vigentes" — the test set
is not an exception to the protocol; it is a set of values inside it.

### 3.1 The emitter's name: two literals, and this repository emits one

**[R] S5 §22.5**, from the Manual's `D105 dNomEmi` row: in the test environment
the field must contain the literal

```
DE generado en ambiente de prueba - sin valor comercial ni fiscal
```

**[R] S2 §2** instead requires the emitter's name to carry

```
DOCUMENTO ELECTRÓNICO SIN VALOR COMERCIAL NI FISCAL - GENERADO EN AMBIENTE DE PRUEBA
```

— the same wording the guide requires of the **first item's description**.

**[S] What this means for the run.** The two documents prescribe two different
literals for the same field, with different wording and different
capitalisation. This repository implements the **Manual's** one:
`emitterNameForEnvironment` (`packages/fiscal/src/dte/dte.mapper.ts`) returns
`SIFEN_TEST_EMITTER_NAME` (`packages/fiscal/src/dte/dte.types.ts`) for a test
document and the tenant's own name for a production one. If the test environment
refuses a document over that field, the refusal names the expected value and the
finding is recorded — do not change the literal before the refusal says so.
**The first item's description is not emitted by this repository at all**: it is
tenant data, so the run's invoice lines must be chosen so the first line's
description is the guide's literal (§2's checklist).

### 3.2 The production CSC, and why the test one proves nothing

**[R] S3 §13.8.1 through S5 §24.2**, verbatim: the CSC "estará compuesto de 32
dígitos alfanuméricos, es generado por el SIFEN y **entregado al facturador
electrónico al momento de su ingreso**", and up to two may be active. So:

- the **production** CSC arrives with the habilitación's `ingreso`; it exists
  only after step 6, it identifies the taxpayer, and it is secret;
- the **test** pair (`IdCSC 0001 / ABCD…`, `IdCSC 0002 / EFGH…`) is generic and
  published; it is issued for the test environment and **proves nothing about
  production** — it is not a preview of production's value and it must never be
  carried into a production deployment.

This is why the CSC's storage in this repository is per tenant **and per
environment** ([[DEC-057]] Q3, §5.1), the same shape the signing material
already has.

## 4. The test matrix, as a runnable checklist

**[R] S2 §4.1–§4.5 for every minimum; S6 for every capability claim.** Every
row, its minimum, what this repository can already do it with, and its state.
`Runnable` means a product surface exists and the row can be executed once the
operator's inputs exist; `Blocked` names what is missing.

| #   | Row                                                                 | Minimum                                                                                 | What does it today (surface)                                                                                                                        | State                                                                                            |
| --- | ------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| 1   | Authentication, mutual TLS, **valid** certificate                   | 1 per service                                                                           | The transport's per-call mutual TLS, credential read per call (`packages/fiscal/src/sifen/sifen.transport.ts`, ADR-008 §2). Six service paths exist | **Runnable** for the services the deployment calls; see §4.1 for the seventh name                |
| 2   | Authentication, **non-valid** certificate                           | Recommended                                                                             | The same handshake with a second, deliberately invalid credential written for the tenant                                                            | **Runnable with a caveat** — the PKCS#12 floor above applies (§2)                                |
| 3   | Synchronous transmission, **correct** data, per type                | 5 each (FE, NCE, NDE, AFE, NRE)                                                         | `receiveDe` exists in the facade; the adapter deliberately sends a lot of one through the batch service instead                                     | **Blocked** — no surface calls the synchronous service (FISC-012 decision 1)                     |
| 4   | Synchronous transmission, **incorrect** data, per type              | 5 each                                                                                  | Same as row 3, and the worker's XSD gate fails the document closed before submission                                                                | **Blocked** — no surface, and no deliberate-invalid harness                                      |
| 5   | Asynchronous transmission, **correct** data, per type, in one lot   | 5 each, in one lot (30–50 per lot recommended)                                          | `issue` → `receiveBatch`: one DE per lot, assembled and signed by the worker (`fiscal-submission.handler.ts`)                                       | **Runnable for the service; blocked for the lot's composition** — the adapter is a lot of one    |
| 6   | Asynchronous transmission, **incorrect** data, per type, in one lot | 5 each, in one lot (3–5 per lot recommended)                                            | Same as row 5, with the same fail-closed gate                                                                                                       | **Blocked** — the gate refuses before the service sees it, and the lot composition is row 5's    |
| 7   | Events, as **emitter**: cancellation                                | 5 (any DE)                                                                              | `POST /fiscal-documents/:id/cancel` → the event builder and signer (`packages/fiscal/src/dte/dte.event.ts`) → `receiveEvent`                        | **Runnable** — five cancellations need five approved DTEs                                        |
| 8   | Events, as **emitter**: inutilización                               | 2 of FE, 1 each of NCE, NDE, AFE                                                        | `POST /fiscal/timbrado-ranges/:id/void` → the same builder → `receiveEvent`                                                                         | **Runnable with a caveat** — see §4.3: the void takes the range's tail and burns it              |
| 9   | Events, as **receptor**                                             | 3 each: conformidad, disconformidad, desconocimiento, notificación de recepción, ajuste | Nothing: the builder's payload union holds only the emitter's two (`DteEventPayload` in `dte.event.types.ts`)                                       | **Blocked** — four payloads have no builder, and "ajuste" has no published payload (§4.4)        |
| 10  | Query, per type                                                     | 3 each                                                                                  | The provider's `query` (`queryBatch` by reference, `queryDe` by CDC) through the reconciliation sweep (`fiscal-recovery.service.ts`)                | **Runnable with a caveat** — through the worker's reconciliation; no operator-facing query route |
| 11  | KuDE, one graphical representation per type                         | 1 each                                                                                  | The QR's content builder exists (`dte.qr.ts`), the CSC read exists (`fiscal-csc.reader.ts`) — the representation does not                           | **Blocked** on this story's WU-C                                                                 |
| 12  | KuDE, query by QR, per type                                         | 2 each                                                                                  | Same as row 11; the QR's composition itself is pinned by S5 §24, including the test consultation address                                            | **Blocked** on this story's WU-C                                                                 |

**[R] S2's five document types** are all inside the repository's admitted set:
`TI_DE_VALUES` (`dte.types.ts`) admits `1|[4-7]|9|10`, and the timbrado range's
document type admits the same (`apps/api/src/fiscal/timbrado/timbrado.zod.ts`).

### 4.1 Row 1: the seventh service name

**[R] S2 §4.1** lists seven services for the authentication row: _WS
Sincrónico_, _WS Asincrónico_, _WS Consulta_, _Resultado Lote_, _WS Consulta
DE_, _WS Recepción evento_ and _WS Consulta RUC_.

**[R] The Manual's §9** describes six services, and this repository's facade
(`packages/fiscal/src/sifen/sifen.facade.ts`) implements all six paths —
`receiveDe`, `receiveBatch`, `queryBatch`, `queryDe`, `receiveEvent`, `queryRuc`
— plus nothing else. Four of them have a runtime caller today (`receiveBatch`,
`queryBatch`, `queryDe`, `receiveEvent`); `receiveDe` and `queryRuc` are
callable only from a harness.

**[O] Which service "WS Consulta" names is not pinned by any retrieved source.**
It is not one of §9's six names, and the newer signed consultation family
(baseline §23.6) is a different pair of services this repository deliberately
does not call. **The run should ask the Mesa de ayuda** (§6) rather than guess;
until it answers, rows 1's count of seven cannot be completed as written.

### 4.2 What unblocks each blocked row

| Blocked row                       | Needs                                                                                        | Owner / decision                                 |
| --------------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| 3 and 4 — the synchronous service | A decision to call `receiveDe`, and a surface that does it (the facade is already there)     | Not yet assigned; WU-D owns the run              |
| 4 and 6 — incorrect data          | A harness that builds a deliberately invalid DE and submits it, bypassing the product's gate | Not yet assigned                                 |
| 5 and 6 — the lot's composition   | A batch surface, or an explicit decision to run five lots of one and record the deviation    | Not yet assigned                                 |
| 9 — the receptor events           | The four payloads' builders, and a resolution of "ajuste"                                    | A story of its own or [[FISC-016]]'s scope grown |
| 11 and 12 — the KuDE              | The graphical representation and its QR printing                                             | WU-C                                             |

**[R] Rows 4 and 6 need a bypass, and the bypass is the point.** The worker
validates the exact bytes it will submit against the official XSD and fails the
document closed on a refusal (`gateSignedDocument`,
`apps/worker/src/fiscal-submission/fiscal-submission.handler.ts`), and the
assembly refuses a missing input by name before that
(`FISCAL_ASSEMBLY_REASON_CODES`,
`apps/worker/src/fiscal-submission/fiscal-document-assembly.ts`). The matrix
wants documents SIFEN rejects for _business_ reasons; producing them means
submitting something this product would refuse to build, so it is a deliberate
test-only path and not a product behaviour.

### 4.3 Row 8: the void takes a tail, and the tail is real

**[R] FISC-016 WU-D.** `POST /fiscal/timbrado-ranges/:id/void` voids the range's
**remaining tail** — `nextNumber .. rangeTo`, read server-side — because a
consumed number is burnt and a void covering one would misstate the tenant's own
history. The interval is never caller-supplied.

**[R] The matrix's counts are therefore a range-preparation task.** Row 8 needs
one range per document type, each with a tail at least as long as the count it
must supply: one FE range with a tail of at least 2, and one each for NCE, NDE
and AFE. Voiding consumes those numbers for real: the range ends `RETIRED` and
the numbers cannot be issued afterwards. The run needs test ranges the operator
is willing to retire.

### 4.4 Row 9: four payloads, and a row the Guide prints that the schemas do not have

**[R] S5 §25.9.** `tgGroupEvtRecep` defines exactly four receptor payloads
(`rGeVeNotRec`, `rGeVeConf`, `rGeVeDisconf`, `rGeVeDescon`). The Guide's matrix
asks for five receptor rows and names _ajuste_ as the fifth; **the string
"ajuste" appears in neither event schema**. Either the Guide names one of the
four, or the action has no published payload. **The matrix cannot be completed
as written** — record the row as pending and ask the Mesa de ayuda (§6).

### 4.5 What the run must record per row

**[R] The repository's own evidence.** Each document row carries the status, the
CDC, the provider's reference, and sanitized snapshots of what was sent and
answered (`fiscal_document`'s `request_snapshot` and `response_snapshot` in
`packages/database/prisma/schema.prisma`; the snapshots are descriptors —
service, CDC, byte count, the answer's code and message — never the document's
bytes, ADR-009). For the run, each row's evidence is therefore: the row's
identity, the answer's `dCodRes`/`dEstRes`, and the timestamp. §7 says where the
result goes.

## 5. The decisions the run forces

Four, with their state today. Three are decided; one is decided as "record only,
implement nothing".

### 5.1 Where the CSC lives — **decided, and half-built**

**[R] [[DEC-057]] Q3 — accepted 2026-10-10.** The CSC is **per tenant and per
environment**, sealed in the secret store, with its `IdCSC` beside the
reference. The reasoning is the sources': the value is issued by the DNIT per
taxpayer and is secret ("teniendo esta y el contribuyente el conocimiento
exclusivo"), the test pair is generic and the production one is issued at
`ingreso`, so one value cannot serve both environments.

**State.** Implemented in the model and the read: the table `tenant_fiscal_csc`
(`packages/database/prisma/schema.prisma`, migration
`20261010000001_fisc_015_fiscal_identity`), the reader
(`packages/fiscal-persistence/src/fiscal-csc.reader.ts`, secret behind
`secretRef`, one ACTIVE row per environment, at-most-two enforced), and the
assembly's read per document (`cscPort.read({ tenantId, environment })`).

**[R] The write surface does not exist.** The API's fiscal profile controller
exposes the emitter profile, the establishments, the timbrado ranges and their
void/retire (`apps/api/src/fiscal/timbrado/timbrado.controller.ts`) and the
signing material, and **no route writes a CSC**. Before the run, the operator
needs one: either a route in the signing-material route's shape, or a documented
seed. Without it, every test document fails closed with `CSC_UNAVAILABLE` before
reaching the DNIT. This is a run blocker with a small owner, and it is not this
document's unit.

### 5.2 Which environment the deployment targets — **decided**

**[R] `SIFEN_ENVIRONMENT`** is a closed set, `TEST | PRODUCTION`
(`apps/worker/src/config/worker-env.schema.ts`,
`apps/api/src/config/api-env.schema.ts`), resolved once by
`resolveSifenEnvironment` (`packages/fiscal/src/fiscal-provider.module.ts`) and
shared by both deployables so they cannot disagree. Absence is a failure in
production and a `TEST` default outside it; the API adds the narrower rule that
absence is a failure in production **only** when `FISCAL_PROVIDER=sifen-direct`
(ADR-008 §3). The hosts are `https://sifen-test.set.gov.py` and
`https://sifen.set.gov.py` (S4; `sifen.transport.ts`).

**For the run:** `SIFEN_ENVIRONMENT=TEST`, a TEST signing material row, a TEST
CSC row, and `FISCAL_PROVIDER=sifen-direct`. The same switch is what makes the
assembly emit the test literal for the emitter's name and publish the test
consultation address in the QR (S5 §24.3), so the run should never hand-edit
either.

### 5.3 What the test data's placeholders are — **operator input, with two exceptions**

**[R] S2** prints `(Campo X)` for every value it does not know: the emitter's
RUC, check digit and name; the receptor's RUC, check digit and address; the
item. The DNIT hands those over in the step-2 reply, or the taxpayer supplies
its own real data. **Two values are not placeholders**: the two generic CSCs
(§3), and the first item's description literal (§3.1). The test timbrado, the
validity start, the establishment and the points are the DNIT's (S1 step 2, S2
§2).

### 5.4 How the contingency flag is treated — **decided: nothing to implement yet**

**[R] S3's own changelog for v150**, verbatim:

> «14. Operación de Contingencia — Se elimina el contenido de esta sección, ya
> que sigue en etapa de definición»

and the Manual's table of contents marks the chapter **"Operación de
Contingencia (Futuro)"**. **[O] The section is empty by the DNIT's own
admission**, so no retrieved source states when a contingent emission is
admissible, what it must carry besides the flag, or how it is later regularised.

**What the sources do pin, and what this repository already does:**

- the DE carries `iTipEmi` (`B002`) with `1 = Normal`, `2 = Contingencia`, and
  its description `dDesTipEmi` (`B003`) with the matching literals — carried in
  `DteRequest` as `"Normal" | "Contingencia"` (`dte.types.ts`, `dte.rules.ts`);
- the value comes from the tenant's declared emitter profile `emissionType`
  (`1 | 2`, `apps/api/src/fiscal/timbrado/timbrado.zod.ts`), mapped into the
  document (`dte.mapper.ts`, `DTE_EMISSION_TYPE_DESCRIPTIONS`);
- the Manual's own framing of what contingency is **for**: the 72-hour
  transmission window is "un beneficio del modelo operativo … para disminuir la
  necesidad del uso de contingencia por problemas de infraestructura de
  Internet, de energía eléctrica o de disponibilidad de SIFEN" (§6.2), and a
  client should weigh the batch service's own processing average "para la
  decisión del inicio del uso de la contingencia" (§8.2.2);
- the KuDE is the artefact that exists so a document can be delivered — "el KuDE
  es un documento tributario auxiliar que expresa de manera simplificada una
  transacción que ha sido respaldada por un DE" (§6.2), and under posterior
  validation it may be generated **before** approval, which is what makes the
  CDC-reuse rule of §6.5 necessary.

**So the honest treatment is: record `dDesTipEmi = 2` and nothing else.** No
timeout, no queue, no retry schedule, no "contingency mode" is implemented,
because inventing one would encode a protocol the DNIT has not published. When
the Manual's §14 is filled, the story that implements it cites the new text.
Until then, this is DNIT's pending item, listed in §6 — not ours.

### 5.5 What the run itself forces, beyond those four

Named here so the run's blockers are not discovered on the day:

1. **The CSC's registration** (§5.1) — a small write surface, and without it the
   run does not start.
2. **The range preparation** for row 8 (§4.3) — test ranges whose tails the
   operator will retire.
3. **A batch decision** (§4.2) — either a lot surface or a recorded deviation
   from "5 each in one lot".
4. **The synchronous and incorrect-data harness** (§4.2) — the rows with no
   product surface at all.
5. **The receptor events** (§4.4) — five rows, four payloads, one of them
   unpublished.
6. **The KuDE** (§4.2) — two rows, one work unit.
7. **The first item's description** (§3.1) — tenant data, so a test item must be
   chosen or created to carry the literal.

## 6. What is pending from the DNIT

An operator can act on each line of this list.

| Pending                                                  | Why it blocks                                                                          | How it is obtained                                                                 |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| **The test data set** (step 2)                           | Nothing can be run without the RUC, the timbrado, the validity start and the points    | The e-kuatia ticket's reply, after step 1's note (Formato N° 1)                    |
| **The habilitación's approval** (step 6)                 | Production cannot start                                                                | Marandú mailbox, after the Form 364 v2 is in _Aceptado_                            |
| **The production CSC**                                   | Every production QR needs it                                                           | Issued by SIFEN "al momento de su ingreso" (S3 §13.8.1)                            |
| **The contingency protocol**                             | Nothing about contingency can be implemented                                           | Manual §14, when the DNIT fills it — empty today (§5.4)                            |
| **The identity of "WS Consulta"** (§4.1)                 | Row 1's count of seven services cannot be completed                                    | The Mesa de ayuda SIFEN, on the open ticket                                        |
| **The "ajuste del evento" payload** (§4.4)               | Row 9 cannot be completed as written                                                   | The Mesa de ayuda SIFEN; the schemas define four receptor payloads and no "ajuste" |
| **The event result codes' catalogue** (S5 §25.5)         | The events' answers are carried verbatim, uncoerced, because no source enumerates them | The test environment's own answers during the run — the run is the retrieval       |
| **The WSDL bindings and SOAPAction question** (S5 §23.5) | A client may proceed without one, but a service that demands one will say so           | The test environment's answers during the run                                      |

**Channels, from the sources.** S2 §5 names the e-kuatia contact page
(<https://www.dnit.gov.py/web/e-kuatia/contactenos>) and the SET's
file-submission service
(<https://servicios.set.gov.py/eset-publico/EnvioMailSetIService.do>); S1's
channel is the ticket itself, and every step-6 notice answers on it. S4 names
the **Prevalidador SIFEN** (<https://ekuatia.set.gov.py/prevalidador/>), which
is the tool to reach for when a document is refused before the run and the
reason is not obvious.

## 7. Where the evidence goes

**[R] `docs/10-qa/CI-EVIDENCE.md`** is the destination, in the same rolling
record the other EPIC-16 sections use: one appended section, dated, with the
commands and the observed results.

The section this run appends should carry, at minimum:

1. the **environment**: `SIFEN_ENVIRONMENT=TEST`, the host, `FISCAL_PROVIDER`,
   the certificate's subject and RUC (never the key or the password), and the
   `IdCSC` used (never the CSC's value);
2. the **matrix**, row by row, with the minimum, what actually ran, and the
   observed answer (`dCodRes`/`dEstRes`, or the refusal and its code);
3. the **outcome**, as one of three words — `passed`, `failed`, or `partial` —
   **including a negative or pending one**. A run that could not complete a row
   records the row as pending with its reason; an empty matrix is not a pass;
4. the **run's own findings**: a literal the environment demanded and the
   sources disagreed about (§3.1), an unlisted result code (S5 §25.5), or a
   `dCodRes` that confirms or contradicts a baseline finding.

**[R] The repository keeps per-document evidence already.** The document row's
status, CDC, provider reference and sanitized snapshots (§4.5) are what a reader
of the CI record can follow into the database; the CI section should name the
tenant, the date range and the document identities rather than paste the
documents.

## 8. What this runbook cannot source

Recorded as [O], so a later reader does not mistake silence for a rule.

1. **The contingency protocol** — Manual §14 is empty by DNIT's own statement
   (§5.4).
2. **The event result codes' catalogue** — §25.5: `tdEstRes` has no enumeration
   and `tdCodRes` fixes only the shape.
3. **"WS Consulta"'s identity** (§4.1) — the Guide names seven services, the
   Manual's §9 describes six, and no retrieved source maps the seventh.
4. **The "ajuste del evento" payload** (§4.4) — four receptor payloads exist;
   "ajuste" is in neither schema.
5. **The Manual's §13–§15 beyond what the baseline recorded** — this unit's
   extraction stops at page 100; §13.8 is covered by the baseline's §24 and
   §14's emptiness by the changelog.
6. **Whether a batch of five is accepted** — the Guide's minimum is "5 each, in
   one lot" and its recommendation is 30–50 per lot. No retrieved source says
   whether a five-document lot is accepted, refused, or merely discouraged; the
   test environment's answer during the run is the evidence.

## Sources

Retrieved **2026-10-10** from the DNIT, plus the baseline's own retrievals
(2026-10-03 → 2026-10-08) and this repository's working tree (2026-10-13):

1. **[R]** DNIT, _Guía paso a paso — Solicitud y Habilitación de Facturadores
   Electrónicos_ (15 pages) —
   <https://www.dnit.gov.py/documents/d/global/guia-paso-a-paso-solicitud-y-habilitacion-de-facturadores-electronicos>
2. **[R]** DNIT, _Guía de Pruebas para el sistema e-kuatia_ (12 pages,
   February 2026) —
   <https://www.dnit.gov.py/documents/20123/424160/Guia+de+Pruebas+para+e-kuatia.pdf/715a15bf-d866-afe3-49e2-c10e05242c95>
3. **[R]** DNIT, _Manual Técnico de Sistema de Facturación Electrónica
   Nacional_, version 150 (10/09/2019, 217 pages) —
   <https://www.dnit.gov.py/documents/20123/420592/Manual+T%C3%A9cnico+Versi%C3%B3n+150.pdf/e706f7c7-6d93-21d4-b45b-5d22d07b2d22>
4. **[R]** DNIT, _Recomendaciones y mejores prácticas para SIFEN — Guía para el
   desarrollador_ (October 2024, 13 pages) —
   <https://www.dnit.gov.py/documents/20123/420592/Gu%C3%ADa+de+Mejores+Pr%C3%A1cticas+para+la+Gesti%C3%B3n+del+Env%C3%ADo+de+DE.pdf/38fe5830-98c0-2241-9895-671f86f1225f>
5. **[R]** `docs/06-fiscal/SIFEN-BASELINE.md` — §11 (timing), §15 (environments
   and the test guide), §18 (contingency), §22.5 (the test emitter's name),
   §23.6–§23.7 (the consultation services and the batch rules), §24 (the QR and
   the CSC), §25 (the event family).
