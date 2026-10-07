---
id: FISC-011
type: story
title: Timbrado and numbering ranges per establishment, point and document type
epic: EPIC-16
status: in-progress
priority: high
depends_on:
  - FISC-006
prd_sections:
  - "23"
permissions:
  - fiscal.profile.manage
branch: feat/epic-16-fisc-011-timbrado-numbering
created: 2026-10-07
updated: 2026-10-07
---

# FISC-011 — Timbrado and numbering ranges

## Objective

Hold the emitter's fiscal profile and the authorised numbering ranges, and
**allocate the next document number** for a DE, with the series progression the
Manual prescribes. It is the storage [[DEC-054]] assigned to this Story, and it
is what unblocks the worker's signing stage inherited by [[FISC-012]].

## Context

[[FISC-008]]'s mapper takes an `EmitterFiscalProfile` **as an input** — DEC-054
chose that on purpose, so the mapper stayed pure and the storage decision landed
here. Nothing in the application stores an emitter profile or a timbrado today;
this Story is that storage and the numbering that goes with it.

It needs no ADR: the epic's ADR list carries only [[ADR-006]] (the signing
dependency) and ADR-007 (the port's asynchronous status, [[FISC-012]]). Three
tenant-scoped tables and a numbering counter are a domain model inside the
existing architecture, not a change to it. The invariants below are pinned here
instead, and they are the part that must not drift.

## The contract, pinned

### The identifying sequence — Manual §10.5

```text
Número de timbrado
Establecimiento
Punto de expedición
Tipo de documento
Número de documento
Serie
```

### The series order is lexicographic, and skipping is not allowed

The Manual states the order and then makes it a validation:

> "Inicialmente no se utilizará serie hasta consumir toda la numeración que va
> desde 0000001 al 9999999 para cada tipo de documento, luego se tendrá que
> hacer uso de la serie según el siguiente orden. • Orden de Serie: AA, AB, AC,
> … , AZ …BA, BB, …., BZ, … ZA, ZB, … , ZZ El sistema validará la secuencialidad
> del uso de la serie."

So: **the initial range carries no series**, the whole `0000001`–`9999999` range
is consumed **per document type**, and only then does `AA` start. The order is
exactly lexicographic over two letters `A`–`Z`, which is why `Ñ` needs no
special case: it is not in `A`–`Z`, and `tdSerieNum` is `[A-Z]{2}` (baseline
§21.3).

### The series' start date comes from the DE, not from us

> "Una vez que el SIFEN reciba un DE con serie, se tomará la fecha y hora de
> firma digital del DE como fecha inicial de inicio de la vigencia de la serie."

And SIFEN approves only three cases — which is the constraint that makes an
invented series order a rejection rather than a cosmetic difference:

```text
serie inmediatamente anterior   signature date EARLIER than the current series' start
serie igual                     always
serie inmediatamente posterior  signature date LATER than the current series' start
```

**Consequence for us**: the allocation cannot know the series' start date,
because the signature happens _after_ the number is allocated (the number is
part of the CDC, and the CDC is signed). So the start date is recorded in a
**second, set-once step** once the DE has been signed.

### A consumed number is never reused — Manual §6.5

If a DE fails validation and the correction does not change the CDC, the **same
CDC is reused** and the document resubmitted (baseline §12). **The number is
part of the CDC**, so a rejected document keeps its number, and that number can
never be handed to a different document. Allocation is therefore **monotonic and
never reused** — the same discipline the stock and cash ledgers use, and the
reason this Story has a counter and not a "free numbers" query.

## In Scope

- The emitter fiscal profile: tenant-level identity (`D101`–`D1xx`), as the
  input `EmitterFiscalProfile` requires.
- The establishment: its code (`dEst`) and address, which is where `dDirEmi`,
  `dNumCas`, `cDepEmi` and `dDisEmi` belong.
- The authorised numbering ranges, per establishment, expedition point, document
  type and series, with their validity start and their counter.
- **The allocation**: the next document number, with the series progression of
  §10.5, as an **internal service** [[FISC-012]] calls — not a route.
- The read path that assembles `EmitterFiscalProfile` for the mapper.
- HTTP routes to configure all three, behind a new permission, with audit and
  tenant isolation.

## Out of Scope

- **Any DNIT call, and the timbrado's own issuance.** A timbrado is generated
  through the **SGTM** (baseline §15); it arrives here as data an operator
  enters.
- **A UI.** HTTP routes only, as [[FISC-007]] did; the staff panel stays
  follow-up work.
- **The CDC.** `composeCdc` exists and takes the number; composing it is the
  caller's.
- **The signature timestamp.** The allocation records a series' start from a
  timestamp the caller supplies; it does not produce one.
- **Contingency.** `iTipEmi = 2` is an input of the profile, not a behaviour of
  this Story.
- **Multi-establishment reporting, KuDE, the portal surface.**

## Acceptance Criteria

- [ ] `fiscal_emitter_profile`, `fiscal_establishment` and
      `fiscal_timbrado_range` exist, tenant-scoped, with the constraints that
      make the invariants below unrepresentable when violated.
- [ ] A tenant has **at most one** emitter profile, and a timbrado range is
      unique on
      `(tenant, establishment, expedition point, document type, series)`.
- [ ] The allocation returns the next `dNumDoc` for a
      `(establishment, point, document type)` and **never returns the same
      number twice**, under concurrent callers.
- [ ] The allocation is **monotonic**: a number is never reissued, and retiring
      or exhausting a range never frees one.
- [ ] When a range is exhausted, the allocation **advances to the next series in
      lexicographic order** (`null -> AA -> AB -> … -> AZ -> BA -> … -> ZZ`),
      opening that series' row and marking the previous one `EXHAUSTED`. _(the
      order itself is WU-B, done; the row work is WU-D)_
