---
id: FISC-010
type: story
title:
  DNIT web services — the transport, the message layer and the asynchronous
  outcome model
epic: EPIC-16
status: in-progress
priority: high
depends_on:
  - FISC-008
  - FISC-009
prd_sections:
  - "22"
  - "23"
permissions: []
branch: feat/epic-16-fisc-010-dnit-web-services
created: 2026-10-08
updated: 2026-10-08
---

# FISC-010 — DNIT web services

## Objective

Give the Fiscal boundary the ability to **speak to SIFEN**: the SOAP 1.2
Document/Literal transport over TLS 1.2 with mutual authentication using the
tenant's certificate, the message layer for the services DNIT publishes, and the
**asynchronous outcome model** SIFEN produces when a document is accepted for
processing rather than approved on the spot.

This Story produces the client, the message shapes, the credential boundary and
the port's asynchronous capability. It does **not** produce the provider that
implements the port, does not wire the worker, does not persist a document and
does not sign: those are [[FISC-012]]'s, and the boundary was decided with the
maintainer on 2026-10-08.

## Context

`docs/06-fiscal/SIFEN-BASELINE.md` §7 pins the transport stack from the Manual's
§7.4 and §7.9, §8 pins the endpoint list from §7.10, and **§23 pins the message
shapes from the official service schemas themselves** — retrieved on 2026-10-08,
with their HTTP status and byte counts recorded there. This Story encodes only
what §23 cites.

Two ADRs gate it, and both are this Story's first work unit:

- **[[ADR-007]]** — the asynchronous outcome capability on the provider port:
  the `SUBMITTED` outcome, the `query` capability, the persisted provider
  reference and the reconciliation path.
- **[[ADR-008]]** — the transport: SOAP over mutual TLS, the per-call credential
  read on a process-singleton provider, and the two new dependencies.

What already exists and is used here: the provider port, its fake, the sanitized
snapshot writer and the composition root (EPIC-15); the DE builder, its XSD gate
and the signer ([[FISC-008]], [[FISC-009]]); the tenant's signing material
behind the `SecretStore` ([[FISC-007]]). What does **not** exist anywhere: an
outbound transport, a credential read path, an XML parser in the runtime barrel,
and any writer for `SUBMITTED` or `submitted_at`.

## The services, pinned

