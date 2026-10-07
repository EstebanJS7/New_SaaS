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
- [x] A range that has allocated at least one number **cannot be deleted**, and
      its counter cannot be lowered. _(WU-C: the deletion is a trigger, and the
      counter's monotonicity is a trigger because a CHECK cannot see the old
      row)_
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

**Four tables and one enum**, one hand-written migration
(`20261007000002_fisc_011_emitter_profile_and_timbrado_ranges`). It was planned
as three; `gActEco` is a typed 1..n, so it needs a child table rather than a
JSON column, following `purchase_line` and `customer_contact`.

```text
fiscal_emitter_profile   one per tenant: RUC, DV, taxpayer type, regime, legal
                         and trade names, the optional responsible issuer, the
                         operation defaults
fiscal_emitter_activity  gActEco, one row per activity, ordered
fiscal_establishment     unique (tenant, code): the address the DE carries
fiscal_timbrado_range    unique (tenant, establishment, point, document type,
                         series): the range, the validity start, the counter,
                         series_started_at, status
```

### The columns, and where each one comes from

Every width and pattern is the official schema's, read from
`DE_v150.xsd`/`DE_Types_v150.xsd`/`Departamentos_v141.xsd` rather than from a
summary: `tRuc` 3..8 `[1-9][0-9]*[0-9A-D]?`, `tdNombre` 4..255, `tdDirec` ≤255,
`tdNumCas` 0..999999, `tdTel` 6..15, `tEmail`'s own pattern, `tdEst`/`tdPunExp`
`[0-9]{3}`, `tdNumTim` eight digits never all zero, `tdNumDoc` seven digits
never all zero, `tdSerieNum` `[A-Z]{2}`, `tdFeIniT` ≥ 2018-05-01, `dDenSuc`
1..30, `tdDesDisEmi`/`tdDesCiuEmi` 1..30, `tcActEco` `[0-9A-Z]{1,8}` and
`tdDesActEco` 1..300.

**Four decisions worth stating, because each could reasonably have gone the
other way:**

1. **Protocol codes are stored as the protocol's own smallints with a CHECK on
   the allowed set, not as named enums.** The code is what the DE carries and
   what SIFEN validates, so a name would be a translation layer with nothing on
   the other side. Internal states (`status`) keep named enums, as the
   repository already does.
2. **The descriptions are derived, not stored.** `tdDesTiDE` (7), `tdDesTImp`
   (5), `tdDesTiTran` (13) and `tdDesTipEmi` (2) are closed enumerations whose
   counts match the code sets exactly, and the Manual's worked example
   corroborates the order in **three of three** pairs it uses:
   `iTiDE 1 ↔ "Factura electrónica"`, `iTipTra 1 ↔ "Venta de mercadería"`,
   `iTImp 1 ↔ "IVA"`. Storing them would be a second source for a closed set.
3. **`dDesDepEmi` is not stored either.** `Departamentos_v141.xsd` enumerates
   the twenty names, so the pair is derived from `department_code` and cannot
   drift. The district and city names are **not** enumerable — 272 and 6,766
   entries in the official spreadsheet — so those two are stored.
4. **The counter is an integer, not the seven-character `dNumDoc`.** It has to
   express "one past the end" to be exhausted, and `9999999 + 1` is not seven
   digits. The seven-digit string is the emitted form, produced by zero-padding
   at the edge.

### Two partial unique indexes, because a plain one cannot say it

PostgreSQL treats NULLs as distinct, so `UNIQUE (…, series)` would admit many
seriesless ranges for the same establishment, point and document type — and the
Manual describes exactly one. Likewise nothing stops two `ACTIVE` ranges unless
it is said. So the migration creates:

```text
fiscal_timbrado_range_single_seriesless_key   WHERE series IS NULL
fiscal_timbrado_range_single_active_key       WHERE status = 'ACTIVE'
```

### The review found two more, and both were real

The first review of WU-C (`review-76fc979401c1bf07`, four lenses) closed
`correction_required` with three severe findings. All three were introduced by
this Story, and all three were corrected before the work unit was accepted.

**`R3-001` (BLOCKER) — the range's identity omitted the timbrado number.** The
migration's own comment says the Manual's sequence is timbrado + establishment +
expedition point + document type + series, and the unique index left the
timbrado out. A second authorisation for the same establishment, point, document
type and series therefore **collided with the first**, so a new timbrado could
not be registered at all — which is the Manual's other path for extending
numbering. The timbrado is now part of the identity, and the two partial indexes
are scoped per authorisation for the same reason.

