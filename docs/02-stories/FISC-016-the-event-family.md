---
id: FISC-016
type: story
title:
  The event family — the cancellation and the inutilización a real submission
  needs
epic: EPIC-16
status: in-progress
priority: high
depends_on:
  - FISC-012
prd_sections:
  - "22"
  - "23"
permissions: []
branch: feat/epic-16-fisc-016-events
created: 2026-10-08
updated: 2026-10-11
---

# FISC-016 — the event family

## Objective

Make cancellation work against SIFEN, and add the second event the DNIT's own
homologation requires. [[FISC-012]] left `cancel` answering
`CANCELLATION_EVENT_UNPROFILED` because SIFEN's cancellation is an _event_ and
the event's payload was never read; §25 of the baseline is now that profiling,
and this Story builds from it. Its outcome is that a tenant can cancel an
authorized document and void a number range, and that the events the test matrix
demands are implemented and tested.

## Context

The profiling (§25) answered what the epic's row left open, and it **corrected
three assumptions** the earlier sections invited:

- **The event's type is the ELEMENT NAME, not a code.** `tdTiGDE` — the one
  enumeration documented as "Tipo de Evento" — is a **dead catalogue** whose
  only carrier element is commented out. A builder that emitted a `dTiGDE` field
  would produce a document that validates against nothing. The type is expressed
  by which element sits under `gGroupTiEvt`.
- **The event reuses the DE's XMLDSig profile**, imported from the same
  `xmldsig-core-schema.xsd` — no second signing profile exists. The _algorithms_
  are not in the schema, so they come from the Manual's technology section.
- **The clock is local**, the same `fecHhmmss` the DE's `dFeEmiDE` uses;
  `tDateTimeUTC` is a dead definition in the same file. The environment is not
  in the document at all.

And it found **two things that change the plan**:

1. **The Guide's "Ajuste del Evento" has no payload.** The test matrix requires
   five receptor events and the schema defines exactly **four**. Either the
   Guide names one of the four or the action has no published payload; the
   retrieved set cannot resolve it, and **that part of the matrix cannot be
   completed as written**.
2. **The response's result codes are not evidenced.** `tdEstRes` is a free
   string and `tdCodRes` only fixes the four-digit shape, so the event's outcome
   vocabulary is as open as the DE's own catalogue. The mapping carries an
   unlisted code rather than coercing it, and the real codes arrive with
   [[FISC-013]]'s run.

**Why this is on the critical path**: the Guía de Pruebas requires the
**cancellation event five times** and the **inutilización five times**, both as
the emitter, plus four receptor events three times each. Without them the
homologation cannot be run at all.

## The two payloads

```text
rGeVeCan  { Id (the CDC, 44), mOtEve (the reason, 5..500) }            cancellation
rGeVeInu  { dNumTim, dEst, dPunExp, dNumIn, dNumFin, iTiDE, mOtEve,    inutilización
            dSerieNum? }                                               (no CDC)
```

Both sit under `gGroupTiEvt`, inside `rEve`, inside a `rGesEve` that carries the
event and its **required** signature as siblings. A lot holds up to fifteen
events.

## Work units

**WU-A — the profiling.** Landed: §25 of `SIFEN-BASELINE.md` with the retrieval
record (five artifacts, HTTP 200, byte sizes and md5s — two of which match
§23.3's record exactly), the envelope, the two payloads field by field, the
signature finding, the response, and the two findings above.

**WU-B — the event document.** The builder for `rGesEve`: the envelope, the two
payloads, and the **signature with the DE's own profile** — the signer
`packages/fiscal` already has, over the event's `rEve` subtree, with the same
certificate the DE uses (baseline §6: one certificate serves both). Plus the
decisions the schema leaves open: the event's `@Id` strategy (an integer up to
ten digits with no stated uniqueness) and the request's 15-digit `dId`.

**WU-C — the provider's `cancel`.** `SifenDirectFiscalProvider.cancel` stops
answering `CANCELLATION_EVENT_UNPROFILED` and submits the event through
`receiveEvent`, mapping the answer onto the port's cancel outcomes. The outcome
vocabulary is open (§25.5), so an unlisted code is carried and a transport
failure keeps the partition [[FISC-012]] established.

**WU-D — the inutilización.** The same builder's second payload and the surface
that triggers it: voiding a number range is a business operation with its own
reason, and its range must be validated against the tenant's timbrado — the
schema asserts none of it (§25.7).

**WU-E — the events' evidence.** The homologation's event cases, handed to
[[FISC-013]] rather than duplicated: this unit ends when the events the matrix
requires are the ones FISC-013 sends.

## Out of scope

- **The receptor events** (`rGeVeNotRec`, `rGeVeConf`, `rGeVeDisconf`,
  `rGeVeDescon`): the schema defines them and the matrix needs them, but a
  tenant in this product is the _issuer_, and a receptor surface is a different
  product decision. The builder's shape must not prevent them.
- **The endoso, the transporte and the nominación**: payloads the schema offers
  and nothing in this epic requires.
- **The "ajuste"**: no payload exists to build (§25.8).

## Dependencies

- [[FISC-012]] — the facade's `receiveEvent`, the transport, the credential
  wiring and the port's cancel vocabulary.
- **The retrieved artifacts** (§25) — on disk at the paths the profiling record
  names.

## Exit Criteria

- [ ] The event builder produces a document that **validates against the
      official event XSDs** and whose signature verifies with the certificate it
      carries.
- [ ] `cancel` submits through the facade and maps the answer onto the port's
      outcomes, with an unlisted result code carried rather than coerced.
- [ ] The inutilización is built and its range validated against the tenant's
      timbrado, with a named refusal for every state the schema does not assert.
- [ ] No secret — the CSC, the private key — reaches a log, a snapshot or an
      error message.
- [ ] Lint/typecheck/tests/build green, `format-check` clean, and the events the
      matrix requires are the ones FISC-013 sends.
- [ ] Every protocol constant cites §25 or the Manual's section that set it.

## Status

**In progress 2026-10-11.** WU-A landed: the event family is profiled in
`SIFEN-BASELINE.md` §25, which corrects three assumptions the earlier sections
invited and records two findings that change the plan. The implementation begins
with WU-B.