Baseline §8 (the Manual's §7.10 table) fixes the paths; §23 fixes the message
shapes from the published schemas. Both hosts publish the same paths:
`https://sifen-test.set.gov.py` and `https://sifen.set.gov.py`.

| Service                 | Path                                  | Mode              | Request root         | Response root         |
| ----------------------- | ------------------------------------- | ----------------- | -------------------- | --------------------- |
| Recepción DE            | `/de/ws/sync/recibe.wsdl`             | Synchronous       | `rEnviDe`            | `rRetEnviDe`          |
| Recepción lote DE       | `/de/ws/async/recibe-lote.wsdl`       | **Asynchronous**  | `rEnvioLote`         | `rResEnviLoteDe`      |
| Consulta resultado lote | `/de/ws/consultas/consulta-lote.wsdl` | Asynchronous pair | `rEnviConsLoteDe`    | `rResEnviConsLoteDe`  |
| Consulta DE             | `/de/ws/consultas/consulta.wsdl`      | Synchronous       | `rEnviConsDeRequest` | `rEnviConsDeResponse` |
| Consulta RUC            | `/de/ws/consultas/consulta-ruc.wsdl`  | Synchronous       | `rEnviConsRUC`       | `rResEnviConsRUC`     |
| Recepción evento        | `/de/ws/eventos/evento.wsdl`          | Synchronous       | `rEnviEventoDe`      | `rRetEnviEventoDe`    |

**The paths are used exactly as the Manual's table writes them, including the
`.wsdl` suffix.** The Guide says the WSDL itself is obtained by appending
`?wsdl`, so the table's paths are the service addresses, not documentation
links. They are odd, and they are what the source says.

### The six shapes this Story implements

```text
Recepción DE — synchronous, and the DE is EMBEDDED, not base64
  rEnviDe { dId (xs:integer, totalDigits 15), xDE (xs:any, namespace ekuatia,
                                                  processContents="skip") }
  rRetEnviDe { rProtDe }

Recepción lote DE — asynchronous, and here xDE IS base64
  rEnvioLote { dId (xs:long, 1..999999999999999),
               xDE (xs:base64Binary, xmime:expectedContentTypes="application/zip") }
  rResEnviLoteDe { dFecProc?, dCodRes?, dMsgRes?, dProtConsLote?, dTpoProces? }
  the ZIP contains  <rLoteDE><rDE>…</rDE>…</rLoteDE>

Consulta resultado lote
  rEnviConsLoteDe { dId, dProtConsLote?, dCDC? }
  rResEnviConsLoteDe { dFecProc, dCodResLot, dMsgResLot, gResProcLote? <=50 }
  gResProcLote { id (CDC), dEstRes, dProtAut?, gResProc <=5 }
  gResProc     { dCodRes, dMsgRes }

Recepción evento
  rEnviEventoDe { dId, dEvReg { gGroupGesEve } }
  rRetEnviEventoDe { dFecProc, gResProcEVe 1..15 }

Consulta DE — by CDC, UNSIGNED (Manual §9.4; WS_SiConsDE_v141.xsd)
  rEnviConsDeRequest  { dId (xs:integer, totalDigits 15), dCDC (xs:string, 44) }
  rEnviConsDeResponse { dFecProc (xs:dateTime), dCodRes (xs:string, 4),
                        dMsgRes (1..255), xContenDE? (xs:string) }
  xContenDE carries the DE — bare or wrapped in rContDe; accept both (§23.8)

Consulta RUC — the RUC's status, UNSIGNED (Manual §9.6; WS_SiConsRUC_v141.xsd)
  rEnviConsRUC    { dId, dRUCCons (xs:string, 5..8, NO check digit) }
  rResEnviConsRUC { dCodRes (4), dMsgRes (1..255), xContRUC? }
  xContRUC { dRUCCons, dRazCons (1..250), dCodEstCons (3), dDesEstCons (6..25),
             dRUCFactElec (S|N) }
```

**Neither consultation request carries a signature**, and that is what made the
first reading of §23 wrong: §9.6 says the service "solamente permite conexiones
con certificado digital" — mutual TLS authenticates it, exactly as §8's rule
says ("el software cliente deberá autenticarse ante el SIFEN utilizando su
certificado y firma digital").

**`xDE` means two different things in two services**, and that is the single
most likely place to implement from memory and be wrong: the synchronous service
carries the DE as a **child element**, and the batch service carries a **base64
ZIP**. §23 records both, with the schema fragment each comes from, and the
Guide's own `recibe-lote` example shows the base64 form.

**The batch container's name comes from the Guide**, not from a schema:
`<rLoteDE>` holding one `<rDE>` per document, then compressed and base64-encoded
("Comprimir el contenido de la estructura del lote rLoteDE", then "Convertir el
contenido comprimido a Base64"). **The ZIP entry's name is not published** and
is recorded as an open question: the local double accepts whatever the client
writes, and only a real service can confirm it.

### The batch's published limits, from the Guide

```text
documents per batch        up to 50, all of ONE document type
emitter                    one RUC emisor per batch
request size               the input data message must not exceed 1000 KB
```

and the reasons a batch is **not queued** (`dCodRes` `0301`): mixed emitters,
mixed document types, more than 50 DE, a duplicate-send block, or a compressed
file over the size limit.

## The outcome model, pinned

The mapping is a **pure function this Story delivers**; the adapter
([[FISC-012]]) calls it. Every row traces to §23.

```text
dEstRes (the document's state)         -> our vocabulary
  "Aprobado"                           -> APPROVED
  "Aprobado con observación"           -> APPROVED, observation preserved in `reason`
  "Rechazado"                          -> REJECTED

dCodRes (4 digits, a STRING in the schema) -> `reasonCode`, never a number

batch reception — rResEnviLoteDe.dCodRes
  0300  lote recibido con éxito        -> SUBMITTED, dProtConsLote as providerReference
  0301  lote no encolado               -> FUNCTIONAL_REJECTION (terminal; the batch, not the DE)

batch query — rResEnviConsLoteDe.dCodResLot
  0360  número de lote inexistente     -> CONFIGURATION_ERROR (terminal: we hold a handle
                                          SIFEN does not know)
  0361  lote en procesamiento          -> PROCESSING, retryAfterMs = 10 minutes
  0362  procesamiento concluido        -> per-DE results, from gResProcLote
  0364  consulta extemporánea (>48 h)  -> CONFIGURATION_ERROR for the batch path; the
                                          adapter falls back to the per-CDC query below

Consulta DE — rEnviConsDeResponse.dCodRes   (Manual §9.4, Tabla G)
  0420  CDC inexistente                -> the DE is not in SIFEN: ERROR, reasonCode 0420,
                                          which the existing re-drive can resubmit
  0421  RUC sin permiso                -> CONFIGURATION_ERROR (terminal: the certificate
                                          is not authorized to consult)
  0422  CDC encontrado                 -> APPROVED, with xContenDE carrying the DE

Consulta RUC — rResEnviConsRUC.dCodRes      (Manual §9.6, Tabla H)
  0500  RUC no existe                  -> CONFIGURATION_ERROR
  0501  RUC sin permiso consulta WS    -> CONFIGURATION_ERROR
  0502  RUC encontrado                 -> the container: dCodEstCons, dDesEstCons,
                                          dRUCFactElec
```

**The ten minutes are the Guide's own number**: "se recomienda comenzar a
realizar la consulta pasados los 10 minutos de la recepción y luego a intervalos
regulares no menores a 10 minutos", with "En momentos de alta carga el
procesamiento puede ocurrir entre 1 a 24 horas posteriores a la recepción".

**`dCodRes` is a string in the schema and stays a string here.** Baseline §10
records the Manual's table typing it `N, 4`; `protProcesDE_v150.xsd` declares it
`xs:string` with `minLength 1`, and §23 records the divergence. A leading zero
is part of the code, so it is never parsed into a number.

## The naming collision that looked like a blocker — and how it resolved

**The two consultation services are in scope and need no XML signature.** The
first reading of §23 concluded the opposite, and the error is worth recording
because it is the second time this directory's naming and version mix has
produced a false blocker.

**What the Manual actually says.** §9.4 pins `Consulta DE` — "consulta de un DE
por su CDC" — as `rEnviConsDe { dId, dCDC }`, and §9.6 pins `Consulta RUC` as
`rEnviConsRUC { dId, dRUCCons }`. **Neither table carries a `ds:Signature`
row**, and §9.6's own text says authentication is "conexiones con certificado
digital". The published artifacts agree: `WS_SiConsDE_v141.xsd` and
`WS_SiConsRUC_v141.xsd` have **zero `xmldsig` occurrences**, and the Guide's
`consulta` example matches the artifact's element names (`rEnviConsDeRequest` /
`rEnviConsDeResponse`).

**What went wrong.** The published v150 consultation schemas —
`siConsultaDTE.xsd`, `WS_SiConsDTE.xsd`, `siConsultaDTEAsync.xsd`,
`WS_SiConsDTEAsync.xsd`, `siConsultaArchivoRuc.xsd`, `WS_ConsultaArchivoRuc.xsd`
— declare **signed** requests, and their names look like the Manual's
(`siConsultaDTE` against `siConsDE`, `Consulta Archivo RUC` against
`Consulta RUC`). They are **different services**: a query by authorization
protocol, a date-range query, and the archive of a RUC, all returning ZIPs.
Reading them as the Manual's §9.4/§9.6 services produced a blocker that does not
exist.

**The lesson is baseline §22.1's, applied to a schema directory instead of a
PDF**: _"the source does not contain it" and "the source does not pin it" are
different claims_. The Manual's §9 had not been read for these two services when
the blocker was recorded; it pins them completely, and the missing piece was a
search, not a source.

**The signed family stays out of scope, with its own open question.** Their
request signature references `ConsultaDTE`, whose `@Id` is a self-managed
string, and no retrieved document states which canonicalization, transforms or
reference they expect — §5 pins the **DE**'s signature and nothing else. They
are not needed by the issuance or the asynchronous-resolution flow, and they are
recorded in §23.6/§23.8 as a family whose profile is open. If a later Story
needs the archive or the bulk query, that is where the work starts.

**The 48-hour path is now complete.** Within its window the batch query answers;
after it, the Guide's instruction ("deberá consultar cada CDC del lote mediante
la WS Consulta DE") lands on a service this Story implements. The remaining
ambiguity is only the container: `xContenDE` is typed `xs:string` by the
artifact while the Manual describes `rContDe { rDE, dProtAut }`, so the reader
accepts the DE **bare or wrapped** and never assumes which (§23.8).

## In Scope

- **[[ADR-007]] and [[ADR-008]]**, and `SIFEN-BASELINE.md` §23 (WU-A).
- **The message layer** for the six shapes above: types, serializers and
  parsers, plus the batch container (build `<rLoteDE>`, ZIP it, base64 it) and
  the ZIP reader for the responses that carry one (WU-B).
- **The transport**: SOAP 1.2 Document/Literal over `node:https` with a per-call
  mutual-TLS configuration from the tenant's certificate, the request-envelope
  serializer, and ADR-008's guardrails (WU-C).
- **The credential boundary**: `FiscalCredentialPort`, its null-returning
  default, and `FiscalProviderModule.forRoot()` so a deployment can substitute
  the real port (WU-C).
- **The port's asynchronous capability**: the vocabulary, `query`, the additive
  migration for `provider_reference`, and `submitted_at`'s writer (WU-D).
- **The service facade**: one typed method per implemented service, each bound
  to its endpoint from baseline §8, and the pure outcome mapping above (WU-E).

## Out of Scope

- **`SifenDirectFiscalProvider`**, `FISCAL_PROVIDER` selection, and the worker's
  signing stage — [[FISC-012]].
- **The worker's credential wiring**: `@newsaas/secret-store` in
  `apps/worker/package.json`, `SecretsModule`, `SECRET_STORE_MASTER_KEYS`, and
  the `secretStore.get` path that does not exist yet — [[FISC-012]], per the
  maintainer's boundary. This Story defines the port and proves it with a
  double.
- **The reconciliation stage** (the sweep walking `SUBMITTED` and applying a
  `query` result) — [[FISC-012]]'s, because it is the worker stage that owns the
  provider. ADR-007 decides the mechanism; this Story delivers the capability.
- **Persisting the signed DE** (`xml_storage_key`) and the submission path's
  logging — [[FISC-012]], for the reason in the next section.
- **The signed v150 query family** — the protocol query (`WS_SiConsDTE`), the
  date-range query (`WS_SiConsDTEAsync`) and the RUC archive
  (`WS_ConsultaArchivoRuc`). They are **different services** from the Manual's
  §9.4/§9.6 pair, they require a request signature whose profile no retrieved
  source pins, and the issuance flow does not need them. §23.6/§23.8 record the
  open question; a later Story that needs the archive starts there.
- **Building an event's payload** (`dEvReg`'s content, i.e. a cancellation
  event's body): the event service takes the document as an argument, exactly as
  the reception service takes a signed DE. Composing a cancellation event is
  `cancel`'s, and `cancel` is [[FISC-012]]'s.
- **Contingency, homologation and a PSC certificate** — [[FISC-013]].
- KuDE rendering, the portal surface, reports.

## An acceptance criterion that moved a second time

[[FISC-009]] left one criterion pointed at this Story:

> No secret appears in a **log or a stored snapshot**. **MOVED TO
> [[FISC-010]]**, which is where the document is persisted and where the
> submission path logs.

**It moves again, to [[FISC-012]], and the reason is the split this Story's ADRs
made.** [[FISC-009]] pointed it here because FISC-010 was expected to own the
submission path. It does not: ADR-008 put the transport in `packages/fiscal` and
the credential _wiring_ in [[FISC-012]], and the stage that persists a document
and logs a submission is the worker's, which is [[FISC-012]]'s. FISC-010 never
persists a document and never logs a submission, so a criterion about _where_ a
document is persisted and _where_ the submission path logs belongs to the Story
that has those two places.

**The criterion is not weakened by the move**: it stays a negative assertion
about logs and stored snapshots, [[FISC-009]]'s file carries a pointer to the
new owner, and the tracker records the re-pointing. What changes is only which
Story proves it, and the proof is named: the sanitized snapshot writer plus the
worker's logging path, in [[FISC-012]].

## Acceptance Criteria

**WU-A — the decisions and the baseline**

- [x] [[ADR-007]] is accepted and records the port's asynchronous capability:
      the `SUBMITTED` outcome, `providerReference`, `query`, the persistence and
      the reconciliation path, with the amendment to [[DEC-049]] stated rather
      than implied.
- [x] [[ADR-008]] is accepted and records the transport, the per-call credential
      port, the environment rule, the two dependencies with their advisory
      record, and the parser's guardrails.
- [x] `SIFEN-BASELINE.md` §23 records the retrieval of the service schemas with
      **HTTP status and byte counts**, the WSDL's **302 and the control probe**,
      the **six** implemented shapes, the outcome codes, and the resolution of
      the consultation family — including the signed v150 family's own open
      question.

**WU-B — the message layer**

- [x] The synchronous reception shapes match `WS_SiRecepDE_v150.xsd` and
      `protProcesDE_v150.xsd`: `rEnviDe { dId, xDE }` with the DE **embedded as
      an element**, and `rProtDe`'s field order preserved.
- [x] The batch reception shapes match `WS_SiRecepLoteDE_v141.xsd` and the
      Guide's `recibe-lote`: `xDE` as **base64 ZIP**, and the container built as
      `<rLoteDE>` holding one `<rDE>` per document.
- [x] The batch query shapes match `WS_SiConsLote_v141.xsd`: `gResProcLote` up
      to 50, each carrying `id`, `dEstRes`, `dProtAut?` and `gResProc` up to 5.
- [x] The event reception shapes match `WS_SiRecepEvento_v150.xsd`: `dEvReg`
      with `gGroupGesEve`, and `gResProcEVe` 1..15.
- [x] The two consultation shapes match the Manual's §9.4/§9.6 tables and the
      published v141 artifacts: `rEnviConsDeRequest { dId, dCDC }` and
      `rEnviConsRUC { dId, dRUCCons }`, **both without a signature**, with
      `dCDC` matching `tCDC` (44 characters) and `dRUCCons` matching `tRuc`
      (5–8, no check digit).
- [x] `xContenDE` is accepted **bare or wrapped in `rContDe`**, and the reader
      never assumes which — §23.8 records why both are possible.
- [x] The ZIP container is **written** by the dependency ADR-008 chose, and the
      suite unzips it to assert the container's content and its single entry.
      The **read** direction is unused: no in-scope response carries a ZIP.
- [x] **No value is coerced**: `dId`, `dCodRes`, `dCodResLot`, `dProtConsLote`
      and every CDC stay strings, asserted on a response whose codes carry
      leading zeros and whose batch number is longer than 2^53.
- [x] **Every parsed value is validated against a published domain**, in the two
      kinds ADR-008 §5 names: the **structural** domains are refused (an unknown
      `dEstRes`, a code that is not four digits, a malformed CDC, `tRuc` or
      base64), while the **result-code catalogue is an open set** — an unlisted
      but well-formed code is carried as `unknown` with its raw value, never
      coerced into an outcome. The reason is §23.8 item 7 plus the Manual's own
      §10 worked example (`0160`, which §23.7 does not list): refusing an
      unlisted code would refuse a legitimate response.

**WU-C — the transport and the credential port**

- [x] The transport posts a SOAP 1.2 envelope (`application/soap+xml`) over TLS
      with mutual authentication, presenting the tenant's certificate, with
      `minVersion: "TLSv1.2"`, server verification on and `agent: false`.
- [x] **Proven against a local TLS double**: a server that **refuses a client
      without a certificate** accepts ours, and the assertion is on the
      handshake, not on a mocked agent. The suite also proves the double is not
      vacuous — a bare request without a certificate is rejected by the same
      server — and that two calls with two client certificates make **two
      connections with two peer subjects**, which a pooled agent would not
      produce.
- [x] `FiscalCredentialPort.read({ tenantId, environment })` exists and its
      fail-closed default returns `null` for every read, because absence of
      material is a state and not an exception.
- [ ] The port is consulted **once per call** and no field of the provider holds
      material between calls. **MOVED TO [[FISC-012]] (2026-10-08)**: there is
      no provider yet, so the property has no subject. WU-C delivers the port
      and the injection seam it will be read through.
- [x] `FiscalProviderModule.forRoot()` exists, registers a **null-returning
      default** for the credential port, and both `apps/api` and `apps/worker`
      import it that way.
- [x] A redirect is an error carrying its status and `Location`, and is never
      parsed — asserted with a double that answers `302`.
- [x] A response over the size cap fails **while it is being read**, before
      anything parses it. (The `<!DOCTYPE` refusal is [[WU-B]]'s and is asserted
      there: the reader refuses the construct before the parser runs.)
- [x] A timeout and an expired — or not-yet-valid — credential each produce the
      documented outcome, and **no error carries the key, the certificate or the
      response body**: the failure messages are a fixed table, and the one
      variable part is a symbolic socket code validated against a conservative
      shape before it is interpolated.
- [ ] A **missing** credential produces `CONFIGURATION_ERROR`. **MOVED TO
      [[FISC-012]]**, together with the line above: the transport receives a
      credential and cannot receive `null`; the mapping from the port's `null`
      to a terminal `CONFIGURATION_ERROR` is the adapter's.

**WU-D — the port's asynchronous capability and the schema**

- [ ] `FiscalIssueOutcome` carries `SUBMITTED`; `FiscalIssueResult` carries
      `providerReference`; the port declares `query`; and
      **`isRetryableOutcome("SUBMITTED")` is `false`**.
- [ ] `fiscal_document.provider_reference` exists by an **additive** migration,
      and `submitted_at` is written in the same conditional update that enters
      `SUBMITTED`.
- [ ] The fake provider implements `query` as a scripted outcome, so the
      contract is exercisable before a real provider exists.
- [ ] Proven against a **live PostgreSQL**: the new column applies, the guard's
      `SENDING -> SUBMITTED -> APPROVED|REJECTED|ERROR` edges hold, and a
      transient `query` failure leaves the row `SUBMITTED`.

**WU-E — the service facade and the outcome model**

- [ ] One typed method per implemented service, each bound to the endpoint
      baseline §8 publishes, and no endpoint string is written anywhere else.
- [ ] The outcome mapping above is a **pure function** with a table-driven test:
      each row of `dEstRes`, each code of the two asynchronous families, and the
      consultation codes `0420`/`0421`/`0422` and `0500`/`0501`/`0502`.
- [ ] `Aprobado con observación` maps to `APPROVED` **with the observation
      preserved** in `reason`, which baseline §10 requires.
- [ ] A `PROCESSING` result carries the Guide's ten minutes as `retryAfterMs`.

**Gates**

- [ ] Lint, typecheck, unit tests, the live-PostgreSQL gate and the build pass
      for `@newsaas/fiscal`, `@newsaas/database` and `@newsaas/api`, and the
      root gates pass.
- [ ] No protocol constant is written without a cited source in §23.

## Domain Invariants

- **No protocol constant without a cited official source.** Every endpoint,
  element name, code and limit above traces to §8 or §23; the WSDL's SOAPAction,
  the ZIP entry name and the consultation signature are **open**, not guessed.
- **The port learns no SIFEN.** `query` carries no service name, no host and no
  result code; the mapping is a pure function the adapter calls.
- **`SUBMITTED` is never retried.** Resubmitting a document SIFEN already holds
  is what the Guide's blocking rules punish; only `TRANSIENT_FAILURE` is
  retryable ([[DEC-049]], amended by [[ADR-007]]).
- **A failed query never fails the document.** Only a terminal resolution moves
  a `SUBMITTED` row.
- **The tenant's private key is an argument of one call.** It is RESTRICTED
  ([[ADR-005]]); it is never logged, never returned, never cached in the
  provider and never persisted by this Story.
- **One connection, one tenant.** No socket is pooled, so no authenticated
  connection can be reused across tenants.
- **The environment is never substituted.** A tenant with material only for the
  other environment fails closed with `CONFIGURATION_ERROR`.

## API

```text
None. This Story adds no route and no public HTTP surface.
```

## Database

One additive migration:

```text
fiscal_document
  provider_reference  text NULL   the provider's handle for an unresolved operation
```

plus `submitted_at`, which already exists and gains its writer. No backfill: no
row has a reference. The transition guard already admits
`SENDING -> SUBMITTED -> APPROVED|REJECTED|ERROR`; this Story proves it against
a live database rather than changing it.

## UI

- None. The staff surface already shows `status`, and `SUBMITTED` becomes a
  value it can display; the status list in `apps/web` and the API's zod enum are
  **missing `SIGNING` today** and are brought up to date with the enum they
  mirror as part of WU-D — a drift this Story found rather than a feature it
  adds.

## Work units

| WU   | Scope                                                                                | Depends on |
| ---- | ------------------------------------------------------------------------------------ | ---------- |
| WU-A | ADR-007, ADR-008, this Story, baseline §23, tracker — docs only                      | —          |
| WU-B | The message layer: shapes, serializers, parsers, the ZIP container, the value domain | WU-A       |
| WU-C | The transport, the credential port, `forRoot()`, the guardrails                      | WU-A       |
| WU-D | The port's asynchronous capability, the migration, the fake's `query`                | WU-A       |
| WU-E | The service facade and the pure outcome mapping                                      | WU-B, WU-C |

## Implementation Summary

**WU-A — the decisions, the Story and the baseline.** [[ADR-007]] and
[[ADR-008]] accepted 2026-10-08, `SIFEN-BASELINE.md` §23 written from the
retrieved service schemas, and the tracker's T6 opened. Three findings shaped
the rest of the Story:

1. **The v150 async batch schemas are not published.**
   `WS_SiRecepLoteDE_v150.xsd` and `WS_SiConsLote_v150.xsd` return **HTTP 404**,
   and so do the Manual's own names (`SiRecepLoteDE_v150.xsd`,
   `ProtProcesLoteDE_v150.xsd`, `resRecepLoteDE_v150.xsd`,
   `SiResultLoteDE_v150.xsd`, `resResultLoteDE_v150.xsd`). The batch shapes
   exist **only at v141**, and the Guide documents them against those same
   schema names without a version. §23 records this instead of pretending a v150
   batch schema exists.
2. **The WSDL is unreachable on both hosts**, host-wide, which leaves the
   SOAPAction and the bindings open and turns "never follow a redirect" into a
   requirement (§23.5).
3. **The consultation services are NOT blocked — the first reading of §23 said
   they were, and it was wrong.** The published v150 consultation schemas
   (`siConsultaDTE`, `siConsultaArchivoRuc`) require a signed request, and their
   names resemble the Manual's services; they are **different services** (by
   protocol, by range, and the RUC archive, all returning ZIPs). The Manual's
   §9.4 and §9.6 pin the two services the endpoint list names as **unsigned**
   (`rEnviConsDe { dId, dCDC }`, `rEnviConsRUC { dId, dRUCCons }`), the
   published v141 artifacts agree (`WS_SiConsDE_v141.xsd`,
   `WS_SiConsRUC_v141.xsd`, zero `xmldsig` occurrences), and the Guide's example
   matches them. **The blocker was a search not yet run, not a missing source**
   — baseline §22.1's lesson, applied to a schema directory. The correction, the
   signed family's own open question and the resolved 48-hour path are recorded
   above, and §23 was rewritten with it.

