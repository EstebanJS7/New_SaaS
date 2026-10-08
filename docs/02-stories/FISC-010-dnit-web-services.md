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

| Service                 | Path                                  | Mode              | Request root                 | Response root                 |
| ----------------------- | ------------------------------------- | ----------------- | ---------------------------- | ----------------------------- |
| Recepción DE            | `/de/ws/sync/recibe.wsdl`             | Synchronous       | `rEnviDe`                    | `rRetEnviDe`                  |
| Recepción lote DE       | `/de/ws/async/recibe-lote.wsdl`       | **Asynchronous**  | `rEnvioLote`                 | `rResEnviLoteDe`              |
| Consulta resultado lote | `/de/ws/consultas/consulta-lote.wsdl` | Asynchronous pair | `rEnviConsLoteDe`            | `rResEnviConsLoteDe`          |
| Consulta DE             | `/de/ws/consultas/consulta.wsdl`      | Synchronous       | `rConsDteRequest`            | `rConsDteResponse`            |
| Consulta RUC            | `/de/ws/consultas/consulta-ruc.wsdl`  | Synchronous       | `rEnviConsArchivoRUCRequest` | `rEnviConsArchivoRUCResponse` |
| Recepción evento        | `/de/ws/eventos/evento.wsdl`          | Synchronous       | `rEnviEventoDe`              | `rRetEnviEventoDe`            |

**The paths are used exactly as the Manual's table writes them, including the
`.wsdl` suffix.** The Guide says the WSDL itself is obtained by appending
`?wsdl`, so the table's paths are the service addresses, not documentation
links. They are odd, and they are what the source says.

### The four shapes this Story implements

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
```

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
  0364  consulta extemporánea (>48 h)  -> CONFIGURATION_ERROR, reason recorded (see below)
```

**The ten minutes are the Guide's own number**: "se recomienda comenzar a
realizar la consulta pasados los 10 minutos de la recepción y luego a intervalos
regulares no menores a 10 minutos", with "En momentos de alta carga el
procesamiento puede ocurrir entre 1 a 24 horas posteriores a la recepción".

**`dCodRes` is a string in the schema and stays a string here.** Baseline §10
records the Manual's table typing it `N, 4`; `protProcesDE_v150.xsd` declares it
`xs:string` with `minLength 1`, and §23 records the divergence. A leading zero
is part of the code, so it is never parsed into a number.

## What is blocked, and why — the two consultation services

`Consulta DE` and `Consulta RUC` are **in the endpoint list and out of this
Story's implementation**, and the reason is a missing source, not a lack of
work.

The published v150 schemas require the **request itself to be signed**:

```xml
<xs:element name="rConsultaDTE" type="rConsultaDTE"/>
<xs:complexType name="rConsultaDTE">
  <xs:sequence>
    <xs:element name="ConsultaDTE">   <!-- dRuc + dProtConsDTEA, @Id required -->
    <xs:element ref="ds:Signature"/>  <!-- REQUIRED -->
```

and the same in `siConsultaArchivoRuc.xsd` (`ConsultaDTE` with `dRucFactElec`,
plus a required `ds:Signature`). **The signature profile for a consultation
request is not pinned by any retrieved source.** Baseline §5 pins the signature
of a **DE** — its `Reference URI` is the CDC, and the signed subtree is the `DE`
element. A consultation's signature has a different referenced element
(`ConsultaDTE`, whose `@Id` is a self-managed string) and no retrieved document
says which canonicalization, which transforms or which reference the service
expects. Implementing it would be inventing protocol, which PRD §23 forbids.

There is also a **conflict between two official sources**, which is why the
question cannot be settled by choosing the newer text: the Guide's `consulta`
section (October 2024) documents a **different, unsigned** request,
`rEnviConsDeRequest { dId, dCDC }`, answered by `rEnviConsDeResponse` with
`xContenDE` — the v141-era shape, and the v141 schemas are still published
(`WS_SiConsDE_v141.xsd`). So the two services are **deferred with the blocker
recorded**, not silently implemented from the wrong source:

```text
Consulta DE   blocked on: the request's signature profile (no source)
              conflicting source: the Guide's unsigned v141-era shape
Consulta RUC  blocked on: the same
```

**The practical consequence is a 48-hour cliff, and it is recorded rather than
hidden.** Within its window the batch query resolves a document; after it, the
Guide's answer is to query each CDC with `Consulta DE` — which is blocked. A
document still `SUBMITTED` past the window therefore stays `SUBMITTED` until
[[FISC-013]]'s homologation pins the request signature against a real service,
and the operator path for it is [[TD-029]].

## In Scope

- **[[ADR-007]] and [[ADR-008]]**, and `SIFEN-BASELINE.md` §23 (WU-A).
- **The message layer** for the four shapes above: types, serializers and
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
- **The two consultation services**, blocked above.
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
      the four implemented shapes, the outcome codes, and the two blocked
      consultation services.

**WU-B — the message layer**

- [ ] The synchronous reception shapes match `WS_SiRecepDE_v150.xsd` and
      `protProcesDE_v150.xsd`: `rEnviDe { dId, xDE }` with the DE **embedded as
      an element**, and `rProtDe`'s field order preserved.