That change has a consequence worth stating: **two authorisations may each be
`ACTIVE` at once**, because next year's timbrado has to be registrable while
this year's is still in use. So the allocation does not take "the ACTIVE range"
— it takes the ACTIVE range with the **greatest `validity_start`**, which is the
current authorisation. That rule is WU-D's to implement and is pinned here.

**`R3-002` / `R4-1` (CRITICAL, the same defect twice) — the validity-start
anchor was not anchored.** The CHECK was
`validity_start = date_trunc('day', validity_start)`, and `date_trunc` on a
`timestamptz` truncates in the **session's** `TimeZone`, not UTC. Measured
rather than argued: under `America/New_York`, a correctly anchored UTC-midnight
row **fails** that comparison, so the constraint would have rejected valid data
from any connection whose timezone is not UTC — and accepted a local-midnight
value. The comment claimed the anchor was "enforced rather than assumed", and it
was not.

The CHECK now takes the value through `AT TIME ZONE 'UTC'`, truncates the
zone-free result, and brings it back, so it depends only on the stored value.
Both directions are pinned: a UTC-midnight row is accepted **in a non-UTC
session**, and a row with a time part is refused.

### A defect the live-PostgreSQL case found, and nothing else could

The rollover case failed the first time it ran, with a CHECK violation:

```text
new row for relation "fiscal_timbrado_range" violates check constraint
  "fiscal_timbrado_range_active_has_numbers_left"
```

**The last number of every range was impossible to issue.** WU-C's CHECK
required an ACTIVE range to satisfy `next_number <= range_to`, and WU-D's claim
takes a number by **incrementing** the counter. On the last number those two
disagree: the counter goes to `range_to + 1` while the status is still ACTIVE,
because the rollover happens on the _next_ call, when the allocation finds the
range spent.

Neither unit's own suite could catch it. WU-D's uses a fake that does not apply
the schema's CHECKs, and WU-C's only ever inserted rows — it never claimed the
last number of one. **Two units that are each correct can still disagree**, and
the disagreement was only visible where both meet a real database.

The bound is now `range_to + 1`, and the constraint is renamed
`..._active_within_one_past_the_end` to say what it actually enforces: an ACTIVE
range may be **spent and awaiting its rollover**.

### A defect this Story found in its own design

The first draft enforced "the counter is never lowered" as a CHECK,
`next_number >= range_from`. **That does not enforce it**: lowering a counter
from 500 back to 1 passes, because `1 >= 1`. Monotonicity is a **transition**
invariant and a CHECK can only see the new row.

The live-PostgreSQL case caught it — the assertion expected a refusal and got
`UPDATE 1`. The invariant is now a `BEFORE UPDATE` trigger
(`fiscal_timbrado_range_next_number_monotonic`), and the CHECK stays as the
static half, renamed `..._next_number_within_range` to say what it actually
does.

It matters because a consumed number is burnt: the number is part of the CDC,
and lowering the counter would hand out a number that is already on a document.

`fiscal_timbrado_range.status` is `ACTIVE | EXHAUSTED | RETIRED`, and two
implications keep it honest — an `EXHAUSTED` range has run out and an `ACTIVE`
one has not. `RETIRED` is deliberately free of both, because an operator may
retire a range at any point in its life. A range is **never deleted**: a trigger
refuses it and says to retire instead.

## UI

- None. HTTP routes only.

## Implementation Summary

**WU-E, part 3b — the surface.** `apps/api/src/fiscal/timbrado/` gains the
tenant-scoped repository, the service and the routes behind
`fiscal.profile.manage`. The service's whole content is the **gate order** — the
`fiscal` entitlement first, then the permission — and **one transaction per
write** spanning the rows and the audit row, so an unaudited change is
structurally impossible. The audit carries field NAMES and counts, never values:
a profile holds a RUC and an address.

**There is deliberately no route that allocates a number.** The allocation is
`allocateDocumentNumber` over the Prisma store, and exposing it would let a
caller burn numbers without issuing anything.

A resource outside the tenant reaches the service as a scoped read that finds
nothing, so it answers `404` rather than confirming the row exists elsewhere —
and a range whose establishment is in another tenant is refused before the
insert, which is the service-level echo of the composite foreign key.

**WU-E, part 3a — the permission and the Prisma adapter.**
`fiscal.profile.manage` joins the permission seeds, held by OWNER and ADMIN
alongside the signing-material one, and `apps/api/src/fiscal/timbrado/` carries
the port's Prisma implementation.