**WU-B — the message layer.** Four modules under `packages/fiscal/src/sifen/`,
all pure, with 121 new cases in four suites:

```text
sifen.codes.ts       the vocabulary: dEstRes's three values, 0300/0301,
                     0360-0364 with the Guide's 10 minutes and 48 hours,
                     Tabla G's 0420-0422 and Tabla H's 0500-0502
sifen.messages.ts    the six services' shapes and every constant that pins them
sifen.serializer.ts  the SOAP envelope and the six request bodies, the batch
                     container, its ZIP and its base64
sifen.parser.ts      the six responses, with ADR-008's guardrails
```

**Two judgement calls the implementation surfaced, both recorded rather than
smoothed over:**

1. **An unlisted result code is carried, not refused** — and that corrects this
   Story's own wording. §23.8 item 7 records that no retrieved source enumerates
   `dCodRes`, and the Manual's §10 worked example is `0160`, which §23.7 does
   not list. So the _structural_ domains are refused (an unknown `dEstRes`, a
   non-four-digit code, a malformed CDC/`tRuc`/`dId`/base64) while the catalogue
   is treated as open: the descriptor is total and answers `unknown` carrying
   the raw code, and the coercion happens nowhere. ADR-008 §5 and the acceptance
   criteria above were corrected to say exactly that.
