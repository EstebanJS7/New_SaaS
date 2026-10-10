---
id: FISC-016
type: story
title:
  The cancellation event — the payload a cancellation needs before it can be
  sent
epic: EPIC-16
status: planned
priority: medium
depends_on:
  - FISC-012
prd_sections:
  - "22"
  - "23"
permissions: []
branch:
created: 2026-10-08
updated: 2026-10-08
---

# FISC-016 — the cancellation event

## Objective

Make cancellation work against SIFEN. `FiscalProviderPort.cancel` exists and the
fake answers it; the real adapter answers a **fail-closed refusal** because the
event's payload is not profiled, and this story is the one that profiles it. Its
outcome is that a tenant can cancel an authorized document and the result is
SIFEN's answer, not a placeholder.

## Context

[[FISC-012]] implemented `SifenDirectFiscalProvider`'s `issue` and `query` in
full, and left `cancel` answering `CONFIGURATION_ERROR` with
`CANCELLATION_EVENT_UNPROFILED`. That is not an omission of effort: SIFEN's
cancellation is an **event**, and `SIFEN-BASELINE.md` §23.3 records the state of
the sources precisely —

> `siRecepEvento_v150.xsd` declares `gGroupGesEve` as `tgGroupGesEve`, defined
> in `Evento_v150.xsd`. **`Evento_v150.xsd` and `Evento_Types_v150.xsd` were
> retrieved (23,255 and 23,320 bytes) but their field-level rules are not
> profiled here** — the event _payload_ is the emitter's own document to build,
> and profiling it is the work of the Story that builds one.

So the artifacts are **already in the vault's retrieval record** and unread; the
work is profiling them, not finding them. Three things follow, and each is a
work unit rather than a paragraph:

1. **The payload's composition.**
   `rEnviEventoDe { dId, dEvReg { gGroupGesEve } }` is the envelope; the event
   inside it is the emitter's document, and its fields — the event type, the
   reason, the document it cancels — come from `Evento_v150.xsd`. **Every
   constant needs its citation**, which is what profiling means here.
2. **Its signature.** The event is signed, and whether it follows the DE's own
   profile ([[ADR-006]]'s XMLDSig) or its own is one of the things the profiling
   decides — the Manual's §13 and the event schema are the sources to read.
3. **The answer's mapping.** `rRetEnviEventoDe { dFecProc, gResProcEVe }` has to
   become `FiscalCancelOutcome`
   (`CANCELLED | CANCEL_PENDING | REJECTED | CONFIGURATION_ERROR | TRANSIENT_FAILURE`).
   **No mapping exists today**, and [[ADR-007]] §6 already notes that a SIFEN
   adapter "may never produce `CANCEL_PENDING` at all" because event reception
   is synchronous — so the story states which outcomes are reachable and why the
   unreachable ones are named.

## What exists to build on

- **The transport and the facade**:
  `facade.receiveEvent({ tenantId, dId, eventXml })` is implemented and tested;
  the serializer has `serializeEventReception`; the host map, the mTLS
  credential and the failure partition are [[FISC-012]]'s.
- **The credential**: one read serves the signature and the call, already wired
  in both apps.
- **The provider's seam**: `SifenDirectFiscalProvider`'s `cancel` is the single
  place that changes from a refusal to a submission.
- **The caller**: `apps/api/src/fiscal/fiscal.service.ts` calls
  `provider.cancel(...)` on the DEC-051 hand-off, and `fiscal_document_status`
  already carries `CANCEL_PENDING` and `CANCELLED`.

## Out of scope

- **The DE's own chain**: [[FISC-012]]'s, complete.
- **Contingency handling**: [[FISC-013]].
- **A generic "delete transaction"**: the project's rules forbid it, and a
  cancellation is an explicit business operation with a compensating record.

## Dependencies

- [[FISC-012]] — the facade, the transport, the credential wiring and the seam.
- The **retrieval record**: `Evento_v150.xsd` and `Evento_Types_v150.xsd` are
  named in §23.3 with their byte sizes; profiling them needs the files, and if
  they are not in the local artifact store they must be fetched and their
  publisher, version and byte size recorded as the vault requires.

## Exit Criteria

- [ ] Every event field, code and length traces to a cited DNIT source, and the
      profiling is recorded in `SIFEN-BASELINE.md` §23.3's own section.
- [ ] The event's signature profile is stated and implemented, or the story
      records why the event is unsigned if the sources say so.
- [ ] `cancel` submits the event through the facade and maps SIFEN's answer onto
      the port's outcome union, with the unreachable outcomes named.
- [ ] A refusal still exists for the states that cannot be cancelled, and it
      names the state rather than the layer.
- [ ] Lint/typecheck/tests/build green, `format-check` clean, and the
      cancellation path covered end to end with a real event document.

## Status

**Planned 2026-10-08.** Created by [[FISC-012]]'s implementation: its WU-E found
that `cancel` cannot be built without profiling the event payload, and that the
baseline assigns that profiling to the story that builds one. Nothing is
started, and until this story lands a SIFEN cancellation fails closed rather
than sending an event nobody validated.