The adapter is thin on purpose — every decision is in `packages/fiscal` and
everything here is one statement — and it is typed with **Prisma's own argument
types**. That is the resolution of the fitting problem WU-D found: a
hand-written delegate interface does not match Prisma's generic `updateMany`, so
the port is named operations, and here, where Prisma's types ARE available,
using them makes the delegate fit by construction rather than by hope.

Its suite asserts the SHAPE of the four statements, because that is the
adapter's whole content: the tenant is in every write's `where`, the claim
really compares the counter it was given, and the successor inherits the
authorisation instead of reissuing it.

**WU-E, part 2 — the profile assembly.**
`packages/fiscal/src/timbrado/emitter-profile.ts`: `assembleEmitterProfile`
turns the stored rows into the `EmitterFiscalProfile` the mapper takes, and it
is the only place that knows how a stored column becomes a DE field. It does not
allocate (the number arrives already allocated, because the number is part of
the CDC), does not store descriptions (every one is derived), and reads no clock
and no tenant.

Two consequences worth naming. **The department name is derived and the district
and city names are stored**, because the twenty departments are enumerated in
the schema and the 272 districts and 6,766 cities are not. And **the assembly is
cast-free**: `entryFor` returns the code narrowed to the protocol's own union
together with its description, so a stored integer never has to be asserted into
a union the schema defines.

**WU-E, part 1 — the description catalogues.**
`packages/fiscal/src/dte/dte.catalogues.ts`: the five enumerated sets the DE
carries descriptions for, keyed by code, with lookups that refuse an unknown or
non-integer code rather than guessing. It is part 1 because the read path needs
it: the profile stores codes, and the descriptions are derived here.

**WU-D — the allocation.** `packages/fiscal/src/timbrado/allocation.ts`:
`allocateDocumentNumber({ store, key })` takes the next `dNumDoc` for an
establishment, expedition point and document type, rolling the series over when
the current range is spent. It is written against a four-operation
`TimbradoRangeStore` that the caller implements over its own transaction client,
so the claim and any rollover commit together or not at all.

**The port was the raw Prisma delegate first, and it does not fit.** Prisma's
`findFirst` is assignable to a signature declared outside the package;
`updateMany` is not, because it is generic over a `SelectSubset` of an `XOR<>`
data type. A port promising the raw delegate would have been a promise this
package cannot keep, so the port is four **named operations** and the Prisma
adapter lives with the caller — the same split `FiscalSigningMaterialDelegate`
already uses. The cost is that the compare-and-swap's `where` clause lives in
the adapter, which is why `claimNumber` takes the observed counter it must
compare against instead of letting the adapter choose one.

**Which range is current.** Because the review made the timbrado part of a
range's identity, two authorisations may each be `ACTIVE`, so the allocation
does not take "the ACTIVE range": it takes the ACTIVE range with the greatest
`validityStart`, which is the authorisation in force.

**WU-C — the schema.** Four tables and one enum, hand-written SQL following the
repository's migration style. Every column's width and pattern is read from the
official XSDs; the four decisions and the self-found monotonicity defect are
recorded under Database. The migration was verified two ways: it applies to a
**fresh** database inside the transaction `prisma migrate deploy` wraps it in,
and `prisma migrate diff` reports **no drift** on the four new tables beyond the
repository-wide `updated_at` default that pre-exists on 37 other tables.

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
pnpm --filter @newsaas/fiscal test       green - 247 tests, 17 files
pnpm --filter @newsaas/api test          green - 1148 tests
   run with DTE_XSD_REQUIRED=1, so the official-schema gate ran instead of skipping