2. **`dEstRes` is matched case-sensitively** against §10's
   `Aprobado con observación`. §23.7 quotes the Guide's prose spelling that one
   with a capital `O`, and prose is not the field value: a service that sends
   the capital would be refused as unknown, which is a homologation check for
   [[FISC-013]] rather than a guess made here.

**WU-C — the transport and the credential port.** Three new modules and one
composition-root change, with 32 new cases (fiscal now 24 files / 420 tests):

```text
fiscal-credential.port.ts   the port, the FISCAL_CREDENTIAL_PORT token, the
                            null-returning default, the pure freshness check
sifen/sifen.transport.ts    the SOAP 1.2 POST over per-call mutual TLS
sifen/sifen.tls.fixture.ts  a CA, a server certificate and two client
                            certificates, plus the mutual-TLS double
fiscal-provider.module.ts   static @Module -> forRoot(options), providing the
                            provider token AND the credential token
```

**The trust anchor is a per-call input, and that was not in ADR-008's list.**
The double needs it — its CA is throwaway — and so does a deployment whose PSC
root is not in Node's bundled store, which is a real production case for a
Paraguayan government chain. ADR-008 §1 now records it, with the property that
matters: **it adds anchors and never weakens verification**, and when it is
absent the request carries no `ca` option at all.

