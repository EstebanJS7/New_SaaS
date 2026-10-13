---
id: FISC-016
type: story
title:
  The event family — the cancellation and the inutilización a real submission
  needs
epic: EPIC-16
status: done
priority: high
depends_on:
  - FISC-012
prd_sections:
  - "22"
  - "23"
permissions: []
branch: feat/epic-16-fisc-016-events
created: 2026-10-08
updated: 2026-10-12
---

# FISC-016 — the event family

## Objective

Make cancellation work against SIFEN, and add the second event the DNIT's own
homologation requires. [[FISC-012]] left `cancel` answering
`CANCELLATION_EVENT_UNPROFILED` — a code this Story **retired** — because
SIFEN's cancellation is an _event_ and the event's payload was never read; §25
of the baseline is now that profiling, and this Story builds from it. Its
outcome is that a tenant can cancel an authorized document and void a number
range, and that the events the test matrix demands are implemented and tested.

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

**WU-B — the event document.** **Landed.** The builder for `rGesEve`: the
envelope, the two payloads, and the **signature with the DE's own profile** —
the profile's constants imported from the DE's signer, one signature per event,
each referencing `#<rEve/@Id>` and inserted after `rEve` inside its own
`rGesEve`. Plus the decisions the schema leaves open: both identifiers are
**caller-supplied and validated, never generated** (the schema states no
uniqueness for either), the lot carries 1..15 events, and the rules the schema
does not assert are named refusals. **The acceptance criterion is met**: a
signed cancellation, a signed inutilización, a mixed two-event lot and a
fifteen-event lot all validate against the DNIT's own bytes with the skip
disabled.

**WU-C — the provider's `cancel`.** **Landed.**
`SifenDirectFiscalProvider.cancel` stops answering
`CANCELLATION_EVENT_UNPROFILED` — the code is gone from the source — and submits
the caller's signed event group through `receiveEvent`, mapping the answer onto
the port's cancel outcomes. `FiscalCancelRequest` gains ADR-009's required
`document`, so a requiring provider handed `null` refuses with
`CONFIGURATION_ERROR` and sends nothing. The outcome vocabulary is open (§25.5),
so an unlisted code is carried verbatim and a transport failure keeps the
partition [[FISC-012]] established. **It also fixed a defect FISC-012 left**:
its `serializeEventReception` omitted the `gGroupGesEve` wrapper the schema
requires, so what it produced would not have validated — proven by the official
XSD's own message, _"Element rGesEve: This element is not expected. Expected is
( gGroupGesEve )"_.

**WU-D — the inutilización.** **Landed.** The same builder's second payload and
the business operation that triggers it. The port gains its own `voidRange`
capability with its own outcome union
(`VOIDED`/`REJECTED`/`CONFIGURATION_ERROR`/ `TRANSIENT_FAILURE` — the
cancellation's words are about a document's fate and none of them applies here),
the adapter submits the caller's signed `gGroupGesEve` through the same service
and never fabricates a document identity (an inutilización names a range,
§25.3), and the fake scripts it. `POST /fiscal/timbrado-ranges/:id/void` carries
a reason and nothing else: the interval is the range's **remaining tail**
(`nextNumber .. rangeTo`), because a consumed number is burnt and a void
covering one would be a lie about the tenant's own history. `fiscal_range_void`
records each attempt once, append-only, and the flip to `RETIRED` and that
record are one transaction. The operation is **claim → submit → settle**: the
range is claimed before any provider call, and the claim carries an in-flight
state with a lease, so a second void answers a named `409` **without submitting
anything** while a claim whose lease expired is still recoverable. Getting that
right took **four review rounds and four findings of one family** — the
ordering, a Prisma transaction that committed partial writes on a `null` return,
and the duplicate submission twice — and the final review approved it with nine
non-blocking advisories. Every state the schema does not assert (§25.7) is
refused **by name**: `RETIRED`, an empty tail (the range is exhausted, whether
the column says so or the counter has simply reached one past the end), a
document type the event cannot express (`tiTiDEEv` stops at 9 while a range may
carry 10), and a reason outside `mOtEve`'s domain. Its own permission
`fiscal.range.void` was added rather than overloading `fiscal.invoice.issue` or
`fiscal.profile.manage`.

