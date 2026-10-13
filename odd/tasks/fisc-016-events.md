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
- [x] **WU-D — the inutilización's surface.** Done. Voiding a range is a
      business operation with its own reason, and the range is read from the
      tenant rather than supplied: the operation voids the **remaining tail**
      (`nextNumber .. rangeTo`), because a consumed number is burnt and a void
      covering one would be a lie about the tenant's own history. The terminal
      status is the existing `RETIRED` — no enum value was added — and the flip
      shares one transaction with the record. `fiscal_range_void` is a new
      tenant-scoped, append-only aggregate (one row per attempt, so a refusal is
      recorded as faithfully as an acceptance) with its migration, its
      tenant-scoped store in `packages/fiscal-persistence`, and isolation cases
      in the live-PostgreSQL suite. The port gained `voidRange` with its **own**
      outcome union (`VOIDED`/`REJECTED`/`CONFIGURATION_ERROR`/
      `TRANSIENT_FAILURE`) and no protocol vocabulary; `FiscalIssueDocument.cdc`
      became nullable so a void can report **no** document identity instead of a
      fabricated one (§25.3 — an inutilización names a range, and it carries no
      `Id`). The mapping is pure and total in `sifen.outcomes.ts`
      (`mapEventReceptionVoidOutcome`), carries an unlisted `dCodRes` verbatim
      (§25.5), takes `dProtAut` as the operation's reference, and refuses a
      `null` document with the same `CONFIGURATION_ERROR` `issue` and `cancel`
      answer. The API's route is `POST /fiscal/timbrado-ranges/:id/void`, with
      its own `fiscal.range.void` permission, the `fiscal` entitlement first,
      the provider call outside any transaction under the cancellation's 10 s
      deadline, and one transaction that flips the range and writes the record
      plus the audit row. Every state the schema does not assert (§25.7) is
      refused **by name**.
- [ ] **WU-E — the events' evidence**, handed to FISC-013 rather than
      duplicated.

## WU-D — the decisions this unit had to make, and its evidence

The brief pinned the tail, the status, the aggregate, the port's capability and
the route. Five things it did not pin, decided here and recorded so a reviewer
can disagree with the reasoning rather than guess it:

1. **`FiscalIssueDocument.cdc` became `string | null`.** The brief says the void
   request carries ADR-009's `document: FiscalIssueDocument | null`, and that
   carrier's `cdc` was a required string. An inutilización names a number range
   and carries **no** `Id` (§25.3), so there is no honest CDC to put there; a
   fabricated one (a UUID, the range's identity rendered as a string) would put
   a value in a CDC slot that no service issued. The field is now nullable and
   documented as "the identity of what the document is about, when its family
   carries one" — the cancellation still passes its CDC, and the void passes
   `null`.
2. **The void is recorded per ATTEMPT, not once per success.** `outcome`,
   `reason_code`, `provider_reason` and `provider_reference` are only meaningful
   if a refusal is stored, and "these numbers were offered and the service
   refused them" is a fact an operator must be able to read. `range_status` is
   the status the attempt left the range in, which is what lets the DB CHECK
   relate the record to the flip (`outcome = 'VOIDED'` implies
   `range_status <> 'ACTIVE'`) without forbidding a refusal's row.
3. **Only an accepted void flips the range.** A refusal must not retire it: a
   `RETIRED` range has no way back, so a failed submission would destroy an
   authorisation as a side effect. The compare-and-swap runs only for `VOIDED`,
   and the caller's `409` names the provider's reason rather than "the range
   moved".
4. **The interval's lower bound is the tail observed BEFORE the provider call**,
   and the record keeps it even when a concurrent issuance moved the counter:
   the record must describe what was sent, not what the counter says afterwards.
   A `VOIDED` answer whose compare-and-swap then fails (another actor retired or
   exhausted the range) is a `409`, and the record still stands.
5. **The reason's `mOtEve` domain (5..500) is checked for EVERY provider**, not
   only for one that requires a document. The reason is stored in the record's
   own column whether or not a builder ever sees it, so the rule cannot be the
   builder's alone; a shorter reason is a `400` before any read of the provider.

Also decided here: `FiscalRangeVoidOutcome` is its own union (the cancellation's
`CANCELLED`/`CANCEL_PENDING` are about a document's fate, and nothing cancels a
document here); the provider's `dProtAut` is the void's `providerReference` (the
answer's `id` is "the emitter's own identifier for what the event is about", and
a range is not a document); the row's provider columns are `reason_code`,
`provider_reason` and `provider_reference` so the tenant's own `reason` never
collides with a service's message; and a range whose document type is `10` is
refused, because `tiTiDEEv` stops at 9 while `tiTiDE` admits 10 (§25.2).

**Two extractions inside this unit**, both to keep one rule in one place rather
than to tidy anything: `runWithinDeadline`
(`apps/api/src/fiscal/fiscal.deadline.ts`) is the cancellation's timer, raced
and cleared, and `cancelWithinDeadline` is now this command's naming of it — the
brief asks the void for "the same deadline discipline the cancel path uses", and
a second copy of a timer would be a second discipline. `scrubProviderText`
(`fiscal.provider-text.ts`) is the 500-character control-character-flattening
rule the cancellation's `last_error_*` columns already applied; two commands now
persist provider text, so the policy is shared and the cancellation's behaviour
is unchanged (its own suite is the proof).

**Verification.** Fiscal 683/708 (the schema-dependent suites included),
database 455, fiscal-persistence 32, API 1172 passed with 2 failing pins, and
the live-PostgreSQL suite 232/232 against a real PostgreSQL 16.13. The two
failures are the route-contract probe's own pins — a file outside this unit's
edit surface — and they name the new route exactly:
`UNDECLARED NEW ROUTE: POST /fiscal/timbrado-ranges/:id/void` and
`UNDECLARED FISCAL ROUTE: POST /fiscal/timbrado-ranges/:id/void`. The fix is two
lines in `apps/api/src/rbac/route-contract.probe.test.ts`: the route in
`EXPECTED_ROUTE_INVENTORY`, and the route mapped to
`FISCAL_PERMISSIONS.rangeVoid` in `FISCAL_PERMISSION_BY_ROUTE`.

## Evidence log

```text
996d86e  docs(FISC-016): profile the event family (WU-A)   review-6283a69635a236fe (low)
(pending)  feat(FISC-016): the provider's cancel — the submission, the fix and
           the proof (WU-C)
(pending)  feat(FISC-016): the inutilización's business surface — the tail, the
           record and every refusal by name (WU-D)
```

The WU-C and WU-D lines are owed by the parent orchestrator: this implementation
unit does not commit.

## Open

- The event's **result codes** are not evidenced by any retrieved source
  (§25.5): the mapping carries an unlisted code and the real vocabulary arrives
  with FISC-013's run.
- The Guide's **"Ajuste del Evento"** has no payload (§25.9): the matrix row
  cannot be completed as written and FISC-013 owns the finding.
- **The range's containment inside the tenant's timbrado, and the
  `iTiDE`/timbrado match, are not the builder's** (§25.7): the builder is pure
  and has no timbrado. **WU-D landed that comparison**: the range is read from
  the tenant, the payload's `iTiDE` is the range's own document type (narrowed
  to the event's enumeration, with type 10 refused), and the interval is the
  range's tail. No second timbrado lookup is needed — the range IS the
  authorisation, and its own key carries the timbrado number, the establishment,
  the point and the document type as one composite identity (FISC-011).
- **The claim state exists, and so does the in-flight guard.** The operation is
  **claim → submit → settle**: the range is claimed `ACTIVE → VOIDING` with a
  compare-and-swap on the observed counter **before** any provider call, the
  provider is called outside any transaction, and the settlement flips
  `VOIDING → RETIRED` (accepted) or back to `ACTIVE` (refused — the counter was
  never touched, so nothing is burnt) while closing the record. The record
  carries an `attempt` counter and a `claimed_at` lease; the claim moves
  `PENDING → IN_FLIGHT` before the call, so a **second** caller sees `IN_FLIGHT`
  and answers a named `409` **without calling the provider**, and only a claim
  whose lease has expired (60 s, 6× the provider deadline) may be adopted. That
  is what makes a timeout recoverable without reopening the duplicate hole.
- **Four review rounds, one defect family, all fixed.** (1) The provider was
  called before the local lock. (2) The settlement returned `null` from inside a
  Prisma interactive transaction, which **commits** the partial writes instead
  of rolling them back. (3) The adoption added to fix the wedge was a lock-free
  read, so a second adopter still reached the provider; the attempt CAS that
  followed narrowed the window but did not close it, and the targeted validator
  **rejected** it — the correction's own test documented the residual by
  asserting two provider calls. (4) The in-flight state above closes it, and the
  test now asserts **one** provider call.
- **Two residual advisories from the final review**, both non-blocking: a void
  may still be re-driven with the _caller's new reason_ while the immutable
  record keeps the original text, and the timeout leaves the claim `IN_FLIGHT`
  with no automatic reconciliation sweep yet — a retry after the lease does it,
  and an operator can too.
- **A stale prepared directory** (`/tmp/newsaas-dte-xsd`, the DE's seven only)
  now reports unusable, so the XSD suites skip visibly. Re-run
  `pnpm fetch:dte-schemas` after this change.
- **The baseline's §25 was inserted twice** by this unit's rebase resolution.
  Fixed before WU-B's commit: one block, at the end of the file, after §24.