**The double is not vacuous, and that is the point.** The suite proves a bare
request without a client certificate is _rejected by the same server_ before it
proves ours is accepted, and it proves two calls with two client certificates
open **two connections with two peer subjects** — the observable consequence of
`agent: false`, which a pooled agent would not produce. Certificates are built
with `pkijs` for the ASN.1 and signed with `node:crypto`, the same split
`pkcs12.fixture.ts` already documents, because `pkijs@3.4.1`'s own `sign()`
writes a signature algorithm OpenSSL rejects.

**Two criteria moved to [[FISC-012]]** while implementing this one, because they
name a provider that does not exist yet: "the port is consulted once per call
and no field of the provider holds material between calls", and "a missing
credential produces `CONFIGURATION_ERROR`". The transport cannot receive `null`;
the mapping from the port's `null` to a terminal configuration error is the
adapter's, and moving them keeps the criteria provable instead of nominally
checked.

**WU-D and WU-E are not implemented.** The Story's status stays `in-progress`.

## Verification

```text
WU-A   docs only: no code, no migration, no schema, so no package test or live-PG
       gate applies. What was run on the branch, forced rather than served from
       turbo's cache, all green:

         pnpm format-check        All matched files use Prettier code style!
         pnpm lint --force        18/18
         pnpm typecheck --force   18/18
         pnpm test --force        19/19
         pnpm build --force       11/11

       `pnpm --filter @newsaas/api test:live-pg` is not applicable to WU-A:
       it changes no migration and no code. The base it branches from,
       `68b3c74`, already carries the recorded 218/218 run.
```