**WU-E — the events' evidence.** **Landed.** The hand-off is recorded rather
than duplicated: the homologation's matrix lives in [[FISC-013]]'s story, which
is on `feat/epic-16-fisc-015-document-assembly` (PR #114) and reaches `main`
with it. What this unit fixes is **which rows the events now satisfy**:

- **Cancellation ×5** — satisfied by the provider's `cancel`, which submits the
  caller's signed event group and maps the answer
  (`Aprobado`/`Aprobado con observación` → `CANCELLED`, `Rechazado` →
  `REJECTED`, an unlisted `dCodRes` carried verbatim).
- **Inutilización ×5** — satisfied by `POST /fiscal/timbrado-ranges/:id/void`,
  which is the same submission path with the range's own interval.
- **Five receptor events ×3** — **not satisfiable**: four of them are the
  schema's four payloads and the fifth, the Guide's "Ajuste del Evento", **has
  no payload at all** (§25.9). This row cannot be completed as written, and the
  finding belongs to FISC-013.
- The document rows (5 sync + 5 async per type, KuDE + QR) are FISC-015's and
  FISC-012's, already landed.

The events the matrix requires are now the ones this epic sends; the run itself
waits on the DNIT's habilitación, which is FISC-013's.

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

- [x] The event builder produces a document that **validates against the
      official event XSDs** and whose signature verifies with the certificate it
      carries.
- [x] `cancel` submits through the facade and maps the answer onto the port's
      outcomes, with an unlisted result code carried rather than coerced.
- [x] The inutilización is built and its range validated against the tenant's
      timbrado, with a named refusal for every state the schema does not assert
      (FISC-016 WU-D: `assertRangeVoidable`, and the tenant-scoped read that
      makes another tenant's range a `404`).
- [x] No secret — the CSC, the private key — reaches a log, a snapshot or an
      error message. Checked by reading every error and log path in the event's
      code: the key is never named outside the signer's arguments, the
      provider's text is scrubbed to 500 characters before it is persisted
      (`fiscal.provider-text.ts`), and no snapshot carries key material.
- [x] Lint/typecheck/tests/build green, `format-check` clean, and the events the
      matrix requires are the ones FISC-013 sends. The gates ran on the final
      tree: root lint, typecheck, test 21/21, build and `format-check` green;
      fiscal **708** with `DTE_XSD_REQUIRED=1` (0 skipped), api **1183**,
      database **459**, fiscal-persistence **32**, worker **140**,
      live-PostgreSQL **234/234**. CI's three jobs pass on PR #115.
- [x] Every protocol constant cites §25 or the Manual's section that set it. The
      event's constants each carry their source (`tVerFor` §25.6, `tdIdEve`,
      `dId`, `tmotEve`, `tiTiDEEv` with the artifact and line), and the void's
      own (the deadline, the lease and its ratio to the deadline) say what set
      them.

## Status

**In progress 2026-10-11.** WU-A landed: the event family is profiled in
`SIFEN-BASELINE.md` §25. **WU-B landed**: the document exists, is signed with
the DE's profile, and validates against the official schemas. **WU-C landed**:
`cancel` submits the caller's signed event and maps the answer, the retired
reason code is gone from the source, and the whole submitted envelope is proven
against the official schema — the second exit criterion is met. **WU-D landed**:
the inutilización's business surface — the port's `voidRange`, the adapter's
submission, the `fiscal_range_void` record with its migration and tenant-scoped
store, the route with its own permission, and a named refusal for every state
the schema does not assert. Its rules are recorded in `SIFEN-BASELINE.md`
§25.10. **WU-E landed**: the hand-off is recorded — which matrix rows the events
satisfy and which they cannot — and the story closes.

**Done 2026-10-12.** All six exit criteria are met and the gates ran on the
final tree. What the epic leaves open belongs to other stories: the homologation
run waits on the DNIT's habilitación ([[FISC-013]]), the receptor events are a
different product decision, and the Guide's "Ajuste del Evento" has no payload
to build. Four findings from the reviews are recorded as [[TD-033]].

**The verification gap is closed.** The route-contract probe's two pins
(`EXPECTED_ROUTE_INVENTORY` and `FISCAL_PERMISSION_BY_ROUTE`, the latter mapped
to `FISCAL_PERMISSIONS.rangeVoid`) were added with WU-D unit 1, and the suite is
green: api **1183**, live-PostgreSQL **234/234** with the void's own isolation
block.
