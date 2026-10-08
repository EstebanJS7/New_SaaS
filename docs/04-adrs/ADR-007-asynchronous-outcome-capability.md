---
id: ADR-007
type: adr
title: The asynchronous outcome capability on the Fiscal provider port
status: accepted
date: 2026-10-08
supersedes: []
superseded_by:
related_epics:
  - EPIC-16
related_decisions:
  - DEC-046
  - DEC-047
  - DEC-048
  - DEC-049
related_stories:
  - FISC-010
  - FISC-012
approval_record:
  decision_proposal: none
  decision_status: accepted
  decision_approval_date: 2026-10-08
  adr_gate_authority:
    the epic's ADR candidate 3 plus docs/99-governance/DOCUMENTATION-RULES.md
    "change Fiscal Provider boundary"
  adr_acceptance_basis:
    authored in FISC-010's WU-A at the maintainer's instruction of 2026-10-08,
    which also fixed the boundary between FISC-010 (the capability) and FISC-012
    (the provider that implements it)
---

# ADR-007 — The asynchronous outcome capability on the Fiscal provider port

## Decision Summary

SIFEN answers a submission in two different ways, and the port models only one
of them. Synchronous reception returns the document's fate **in the same call**
— `rProtDe` carries `dEstRes`, `dProtAut` and `gResProc` — which
`FiscalIssueResult` already expresses. **Batch** reception returns only a
**batch number** (`dProtConsLote`) and the fate is learned later, from a
**second service**. That is why `SUBMITTED` sits in `fiscal_document_status`
with the transition guard wired around it and **no production writer**: the
state was pre-wired for exactly this Story, and the port could not reach it.

This ADR adds the capability, and it keeps it provider-agnostic:

1. **`FiscalIssueOutcome` gains `SUBMITTED`** — a **non-terminal,
   non-retryable** outcome meaning "the provider took the document into its
   processing queue". [[DEC-049]]'s "every outcome except `TRANSIENT_FAILURE` is
   terminal" is amended explicitly rather than quietly: `SUBMITTED` is
   non-terminal, and it is **not** retryable, because resubmitting a document
   the provider already holds is what SIFEN's own guide says gets the RUC
   blocked.
2. **`FiscalIssueResult` gains `providerReference`** — the provider's handle for
   the unresolved operation. It is **not** `externalId`: `externalId` is the
   provider's reference for the _document_, and a batch number is a reference
   for an _operation over up to fifty documents_.
3. **The port gains a third capability, `query`** — it resolves a document the
   provider is still processing into a terminal outcome, or reports that it is
   still processing. The port does **not** learn "batch", "lote", "0361" or a
   polling schedule: it learns "accepted, here is my handle", "ask again",
   "still processing", "approved", "rejected".
4. **The reconciliation path is the existing TD-028 sweep, extended to
   `SUBMITTED`** — not a new queue, not a delayed job, not a scheduler. The
   sweep already walks documents whose last touch is stale; `SUBMITTED` joins
   `QUEUED`/`ERROR` in what it looks at, and the provider's `retryAfterMs`
   bounds the next attempt.
5. **`fiscal_document` gains a nullable `provider_reference` column and
   `submitted_at` gains its writer.** The handle must survive a worker restart —
   a batch number held only in memory is a batch number that is lost, and the
   guide's recovery path (query by a CDC you sent) is a fallback, not a plan.

**What it deliberately does not do**: it does not make the port know SIFEN. The
service, the result codes, the 48-hour query window, the ten-minute cadence and
the mapping from `dCodResLot` to our vocabulary all live in `SIFEN-BASELINE.md`
§23 and in the **pure outcome model [[FISC-010]] delivers** — a mapping function
the adapter calls, not logic inside the port. Which service answers a query, and
in which order, is the adapter's ([[FISC-012]]).

## Context

`packages/fiscal/src/fiscal-provider.port.ts` declares exactly two capabilities:

```ts
export interface FiscalProviderPort {
  readonly provider: FiscalProviderId;
  issue(request: FiscalIssueRequest): Promise<FiscalIssueResult>;
  cancel(request: FiscalCancelRequest): Promise<FiscalCancelResult>;
}
```