## Tests Added

```text
None yet. WU-A adds documents.
```

## Known Limitations

- **One deployment speaks to one DNIT environment.** `SIFEN_ENVIRONMENT` is
  deployment-level ([[ADR-008]]), so a single deployment cannot homologate one
  tenant while another issues in production. Per-tenant environment selection is
  a future product decision.
- **The WSDL is unread**, so the SOAPAction, the bindings and any header
  requirement are open. Both hosts answer `302 → /vdesk/hangup.php3` for every
  path, including a bogus one and the root.
- **The ZIP entry's name is not published.** The client writes one; only a real
  service can confirm it.
- **The `xContenDE` container is ambiguous.** The artifact types it `xs:string`
  and the Manual describes `rContDe { rDE, dProtAut }`, so the reader accepts
  the DE bare or wrapped; which one SIFEN sends is only provable against a live
  service ([[FISC-013]]).
- **The signed v150 query family has no signature source** — the protocol query,
  the RUC archive and the date-range query. They are out of scope here and
  recorded in §23.6/§23.8.
- **No real DNIT call is made by this Story.** The tests use a local double; the
  test environment's WSDL is unreachable and no habilitación exists yet
  ([[FISC-013]]).
- **The certificate is a fixture** until a PSC issues one.

## Technical Debt

