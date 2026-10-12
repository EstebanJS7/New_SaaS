# Feature: FISC-016 — the event family (the cancellation and the inutilización)

**Branch**: `feat/epic-16-fisc-016-events` (from `main`) **Story**:
`docs/02-stories/FISC-016-the-event-family.md` **Baseline**:
`docs/06-fiscal/SIFEN-BASELINE.md` §25 (the profile)

## Goal

Make cancellation work against SIFEN and add the inutilización, the two events
the DNIT's own homologation requires. `cancel` currently answers
`CANCELLATION_EVENT_UNPROFILED`; the profile is §25 and this feature builds from
it.

## Constraints the profile pinned

- **The event's type is the element name**, not a code: `tdTiGDE` is a dead
  catalogue. The builder must never emit a `dTiGDE` field.
- **The event reuses the DE's XMLDSig profile** — the same
  `xmldsig-core-schema.xsd`, and the algorithms come from the Manual
  (§7.6/§7.7), not from the schema.
- **The clock is local**: `fecHhmmss`, no timezone, same as `dFeEmiDE`.
- **`rGesEve` is `{ rEve, ds:Signature }`** with the signature **required** and
  a **sibling** of the event. `rEve/@Id` is an integer 1..9999999999.
- **The cancellation** is exactly `Id` (the CDC, 44) + `mOtEve` (5..500). **The
  inutilización** is `dNumTim` (8) + `dEst` (3) + `dPunExp` (3) + `dNumIn` +
  `dNumFin` + `iTiDE` (1..9) + `mOtEve` + optional `dSerieNum` (`[A-Z]{2}`), and
  carries **no CDC**.
- The schema asserts nothing about the range's sanity: `dNumIn ≤ dNumFin`, the
  range's place inside the timbrado's grant and the `iTiDE`/timbrado match are
  the builder's own rules.
- `tVerFor` admits `141` or `150`; the event document uses **150**.
- The request is
  `rEnviEventoDe { dId (15-digit integer), dEvReg { gGroupGesEve } }` and a lot
  holds up to **15 events**.

## The decisions this feature owns

1. **Both identifiers are caller-supplied; the builder validates and never
   invents.** The builder is pure — no ambient clock, no randomness — so
   `rEve/@Id` (1..9999999999) and the request's `dId` (1..999999999999999)
   arrive as arguments. **The strategy**: the event's `@Id` is its **ordinal
   within the lot** (1..15), and the request's `dId` is one value per
   submission, supplied by the worker in WU-C. No generator is invented here
   because the schema states no uniqueness for either.
2. **The signature references the event body**, `#<rEve/@Id>`, and is inserted
   **after `rEve`, inside `rGesEve`** — the analogue of the DE's `#<cdc>` with
   the signature after `DE`. The profile's constants are the DE's, shared, not
   copied.
3. **The event entry artifact is `WS_SiRecepEvento_v150.xsd`**, whose include
   chain reaches `protProcesEventos_v141.xsd` and `Evento_v150.xsd`, which in
   turn includes `Evento_Types_v150.xsd`, `Paises_v100.xsd`,
   `Departamentos_v141.xsd` and `DE_Types_v150.xsd`. Four artifacts are new; the
   rest are already fetched for the DE. `siRecepEvento_v150.xsd` is **not** in
   the chain and is not fetched.

## Work units

- [x] **WU-A — the profiling.** `SIFEN-BASELINE.md` §25. Commit `996d86e`. It
      corrected three assumptions and recorded two findings that change the plan
      (the Guide's "ajuste" has no payload; the response's result codes are not
      evidenced).
- [x] **WU-B — the event document.** The builder for the envelope and the two
      payloads, the signer reusing the DE's profile, the rules the schema does
      not assert, the four new artifacts and the generalized XSD gate, and the
      proof that a built-and-signed event validates against the official
      schemas. **The proof ran**: a signed cancellation, a signed inutilización,
      a mixed two-event lot and a fifteen-event lot all validate against the
      DNIT's own bytes with the skip disabled. Three things the schema forced:
      the inutilización's `iTiDE` is `tiTiDEEv` (1..9), **not** the DE's
      `tiTiDE` — 2, 3 and 8 are event-legal and DE-illegal; both identifiers
      tolerate leading zeros, because the schema's facets admit them and state
      no canonical form; and the lot's `@Id` uniqueness is asserted by the
      signer, which is where the reference is built.
- [x] **WU-C — the provider's `cancel`.** Done.
      `SifenDirectFiscalProvider.cancel` stops answering
      `CANCELLATION_EVENT_UNPROFILED` (the reason code is retired) and submits
      the caller's signed `gGroupGesEve` through `receiveEvent`; the answer's
      `dEstRes` maps `Aprobado`/`Aprobado con observación` to `CANCELLED` and
      `Rechazado` to `REJECTED`, and an unlisted `dCodRes` is carried verbatim,
      never coerced (§25.5). A requiring provider handed `document: null`
      answers the same `CONFIGURATION_ERROR` `issue` does — ADR-009 amended for
      cancel. **The defect on the way is fixed**: `serializeEventReception`
      embeds the `gGroupGesEve` under `dEvReg`, asserts that root (leading
      indentation aside, because the group is rendered at its envelope's
      column), and `buildEventXml` composes the same group bytes so the two
      surfaces cannot drift. The API builds and signs the event for a requiring
      provider — `buildEventGroupXml → signEventXml`, credential read per call,
      local `dFecFirma` from its own clock. Proof: the whole serialized envelope
      validates against `WS_SiRecepEvento_v150.xsd` with `DTE_XSD_REQUIRED=1`
      (`xsd-event-validation.test.ts`).
- [ ] **WU-D — the inutilización's surface.** Voiding a range is a business
      operation with its own reason, and its range is validated against the
      tenant's timbrado.
- [ ] **WU-E — the events' evidence**, handed to FISC-013 rather than
      duplicated.

## Evidence log

```text
996d86e  docs(FISC-016): profile the event family (WU-A)   review-6283a69635a236fe (low)
(pending)  feat(FISC-016): the provider's cancel — the submission, the fix and
           the proof (WU-C)
```

The WU-C line is owed by the parent orchestrator: this implementation unit does
not commit.

## Open

- The event's **result codes** are not evidenced by any retrieved source
  (§25.5): the mapping carries an unlisted code and the real vocabulary arrives
  with FISC-013's run.
- The Guide's **"Ajuste del Evento"** has no payload (§25.9): the matrix row
  cannot be completed as written and FISC-013 owns the finding.
- **The range's containment inside the tenant's timbrado, and the
  `iTiDE`/timbrado match, are not the builder's** (§25.7): the builder is pure
  and has no timbrado. WU-D owns that comparison.
- **A stale prepared directory** (`/tmp/newsaas-dte-xsd`, the DE's seven only)
  now reports unusable, so the XSD suites skip visibly. Re-run
  `pnpm fetch:dte-schemas` after this change.
- **The baseline's §25 was inserted twice** by this unit's rebase resolution.
  Fixed before WU-B's commit: one block, at the end of the file, after §24.