- [ ] `ZZ` exhausted is a terminal state: the allocation fails with a named
      failure rather than wrapping or reusing. _(WU-B returns `null` and refuses
      any successor of `ZZ`; WU-D surfaces it as the allocation's failure)_
- [ ] A series is **never skipped**: the allocation cannot produce a series that
      is not the successor of the current one. _(WU-B's `assertSeriesSuccession`
      makes the check local and loud; WU-D calls it)_
- [ ] `series_started_at` is **set once**, from the signature timestamp the
      caller supplies after signing, and a second call never overwrites it.
- [ ] A range that has allocated at least one number **cannot be deleted**, and
      its counter cannot be lowered.
- [ ] The assembled `EmitterFiscalProfile` satisfies
      `buildDteRequestFromInvoice` for a fixture invoice: the mapper accepts it
      with no change to the mapper.
- [ ] The RUC in the profile is the one the certificate carries (§22.4) —
      enforced or refused, never silently accepted.
- [ ] Every route requires `fiscal.profile.manage`; a cross-tenant read or write
      returns `404`.
- [ ] Lint, typecheck, unit tests, the live-PostgreSQL gate and the build pass.

## Domain Invariants

- **No protocol constant without a cited official source.** Every rule above
  traces to Manual §10.5, §6.5 or baseline §21.3.
- **Allocation is monotonic and never reused**, because the number is part of
  the CDC and a rejected DE keeps its CDC.
- **The series order is validated, not merely followed.** SIFEN rejects a series
  that is not the previous, the current, or the next one, so an out-of-order
  series is a rejected document rather than a cosmetic difference.
- **A number is allocated inside a transaction, by compare-and-swap**, so two
  concurrent callers cannot take the same one. A read-then-write is a defect,
  not a style choice.
- **Nothing here is derived from the wall clock.** The validity start is data,
  and the series' start is supplied.

## API

```text
POST   /fiscal/emitter-profile
GET    /fiscal/emitter-profile
PATCH  /fiscal/emitter-profile

POST   /fiscal/establishments
GET    /fiscal/establishments
PATCH  /fiscal/establishments/:id

POST   /fiscal/timbrado-ranges
GET    /fiscal/timbrado-ranges
PATCH  /fiscal/timbrado-ranges/:id
POST   /fiscal/timbrado-ranges/:id/retire
```

Every one requires `fiscal.profile.manage`. Cross-tenant access to a resource id
returns `404`.

**The allocation is deliberately not a route.** It is a service method
[[FISC-012]] calls while building a DE; exposing it over HTTP would let a caller
burn numbers without issuing anything.

## Database

Three tables and two enums, one migration:

```text
fiscal_emitter_profile   one per tenant; RUC, DV, taxpayer type, name, trade
                         name, activity, obligations
fiscal_establishment     unique (tenant, code); the address the DE carries
fiscal_timbrado_range    unique (tenant, establishment, point, document type,
                         series); the range, the validity start, the counter,
                         series_started_at, status
```

`fiscal_timbrado_range.status` is `ACTIVE | EXHAUSTED | RETIRED`. `RETIRED` is
what an operator does instead of deleting: a range that has consumed numbers is
history, not configuration.

## UI

- None. HTTP routes only.

## Implementation Summary

**WU-A — the Story and the baseline correction.** The Manual's §10.5 was
extracted in full and three rules it states were added to `SIFEN-BASELINE.md`
§13 verbatim: the lexicographic series order with sequentiality as a validation,
the seriesless initial range consumed per document type, and the series' start
date being the DE's digital-signature date-time.

**WU-B — the pure series order.** `packages/fiscal/src/timbrado/series.ts`:
`nextSeries`, `seriesOrdinal` / `seriesFromOrdinal`, `assertSeriesSuccession`
and `assertValidSeries`, with `FIRST_SERIES`, `LAST_SERIES` and `SERIES_COUNT`.
`null` is modelled as a real state — the seriesless initial range — rather than
a missing value, because the Manual's order starts there. **`Ñ` has no special
case on purpose**: it is excluded because it is not in `A`–`Z`, and `tdSerieNum`
is `[A-Z]{2}`, so a hand-written skip rule would be an invention. The suite
walks all 676 series and asserts both facts.

`SERIES_PATTERN` in `dte.rules.ts` became exported rather than copied: the
series order is the same protocol constant read in the other direction, and a
second copy would be a second place for it to drift.

## Verification

```text
pnpm --filter @newsaas/fiscal lint       green
pnpm --filter @newsaas/fiscal typecheck  green
pnpm --filter @newsaas/fiscal test       green - 185 tests, 14 files
   run with DTE_XSD_REQUIRED=1, so the official-schema gate ran instead of skipping
pnpm --filter @newsaas/fiscal build      green
pnpm lint / typecheck / test / build     green - 18/18, 18/18, 19/19, 11/11
pnpm format-check                        green, and it converges in two passes
live-PostgreSQL gate                     not run - no schema change yet (WU-C)
```

## Tests Added

`packages/fiscal/src/timbrado/series.test.ts`, 21 cases (WU-B):

- The order walked against the Manual's printed sequence, across the `AZ -> BA`
  boundary the Manual writes as "… , AZ …BA, BB, …".
- All **676** series produced by walking from `null`: unique, `[A-Z]{2}`, and
  **none containing `Ñ`** — so a hand-written skip rule cannot creep in.
- `ZZ` is ordinal 675 and its successor is `null`, so it is terminal and does
  not wrap.
- The ordinals round-trip for every series, and out-of-range ordinals are
  refused.
- A skip (`AA -> AC`), a backwards step (`BA -> AZ`) and any successor of `ZZ`
  are all refused by `assertSeriesSuccession`.
- The pattern refuses `ÑA`, `AÑ`, lowercase, digits, the wrong length and the
  empty string.

Planned for the remaining units:

- The allocation under concurrency: N parallel callers receive N distinct
  numbers.
- The allocation under concurrency: N parallel callers receive N distinct
  numbers.
- Monotonicity across an exhaustion boundary: the last number of one series and
  the first of the next are consecutive in the sequence and distinct.
- `series_started_at` set-once.
- The no-delete and no-lower-counter guards.
- The assembled profile accepted by `buildDteRequestFromInvoice`.
- Cross-tenant `404` on every route.

## Known Limitations

- **The series' start date is recorded by us from the DE's signature timestamp,
  which is what the Manual says SIFEN will do on receipt.** We cannot verify
  that SIFEN agrees until homologation ([[FISC-013]]).
- **No timbrado is issued here.** The SGTM does that; this Story stores what an
  operator enters.
- **A single active range per `(establishment, point, document type)`.** If two
  ranges could be active at once, the allocation would have to choose, and the
  Manual does not describe that state.
- **The activity code table (`D131`) is still open** ([[FISC-008]]'s notes), so
  the profile stores the code the operator supplies without validating it
  against Tabla 3.

## Technical Debt

- None yet. Any advisory this Story's review produces is recorded here.

## Decisions / ADRs

- **[[DEC-054]] option B** — FISC-011 owns the emitter profile's storage, and
  the mapper takes the profile as an input. This Story is that storage; the
  mapper is unchanged.

## Files / Modules

```text
packages/database/prisma/schema.prisma        three tables and two enums
packages/fiscal/src/timbrado/series.ts        the series order, pure
packages/fiscal/src/timbrado/series.test.ts   21 cases
packages/fiscal/src/dte/dte.rules.ts          exports SERIES_PATTERN, one source
apps/api/src/fiscal/profile/**                routes, service, repository
docs/06-fiscal/SIFEN-BASELINE.md              §13 carries the Manual's full text
odd/tasks/epic-16-sifen-direct.md             the epic tracker, T7
```

## Completion Notes

_Status must remain non-`done` until every acceptance criterion and gate
passes._