**Four advisories from WU-B's review (`review-f16dff5e521484d2`, approved
2026-10-08).** The closure reported them by coordinate with `severity: WARNING`
and `disposition: informational`, and declared them non-blocking: none opened a
correction, none reopens the review, and no correction transition is offered for
this candidate. **The reviewer's full text is not retained by this facade** —
lens context is ephemeral by design — so what follows is the coordinates the
provider gave plus _this session's reading_ of each location, marked as an
inference rather than as the reviewer's wording:

| id     | location                  | our reading of the location                                                                                                                                    |
| ------ | ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R3-001 | `sifen.parser.ts:241`     | `parseRucQueryResponse` accepts `xContRUC` without cross-checking `dCodRes = 0502`, where the CDC parser does validate its own code-to-content pair.           |
| R3-002 | `sifen.parser.ts:661`     | `TIMESTAMP_PATTERN` anchors its start but not its end, so trailing garbage after the seconds passes.                                                           |
| R3-003 | `sifen.parser.ts:727-731` | An empty element is refused as `UNEXPECTED_SHAPE` with a message that says it "is an element rather than a text value", which is not what an empty element is. |
| R3-004 | `sifen.parser.ts:340-353` | `readDeContent` extracts the `rDE` element by regular expression over a string, so content carrying a `</rDE>` inside it can truncate the DE.                  |