and [[DEC-048]] accepted that scope: "a minimal Fiscal provider port with
issue/cancel capabilities". `FiscalIssueOutcome` is
`APPROVED | REJECTED | FUNCTIONAL_REJECTION | CONFIGURATION_ERROR | TRANSIENT_FAILURE`,
and `isRetryableOutcome` is `outcome === "TRANSIENT_FAILURE"`. [[DEC-049]]
records the consequence: "every outcome except `TRANSIENT_FAILURE` is terminal".

**The database already disagrees, in the right direction.** The transition guard
installed by `20261007000001_fiscal_document_signing_state` admits:

```text
SENDING   -> SUBMITTED, APPROVED, REJECTED, ERROR
SUBMITTED -> APPROVED, REJECTED, ERROR, CANCEL_PENDING
```

and `submittedAt` is declared on the model and **written by nothing**;
`SUBMITTED` has **no production writer** — only the live-PostgreSQL suite sets
it. That is a pre-wired waiting state with no way in and no way out. This ADR is
the way in.

**SIFEN's two answers, from the official sources.** Baseline §23 records the
message shapes; the facts this ADR rests on are:

```text
synchronous   rEnviDe { dId, xDE } -> rRetEnviDe { rProtDe }
              rProtDe { Id?, dFecProc, dDigVal?, dEstRes?, dProtAut?, gResProc <=100 }
              one call, one fate.                       (WS_SiRecepDE_v150.xsd, protProcesDE_v150.xsd)

asynchronous  rEnvioLote { dId, xDE } -> rResEnviLoteDe { dFecProc?, dCodRes?, dMsgRes?,
                                                         dProtConsLote?, dTpoProces? }
              the DE's fate is NOT here; only the batch number is.
                                                        (WS_SiRecepLoteDE_v141.xsd, and the Guide's
                                                         recibe-lote example)
              rEnviConsLoteDe { dId, dProtConsLote?, dCDC? }
                -> rResEnviConsLoteDe { dFecProc, dCodResLot, dMsgResLot, gResProcLote <=50 }
              each group carries one CDC's fate.         (WS_SiConsLote_v141.xsd, and the Guide's
                                                         consulta-lote example)
```

and the Guide's own operational rules, which are why the outcome cannot be
treated as a retryable failure:

> 5. Nunca se debe enviar un mismo CDC sin haber tenido la respuesta definitiva
>    de SIFEN (Aprobado, Aprobado con Observación o Rechazado) […] tener en
>    cuenta las reglas de bloqueo de RUC por envíos duplicados de DE.

with the blocking reasons themselves: "Enviar el mismo CDC varias veces en un
mismo lote", "Enviar el mismo CDC varias veces en lotes distintos y que aún se
encuentren en procesamiento", "Enviar varias veces un mismo lote".

**Why this is an ADR and not a Story decision.** `DOCUMENTATION-RULES.md` names
"change Fiscal Provider boundary" as an ADR case, and this changes it in three
ways at once: a new outcome vocabulary member that breaks [[DEC-049]]'s
terminality rule, a new capability on the port, and a new persisted field that
the aggregate's own decision ([[DEC-046]]: "additive fields or tables may be
introduced only when required by the accepted retry/idempotency record") gates
behind an accepted record. The epic says so directly: ADR candidate 3 is **the
gate for [[FISC-010]], not [[FISC-012]]** — FISC-010 is the Story that produces
the asynchronous result, so the port must expose it before FISC-012 consumes it.
That ordering was corrected on 2026-10-07 and this ADR is written to match it.

## Decision

### 1. The vocabulary

```ts
export type FiscalIssueOutcome =
  | "APPROVED"
  | "REJECTED"
  | "FUNCTIONAL_REJECTION"
  | "SUBMITTED" // NEW: accepted for processing, not resolved
  | "CONFIGURATION_ERROR"
  | "TRANSIENT_FAILURE";

export type FiscalQueryOutcome =
  | "APPROVED"
  | "REJECTED"
  | "FUNCTIONAL_REJECTION"
  | "PROCESSING" // NEW: the provider has not resolved it yet
  | "CONFIGURATION_ERROR"
  | "TRANSIENT_FAILURE";
```