- [ ] The batch reception shapes match `WS_SiRecepLoteDE_v141.xsd` and the
      Guide's `recibe-lote`: `xDE` as **base64 ZIP**, and the container built as
      `<rLoteDE>` holding one `<rDE>` per document.
- [ ] The batch query shapes match `WS_SiConsLote_v141.xsd`: `gResProcLote` up
      to 50, each carrying `id`, `dEstRes`, `dProtAut?` and `gResProc` up to 5.
- [ ] The event reception shapes match `WS_SiRecepEvento_v150.xsd`: `dEvReg`
      with `gGroupGesEve`, and `gResProcEVe` 1..15.
- [ ] The ZIP container is read and written by the dependency ADR-008 chose, and
      a round trip through it is asserted.
- [ ] **No value is coerced**: `dId`, `dCodRes`, `dCodResLot`, `dProtConsLote`
      and every CDC stay strings, asserted on a response whose codes carry
      leading zeros and whose batch number is longer than 2^53.
- [ ] **Every parsed value is validated against a published domain**, and an
      unknown `dEstRes` or an unknown result code is **refused**, never coerced
      into an outcome.

**WU-C — the transport and the credential port**

- [ ] The transport posts a SOAP 1.2 envelope (`application/soap+xml`) over TLS
      with mutual authentication, presenting the tenant's certificate, with
      `minVersion: "TLSv1.2"`, server verification on and `agent: false`.
- [ ] **Proven against a local TLS double**: a server that **refuses a client
      without a certificate** accepts ours, and the assertion is on the
      handshake, not on a mocked agent.
- [ ] `FiscalCredentialPort.read({ tenantId, environment })` exists, returns
      `null` when the tenant has no material, and is consulted **once per
      call**; no field of the provider holds material between calls.
- [ ] `FiscalProviderModule.forRoot()` exists, registers a **null-returning
      default** for the credential port, and both `apps/api` and `apps/worker`
      import it that way.
- [ ] A redirect is an error carrying its status and `Location`, and is never
      parsed — asserted with a double that answers `302`.
- [ ] A response over the size cap fails before parsing, and a body carrying
      `<!DOCTYPE` is refused before parsing.
- [ ] A timeout, a missing credential and an expired credential each produce the
      documented outcome, and **no error carries the key, the certificate or the
      response body**.

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
      each row of `dEstRes` and each code of the two asynchronous families.
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
retrieved service schemas, and the tracker's T6 opened. The two findings that
shaped the rest of the Story:

1. **The v150 async batch schemas are not published.**
   `WS_SiRecepLoteDE_v150.xsd` and `WS_SiConsLote_v150.xsd` return **HTTP 404**,
   and so do the Manual's own names (`SiRecepLoteDE_v150.xsd`,
   `ProtProcesLoteDE_v150.xsd`, `resRecepLoteDE_v150.xsd`,
   `SiResultLoteDE_v150.xsd`, `resResultLoteDE_v150.xsd`). The batch shapes
   exist **only at v141**, and the Guide documents them against those same
   schema names without a version. §23 records this instead of pretending a v150
   batch schema exists.
2. **The consultation services require a signed request whose profile no source
   pins**, and the Guide documents a different, unsigned shape for the same
   service. Both are deferred, blocked, and recorded above.

**WU-B, WU-C, WU-D and WU-E are not implemented.** The Story's status stays
`in-progress`.

## Verification

```text
WU-A   docs only: no code, no migration, no gate to run beyond the repository's
       own format check.
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
- **The two consultation services are blocked**, and with them the post-window
  per-CDC resolution path — the 48-hour cliff recorded above.
- **No real DNIT call is made by this Story.** The tests use a local double; the
  test environment's WSDL is unreachable and no habilitación exists yet
  ([[FISC-013]]).
- **The certificate is a fixture** until a PSC issues one.

## Technical Debt

- **The post-window resolution path** is blocked on the consultation request's
  signature profile. When [[FISC-013]] pins it against a real service, this
  becomes a work unit rather than a new Story.
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
packages/fiscal/src/sifen/**                      the transport, messages, facade
packages/fiscal/src/fiscal-provider.port.ts       SUBMITTED, providerReference, query
packages/fiscal/src/fiscal-provider.module.ts     forRoot(), the credential token
packages/fiscal/package.json                      fast-xml-parser, fflate
packages/database/prisma/migrations/**            provider_reference
apps/api/src/fiscal/**                            the status list and zod enum
apps/worker/src/**                                unchanged by this Story
```

## Completion Notes

**WU-A is done and the Story is not.** What WU-A settles: the port's
asynchronous shape, the transport and credential boundary, the parser and ZIP
dependencies with their advisory record, the four message shapes, the outcome
mapping, and the two blocked consultation services with the exact source each is
missing.

What it deliberately does not settle, and what a reader should not assume:

- **No DNIT call works yet.** There is no transport, no credential read and no
  provider; the test environment is behind an F5 gate and no habilitación
  exists.
- **The consultation services are not "later work"** — they are blocked on a
  source, and the difference matters for planning.
- **The signed DE is still not persisted**, and the criterion that says so moved
  to [[FISC-012]] with the reason recorded.

_Status must remain non-`done` until every acceptance criterion and gate
passes._