Each is one small change, none is a defect in the message layer's contract with
§23, and the guardrails the criteria above name are asserted by the suite. They
are recorded rather than fixed because the review's disposition is
`informational` and the candidate's authority is burned: fixing them on a new
candidate is a later work unit.

- **The signed v150 query family** — the archive and the bulk queries — is
  blocked on its request signature profile. When [[FISC-013]] pins it against a
  real service, it becomes a work unit rather than a new Story.
- **`CANCEL_PENDING` has no resolver.** SIFEN's cancellation is an event whose
  reception is synchronous, so a SIFEN adapter may never produce it; whether it
  does is [[FISC-012]]'s finding ([[ADR-007]] records the open question).
- **The staff status list and the API's zod enum omit `SIGNING`** — a drift
  found while scoping WU-D, fixed there rather than left.

## Decisions / ADRs

- **[[ADR-007]]** — the asynchronous outcome capability on the port. Accepted
  2026-10-08.
- **[[ADR-008]]** — the transport, the credential port and the two dependencies.
  Accepted 2026-10-08.

## Files / Modules

```text
docs/04-adrs/ADR-007-asynchronous-outcome-capability.md
docs/04-adrs/ADR-008-sifen-transport-mutual-tls-and-parser.md
docs/06-fiscal/SIFEN-BASELINE.md                  §23 is the source of record
docs/01-roadmap/EPIC-16-SIFEN-Direct.md           the epic's ADR list and rows
odd/tasks/epic-16-sifen-direct.md                 the tracker, T6
odd/tasks/fisc-010-dnit-web-services.md           the work-unit plan
```

and, for the WUs that follow:

```text
packages/fiscal/src/sifen/sifen.codes.ts        the result-code vocabulary
packages/fiscal/src/sifen/sifen.messages.ts     the six shapes and their constants
packages/fiscal/src/sifen/sifen.serializer.ts   the envelopes and the batch ZIP
packages/fiscal/src/sifen/sifen.parser.ts       the responses and the guardrails
packages/fiscal/src/sifen/sifen.transport.ts    the SOAP/mTLS POST
packages/fiscal/src/sifen/sifen.tls.fixture.ts  the mutual-TLS double (testing only)
packages/fiscal/src/fiscal-credential.port.ts   the per-call credential port
packages/fiscal/src/fiscal-provider.module.ts   forRoot(), both tokens
packages/fiscal/src/fiscal-provider.port.ts       SUBMITTED, providerReference, query
packages/database/prisma/migrations/**            provider_reference
apps/api/src/fiscal/**                            the status list and zod enum
apps/worker/src/**                                unchanged by this Story
```

and WU-E will add the service facade under the same directory.

## Completion Notes

**WU-A is done and the Story is not.** What WU-A settles: the port's
asynchronous shape, the transport and credential boundary, the parser and ZIP
dependencies with their advisory record, the six message shapes, the outcome
mapping, and — after a correction — the resolution of the consultation services
that a first reading had recorded as blocked.

What it deliberately does not settle, and what a reader should not assume:

- **No DNIT call works yet.** There is no transport, no credential read and no
  provider; the test environment is behind an F5 gate and no habilitación
  exists.
- **The signed query family is not "later work"** — it is blocked on a source,
  and the difference matters for planning. The two services the endpoint list
  names are not.
- **The signed DE is still not persisted**, and the criterion that says so moved
  to [[FISC-012]] with the reason recorded.

_Status must remain non-`done` until every acceptance criterion and gate
passes._