`PROCESSING` is deliberately **not** called `PENDING`: `PENDING` is already a
`fiscal_document_status` meaning "no submission has been attempted", and a
vocabulary that reuses the word for "submitted and waiting" makes every later
conversation ambiguous.

`isRetryableOutcome` **does not change**: it stays
`outcome === "TRANSIENT_FAILURE"`. `SUBMITTED` is not a failure and must not be
retried; a BullMQ retry after a successful hand-off is exactly the duplicate
submission the Guide's blocking rules punish.

### 2. The result shapes

```ts
export interface FiscalIssueResult {
  readonly outcome: FiscalIssueOutcome;
  readonly externalId: string | null;
  readonly providerReference: string | null; // NEW: the operation's handle
  readonly cdc: string | null;
  readonly reasonCode: string | null;
  readonly reason: string | null;
  readonly retryAfterMs: number | null;
  readonly providerRequest: unknown;
  readonly providerResponse: unknown;
  readonly resolvedAt: string;
}

export interface FiscalQueryRequest {
  readonly fiscalDocumentId: string;
  readonly tenantId: string;
  readonly provider: FiscalProviderId;
  readonly cdc: string | null; // the document's identity
  readonly externalId: string | null;
  readonly providerReference: string | null; // may be null: see below
  readonly signal?: AbortSignal;
}

export interface FiscalQueryResult {
  readonly outcome: FiscalQueryOutcome;
  readonly externalId: string | null;
  readonly reasonCode: string | null;
  readonly reason: string | null;
  readonly retryAfterMs: number | null;
  readonly providerRequest: unknown;
  readonly providerResponse: unknown;
  readonly resolvedAt: string;
}
```

**`providerReference` may be null and the query still works.** The Guide's
recommendation 3 is explicit that a lost submission response is recoverable:

> Cuando se envía un lote y no se recibe respuesta del SIFEN por algún corte en
> la comunicación, se puede consultar el lote con un CDC que fue enviado en el
> lote respectivo. […] Utilizar esta opción solo en caso de no recibir el Número
> de Lote como respuesta al envío.

So the query is identified by **whatever the document has**: the reference if it
was received, and the CDC regardless. The port carries both and the adapter
decides which service to call. A port that required the reference would make the
lost-response case unresolvable, which is the case the Guide took the trouble to
document.

### 3. The capability

```ts
export interface FiscalProviderPort {
  readonly provider: FiscalProviderId;
  issue(request: FiscalIssueRequest): Promise<FiscalIssueResult>;
  query(request: FiscalQueryRequest): Promise<FiscalQueryResult>;
  cancel(request: FiscalCancelRequest): Promise<FiscalCancelResult>;
}
```

`query` is the name because it is DNIT's own vocabulary for this family of
services ("Consulta resultado lote", "Consulta DE", "Consulta RUC") and because
it is honest about what it may return: a query **may not resolve anything**. The
alternatives — `resolve` (claims an outcome it may not produce), `poll` (names a
mechanism, and the port should not care whether the adapter polls, waits or is
told) — were rejected for those reasons.

### 4. The persistence

One additive migration, `fiscal_document`:

```text
provider_reference   text NULL    the provider's handle for an unresolved operation
```

plus `submitted_at`, which already exists and gains its writer: it is set at the
moment `SENDING -> SUBMITTED` happens, which is the moment the provider accepted
the document into its queue.

Both fields are **cleared by nothing** — the existing guard already refuses to
clear `submitted_at`, and `provider_reference` follows it: a handle that is
erased after resolution cannot be audited, and the row's history is the record.

`external_id` keeps its meaning (the provider's reference for the _document_,
which for SIFEN is the authorization protocol `dProtAut` and is known only when
the document is approved). The batch number is **not** written there.

### 5. The reconciliation path

**The existing TD-028 sweep is the reconciliation path**, extended:

```text
what it walks today   QUEUED, ERROR     (re-drive a submission)
what it walks after   QUEUED, ERROR, SUBMITTED
what it does for SUBMITTED   calls query() once and applies the answer
```