pnpm --filter @newsaas/fiscal build      green
pnpm lint / typecheck / test / build     green - 18/18, 18/18, 19/19, 11/11
pnpm format-check                        green, and it converges in two passes
pnpm --filter @newsaas/database test     green - 435 tests
live-PostgreSQL suite                    green - 215/215 against PostgreSQL 16
```

WU-C was corrected once, after its review closed `correction_required` with
three severe findings. The corrections were re-verified the same way, and the
two new assertions are pinned by test rather than by comment.

The live-PG case is the one that mattered: it exercises the two partial unique
indexes, both status implications, the monotonicity trigger, the deletion guard
and four scalar CHECKs against a real PostgreSQL 16, each expected failure in
its own rolled-back transaction — a rejected statement aborts the transaction,
so two assertions sharing one would report "current transaction is aborted"
instead of the constraint under test.

## Tests Added

`packages/fiscal/src/timbrado/series.test.ts`, 22 cases (WU-B):

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
- Each refusal's **failure code** is asserted, not only that it throws, so
  `INVALID_ORDINAL`, `INVALID_SERIES`, `SERIES_OUT_OF_ORDER` and
  `SERIES_EXHAUSTED` stay distinguishable for the caller.

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
- **Two authorisations may be `ACTIVE` at once, and the allocation chooses.**
  The Manual does not describe overlapping authorisations, so this is our model:
  a new timbrado has to be registrable while the current one is still in use,
  which means the allocation selects the ACTIVE range with the greatest
  `validity_start` rather than assuming there is exactly one. WU-D implements
  that rule.
- **The activity code table (`D131`) is still open** ([[FISC-008]]'s notes), so
  the profile stores the code the operator supplies without validating it
  against Tabla 3.

## Technical Debt

**The advisories below are recorded, not deferred silently.** Two of them were
fixed in the work unit that produced them, because each was a wrong contract;
the rest are the ones where a round per member stopped paying.

### WU-E part 3b — the surface

Three advisories from `review-b66e82eecd6150f5` (approved 2026-10-07):

- **`R3-range-order`** (reliability, `WARNING`) — **fixed**. The range body did
  not enforce `rangeFrom <= rangeTo`, so a reversed span reached the column and
  failed as a server fault. The schema's own stated purpose is to answer `400`.
- **`R3-validity-start`** (reliability, `WARNING`) — **fixed**, and the same
  class. The regex accepted `2026-13-45` and `2018-04-30`; both are dates the
  column refuses. It is a calendar round-trip now, not `Date.parse`, because
  that one **rolls over**: `"2026-02-30"` comes back as March 2 rather than
  failing.
- **`R3-upsert-race`** (reliability, `SUGGESTION`) — the profile upsert reads
  before it writes, so two concurrent upserts could both see "no profile" and
  both try to create. The unique constraint on `tenant_id` makes the second fail
  loudly rather than produce two rows, so it is a retry rather than corruption —
  recorded, not chased.

### WU-E part 3a — the permission and the Prisma adapter

Two advisories from `review-c608f94b2d2b7d0f` (approved 2026-10-07):

- **`R3-001`** (reliability, `WARNING`) — **fixed**. The adapter ordered the
  current range by `validityStart` alone. Two ACTIVE authorisations may share a
  validity start, so the choice was not deterministic — and the port's own
  contract names the timbrado number as the tie-break. The order is total on
  those two keys now.
- **`R3-002`** (reliability, `SUGGESTION`) — the `closeRange` case asserts the
  statement's shape and not its true/false result, while the `claimNumber` cases
  assert both. A missing assertion, not a missing behaviour.

And one from the fix's own review, `review-10afc4df96e34fbd` (approved
2026-10-07), which is precise:

- **`R3-TOTALITY`** (reliability, `SUGGESTION`) — the fix made the order total
  on `(validityStart, timbradoNumber)`, and that is **still not total**: the
  schema's identity includes the series, so two series of the same timbrado can
  share a validity start and tie on both keys. A final `id` would settle it. The
  remaining tie is between two rows of the SAME authorisation, which only arises
  if an operator registered two series at once.

### WU-E part 2 — the profile assembly

One advisory from the fix's own review (`review-0b7d72bb77b1ece2`, approved
2026-10-07), recorded rather than chased — this is where the family stops being
worth a round per member:

- **`R3-001`** (reliability, `WARNING`) — the assembly checks `!== null` for the
  string columns but not for **emptiness**, so a hand-built `districtName: ""`
  would be emitted and `tdDesDisEmi` forbids it (`minLength` 1). The same is
  true of `cityName` (1..30) and `addressLine` (1..255).

  **The database is the guard for all three**: its CHECKs are `length(...)`
  bounds, so no row can carry an empty value, and the only way to reach the
  assembly with one is to build the object by hand — which is the case the two
  refusals above already cover for nulls. Closing it means an emptiness check
  per string column, which is a family rather than a defect.

Two advisories from WU-E part 2's review (`review-bd912ca6487dcc13`, approved
2026-10-07), both non-blocking and both fixed in the same work unit, because
each was the module violating its own stated contract — refuse rather than
guess:

- **`R3-001`** (reliability, `WARNING`) — `buildResponsibleIssuer` refused a
  half-filled `gRespDE` in one direction and, in the other, returned `undefined`
  and **silently dropped** the four fields that were set. Both directions are
  checked now.
- **`R3-002`** (reliability, `WARNING`) — the district pair defaulted a missing
  name to an empty string, which `tdDesDisEmi` forbids (`minLength` 1): a
  default there would emit a document the XSD rejects, which is worse than
  failing where the bad input is. A half-set pair is refused, and neither-set
  omits both.

Two advisories from WU-E part 1's review (`review-54d1ceb0ce87813c`, approved
2026-10-07), both non-blocking and both fixed in the same work unit:

- **`R3-001`** (reliability, `WARNING`) — a test block was named "the three the
  Manual's worked example corroborates" and asserted **five** pairs. The name is
  now what the block does.
- **`R3-002`** (reliability, `SUGGESTION`) — the document-type catalogue's
  comment said the Manual corroborates its order, when the Manual's table had
  only been checked against its **first** pair. Following it up found the real
  answer, which is better and is now written down: the Manual states **five** of
  the seven pairs, and `9`/`10` are placed by elimination. The same
  investigation found the Manual's `2`, `3` and `8`, which `tiTiDE` does not
  admit at all.

Three advisories from WU-D's review (`review-839e5bd326e5b806`, approved
2026-10-07), all non-blocking. **All three were fixed in the same work unit**,
because each was a wrong contract rather than a cosmetic:

- **`R3-FORMAT-MAX`** (reliability, `WARNING`) — `formatDocumentNumber` checked
  the floor (`>= 1`) and not the ceiling, so it would happily return eight
  digits for a value `tdNumDoc` cannot carry. Both ends are checked now.
- **`R3-OPENSERIES-COUNTER`** (reliability, `SUGGESTION`) — the `openSeries`
  port did not say where the successor's counter starts, leaving the adapter to
  infer it. Where a series starts counting is a numbering rule, so `nextNumber`
  is passed.
- **`R3-ROLLOVER-ATTEMPTS`** (reliability, `WARNING`) — a rollover that closed a
  range is **progress**, but it spent the contention budget, so a chain of spent
  ranges would report `ALLOCATION_CONTENDED` with nobody competing. The two
  kinds of iteration now have separate budgets: contention is bounded by
  `ALLOCATION_MAX_ATTEMPTS`, and progress-making rollovers by the series space —
  the only bound that cannot be exceeded legitimately. The test that proves it
  runs **forty** rollovers and then a successful claim; a bound of 32 would have
  failed at the thirty-second.

One suggestion from the fix's own review (`review-87530a83749358a1`, approved
2026-10-07), recorded rather than chased — this is where generation starts
outrunning resolution:

- **`R3-ROLLOVER-ERROR`** (reliability, `WARNING`) — the loop's final throw says
  "made no progress in 32 attempts", but the loop can also leave through the
  rollover bound, where the real cause is a chain of ranges that claimed to be
  closed and were not. The failure code is right in both cases; only the message
  is. Closing it means distinguishing the two exits, which is a message change.

Two advisories from WU-B's review (`review-ab19166c91a10075`, approved
2026-10-07), both non-blocking. **Both were fixed in the same work unit** rather
than recorded, because each was a real defect in a file this Story is still
building on:

- **`R3-001`** (reliability, `WARNING`) — `assertSeriesSuccession` compared the
  candidate before validating it, so a malformed series (`ÑA`, `A`) produced
  `SERIES_OUT_OF_ORDER`, which points the caller at the wrong thing. The
  candidate is now validated first, and the failure codes are asserted by test.
- **`R3-002`** (reliability, `SUGGESTION`) — `seriesFromOrdinal` reported an
  out-of-range ordinal as `SERIES_EXHAUSTED`, so a programming error was
  indistinguishable from a timbrado that had genuinely run out. It now raises
  `INVALID_ORDINAL`, and `SERIES_EXHAUSTED` means only what it says.

One suggestion remains from the fix's own review (`review-375c0c24b4e6010a`,
approved 2026-10-07), and it is recorded rather than chased — this is the point
where generation starts outrunning resolution:

- **`R3-001`** (reliability, `SUGGESTION`) — `assertSeriesSuccession` validates
  `candidate` explicitly but reaches `current` only through `nextSeries`, so a
  malformed `current` still fails with `INVALID_SERIES` but with a message that
  does not say which of the two arguments was wrong. Closing it means validating
  both at the top.

The two from the first review were fixed because each was a wrong **failure
code** a caller branches on. This one is a message, and the failure code is
already right, so it is recorded.

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