The clock is `last_attempt_at`, which every claim already writes; the next
attempt is bounded by the `retryAfterMs` the provider returns, and by the
sweep's own staleness threshold. `attempt_count` keeps counting **submissions**
— a query is not an attempt at submission, and inflating the number would make
the document's history lie.

**Why not a new mechanism.** A delayed BullMQ job per document, or a scheduler,
would be new scheduling infrastructure for a need the worker already meets. The
Guide's cadence (start after ten minutes, then intervals no shorter than ten
minutes) is a _rate_, and a periodic sweep is the simplest thing that respects a
rate. No new queue, no new broker, no new deployable.

**A failed query never fails the document.** A `query` that returns
`TRANSIENT_FAILURE` or `CONFIGURATION_ERROR` leaves the row in `SUBMITTED`: the
submission happened, and only a **terminal resolution** may move the state. This
is the invariant that keeps a query outage from turning an accepted document
into an error.

### 6. What this ADR does not decide

- **Which SIFEN service answers a query, and in which order.** The adapter's
  ([[FISC-012]]). §23 records the shapes and [[FISC-010]] delivers the pure
  mapping from a SIFEN result code to the vocabulary above; the strategy — batch
  query first, the per-CDC query after the Guide's 48-hour window, and the
  CDC-only path when the reference is missing — is the adapter's.
- **The cancellation path's own pending state.** `CANCEL_PENDING` exists in the
  vocabulary and nothing resolves it. SIFEN's cancellation is an **event**, and
  the Manual's endpoint table (baseline §8) lists event reception as
  **synchronous**, so a SIFEN adapter may never produce `CANCEL_PENDING` at all.
  Whether it does is [[FISC-012]]'s finding, and this ADR does not extend
  `query` to cover it: no retrieved source says the query services report a
  cancellation's state.
- **The document's own fate after the query window closes.** The Guide's 48-hour
  batch-query window is a protocol limit, not a business rule; what to do with a
  document that never resolves is an operator decision ([[TD-029]]).

## Alternatives Considered

### A second port method per SIFEN service

Rejected. It would put `queryBatch`, `queryByCdc` and `queryByProtocol` on a
port whose whole point is that the provider is interchangeable, and every future
provider would have to implement the union of every other provider's services.
The port expresses **the question** ("what happened?"); the adapter chooses the
service.

### A provider callback (a webhook) instead of a query

Not available. No retrieved source shows SIFEN calling the emitter; the async
pair in the Manual's endpoint table (baseline §8) is `recibe-lote` plus
`consulta-lote`, which is a client-initiated query, and the Guide's own
recommendations are all about _when to ask_. There is also no public endpoint to
receive such a call in the MVP's deployables.

### Modelling the unresolved outcome as `TRANSIENT_FAILURE` with a long retry

Rejected, and this is the alternative worth naming because it is the smallest
change that appears to work. It would make the BullMQ job retry the
**submission**, which is precisely the duplicate send that SIFEN blocks ("Enviar
el mismo CDC varias veces en lotes distintos y que aún se encuentren en
procesamiento" → a 10-to-60-minute RUC block), and it would record a successful
hand-off as a failure in the document's history. The distinction between "we
failed to hand it over" and "they took it and have not finished" is the whole
content of this ADR.

### Persisting the batch number in the sanitized `response_snapshot` only

Rejected. The snapshot is a CONFIDENTIAL record of what the provider said, not a
queryable field, and the reconciliation path must find a `SUBMITTED` row **and
its handle** with one indexed read. Reading a JSON column to find a batch number
is a worse contract than one nullable column, and the snapshot is sanitized by a
fail-closed sanitizer whose shape is not a promise to the reconciliation path.

### A delayed job per document (`queue.add(..., { delay })`)

Rejected as the mechanism, for the reason in §5: it duplicates the sweep's
existing job, multiplies queue state by document, and needs its own recovery
when a delayed job is lost. It also fights the Guide's cadence: the interval is
a rate that may change, not a timestamp fixed at submission.

## Consequences

### Positive

- **`SUBMITTED` stops being a state with no writer.** The guard's
  `SENDING -> SUBMITTED` edge and `submittedAt` were waiting for this Story
  since EPIC-15; they now have a producer and a consumer.
- **The port stays provider-agnostic and small**: one new capability, one new
  outcome on each side, one new field.
- **No new infrastructure**: no broker, no queue, no scheduler, no deployable —
  the complexity budget is intact, and the reconciliation path is the one the
  worker already runs.
- **The failure that loses a response is recoverable by design**, because the
  query is identified by the CDC and does not require the handle.

### Negative

- **The port's vocabulary grows a member that is not terminal**, so every
  consumer of `FiscalIssueOutcome` must handle it. There are few, and the
  compiler names them — but the "all outcomes are terminal except transient"
  mental model that [[DEC-049]] established is now wrong, which is why this ADR
  states the amendment instead of leaving it to be discovered.
- **A `SUBMITTED` document can sit unresolved for as long as SIFEN takes** (the
  Guide records 1 to 24 hours under load). The system's answer is the sweep and
  the read surface, not a timeout that invents an outcome.
- **`last_attempt_at` now carries two meanings** (last submission attempt, last
  query attempt). It is the reconciliation clock, and `attempt_count` is
  explicitly the submission counter, so the pair stays readable — but it is a
  reuse, and it is recorded here rather than left implicit.

## Migration / Rollout

One additive migration on `fiscal_document` (a nullable `provider_reference`).
No backfill: no row has one. No data migration. The port change lands with
[[FISC-010]]; the adapter that implements `query` and the worker stage that
consumes it land with [[FISC-012]]. The fake provider implements `query` as a
scripted outcome so the contract is exercisable before a real provider exists —
which is what the fake is for, and it simulates no protocol detail
([[DEC-048]]).

## Guardrails

1. **`SUBMITTED` is never retried.** `isRetryableOutcome` stays
   `=== "TRANSIENT_FAILURE"`, and a test asserts that `SUBMITTED` is not
   retryable — the blocking rules are the reason, not a preference.
2. **A failed query never changes the state.** Only a terminal resolution moves
   a `SUBMITTED` row, asserted on the guard and in the reconciliation path's
   tests.
3. **The handle survives a restart.** `provider_reference` is written in the
   same conditional update that enters `SUBMITTED`, and the live-PostgreSQL
   suite proves the row carries it after a claim/abandon cycle.
4. **The port learns no SIFEN constant.** `query`'s types carry no service name,
   no result code and no host; a test asserts the port's public surface contains
   no SIFEN-specific string.
5. **The reconciliation path is bounded.** The sweep takes a batch limit (as it
   already does), and `retryAfterMs` prevents a hot loop against a provider that
   answers "still processing".
6. **The amendment to [[DEC-049]] is recorded, not silent.** This ADR names the
   sentence it changes, and [[FISC-010]]'s Story repeats it in its invariants.

## References

- `docs/06-fiscal/SIFEN-BASELINE.md` §23 (the service-schema retrieval record,
  the message shapes and the Guide's operational rules), §8 (the endpoint list
  and the synchronous/asynchronous split), §10 (the result model), §11 (the
  deadlines), §12 (rejection and resubmission with the same CDC).
- DNIT, _Guía de Mejores Prácticas para la Gestión del Envío de DE_, October
  2024 — the batch limit, the blocking reasons and the polling recommendations.
- `packages/fiscal/src/fiscal-provider.port.ts` — the surface this ADR extends.
- `packages/database/prisma/migrations/20261007000001_fiscal_document_signing_state/migration.sql`
  — the guard that already admits `SENDING -> SUBMITTED -> …`.
- `docs/07-decisions/DEC-046-fiscal-document-aggregate-and-linkage.md`,
  `DEC-048-fiscal-provider-port-and-fake-provider.md`,
  `DEC-049-fiscal-idempotency-retry-and-errors.md` — the constraints this ADR
  amends or satisfies.
- `docs/02-stories/FISC-010-dnit-web-services.md` — the Story this gates, and
  `docs/02-stories/FISC-012-*.md` — the Story that implements it.
- `odd/tasks/fisc-010-dnit-web-services.md` — the work-unit plan.
