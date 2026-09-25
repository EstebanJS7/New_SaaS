---
id: DEC-010
type: decision
title:
  Optional catalog reference price with per-item ISO currency and global
  read-only tax rates (EPIC-09)
status: accepted
date: 2026-09-25
related_epics:
  - EPIC-09
related_decisions:
  - DEC-007
related_stories: []
prd_change_required: true
---

# DEC-010 — Optional catalog reference price with per-item ISO currency and global read-only tax rates (EPIC-09)

## Summary

The maintainer selected a design direction for the EPIC-09 catalog: an
**optional reference price per catalog item**, stored as an **amount plus an ISO
4217 currency carried per item and defaulting to PYG**, together with **globally
seeded `EXEMPT` / `IVA_5` / `IVA_10` rates that tenants can read but never
edit**.

The maintainer **accepted this record on 2026-09-25**, together with the narrow
PRD §15 clarification it required ("Approval and Governance", "PRD Update").
Acceptance records the product decision; it authorizes no implementation by
itself, because EPIC-09 remains `planned`. It still does not decide POS tax
treatment: no tax-included/excluded interpretation, tax calculation, currency
conversion or rounding is approved here.

## Context

PRD §15 ("Catalog and taxes") defines the item kinds `PRODUCT`, `SERVICE`,
`MEDICATION` and `SUPPLY`, states that tax rates are **data/configuration and
not hardcoded invoice logic**, and fixes the Paraguay seed `EXEMPT 0%`,
`IVA_5 5%`, `IVA_10 10%` with "authorized users select the applicable rate". It
says nothing about a catalog price or a catalog currency. (This described §15
before acceptance; the 2026-09-25 clarification that followed is recorded in
"PRD Update".)

Verified current state in this repository (2026-09-25):

- No catalog or tax implementation exists.
  `packages/database/prisma/schema.prisma` has no catalog item, price or
  tax-rate model; the only `catalog` hits are unrelated concepts
  (permission/role/plan/feature catalogs, and the global `Species`/`Breed`
  reference catalogs). The `Appointment` model comment states the gap
  deliberately: "There is deliberately no service/Catalog field and no
  clinical-encounter linkage yet."
- A precedent for **globally seeded, never tenant-scoped reference data**
  already exists: `Species` and `Breed` are global reference catalogs in the
  same schema, documented there as mirroring `FeatureCode`/`Role`, keyed by a
  stable `code`, and protected by `Restrict` foreign keys.
- Money precision already has a convention: `Decimal` columns with an explicit
  database precision (for example `ClinicalWeight.quantity`).
- PRD §1 fixes `currency: PYG`, `secondary currency support: USD`,
  `locale: es-PY` and `timezone: America/Asuncion`.

EPIC-09 is planned but not implemented: `docs/01-roadmap/ROADMAP.md` lists it as
`planned` depending on EPIC-02, and `docs/01-roadmap/EPIC-09-Catalog-Taxes.md`
records its planned scope. `odd/tasks/epic-09-catalog-taxes.md` (task P1) is the
origin of this record. The user selected three planning choices before this
record: global seeded rates, an optional item reference price with per-item
currency, and a staff-agenda service slice. This record covers only the first
two; the service slice belongs to its own scope decision.

## Question

How should a catalog item express a price, and who owns the tax rates, given
that no POS, sale or fiscal arithmetic exists yet and none of it is approved?

## Options

### Option A — Optional reference price with per-item currency, global read-only rates (selected direction)

Each catalog item MAY carry a reference price expressed as an **amount plus an
ISO 4217 currency code**, the two stored and validated as a **pair**, with PYG
as the default. The tax rate catalog is a **global, platform-seeded** set
(`EXEMPT`, `IVA_5`, `IVA_10`) that tenants read and cannot create, edit or
delete. The price is a reference value only: it is not a sale total, not a
fiscal total, and it carries no tax semantics of its own.

Benefits: it matches the PRD §15 principle that rates are configuration, it
reuses an existing and proven global-seed pattern, it keeps the item model
useful to staff before POS exists, and it leaves the tax-inclusion question open
without blocking any of it.

Costs: it introduces product surface that PRD §15 did not yet mention at the
time of this proposal (therefore acceptance required the PRD §15 clarification
made on 2026-09-25), and it creates a stored value whose eventual POS meaning is
still undecided.

### Option B — No price in the catalog at all (status quo)

Catalog items carry identity, kind and tax rate only; price is always entered at
sale time.

Benefits: zero new scope, nothing to migrate, no ambiguity about what a stored
price means.

Costs: staff must re-enter a known price on every operation, the catalog cannot
support price lists or reporting, and the PRD §15 service/catalog direction
stays incomplete for the everyday case.

### Option C — Tenant-editable tax rates or per-item tax overrides

Let tenants create rates or override a rate per item/tenant.

Benefits: maximum flexibility for edge cases outside the Paraguay seed.

Costs: rejected. PRD §15 fixes a three-rate Paraguay seed and `IVA` is a
statutory value rather than a tenant preference. DEC-003 keeps the analogous
RBAC baseline immutable and platform-owned, with tenant-local rows confined to a
single narrow override shape. The schema comments record the same principle for
platform baseline data ("Roles and the permission catalog stay platform
baseline") and mark the species and breed catalogs as never tenant-scoped. Tax
rates get no override shape at all here, and per-item overrides would silently
create exactly the hardcoded invoice arithmetic the PRD forbids.

### Option D — Store a tax-included/excluded flag on the item now

Add a boolean or enum that declares whether the stored price includes tax.

Benefits: it would appear to settle the POS question immediately.

Costs: rejected. It pre-commits the POS calculation model before POS exists, and
a flag without an agreed arithmetic (base, rate application, rounding,
per-currency scale for PYG) is a false decision: two readers would still
disagree about the resulting total. The question is recorded as open instead.

## Recommendation

Option A. It is the smallest change that makes the catalog useful, it reuses the
global-seed pattern the schema already ships, and it does not pretend that tax
arithmetic has been decided. Option C and Option D are rejected on correctness,
not on effort.

## Impact

### Product

Staff can record what an item normally costs without that number becoming a
sale, an invoice or a fiscal commitment. Tenants see one authoritative rate
list. Cross-tenant and cross-item consistency is preserved because no tenant can
mutate the rate set.

### Architecture

No new runtime, datastore, queue, dependency or API protocol. The rate catalog
follows the existing global-seed shape (stable natural `code`, global scope,
`Restrict` references); the price is a nullable value pair on the tenant-scoped
catalog item aggregate, so **tenant-isolation tests are required for the item
aggregate** under the engineering rules.

### Database/API

A nullable amount column with explicit database precision plus a nullable
currency column on the catalog item — no silent default at write time (see
Boundaries). Tenant principals get read access to the global rate set and no
create/update/delete route for it. Item writes validate the amount/currency pair
server-side and reject unknown currency codes.

### Delivery

EPIC-09's data/seed work unit owns the rate seed and the item columns; the
API/security unit owns pair validation, the read-only rate surface and isolation
coverage. POS, fiscal and any arithmetic consume nothing from this record until
their own work unit and decision exist.

## Decision

**Accepted 2026-09-25 by the maintainer.** Option A is the decision: a catalog
item MAY carry an optional reference price as an amount plus an ISO 4217
currency code, stored and validated as one pair with PYG as the offered default,
and the tax-rate catalog is the global, platform-seeded `EXEMPT` / `IVA_5` /
`IVA_10` set that tenants read and can never create, edit, deactivate or delete.
The boundaries below are part of the decision, not implementation detail.

Options B, C and D stay recorded above as the alternatives that were considered
and rejected; acceptance selects Option A only and revives none of them. This
record still does not decide POS tax inclusion or exclusion, tax calculation,
rounding or currency conversion, and it does not decide how a selected item rate
is represented or whether every item must carry one. At the time of acceptance
both questions were left to EPIC-09 as open decisions; the item-rate requirement
was subsequently decided there on 2026-09-25 (see "Subsequent scope note"
below), while the representation remains that epic's open implementation choice.

## Boundaries fixed by this decision

These boundaries are what makes the direction safe to implement; they are part
of the selected direction, not implementation detail.

1. **The reference price is not an authoritative total.** It is a convenience
   value attached to the catalog item. The authoritative amount of a sale,
   invoice, cash movement or fiscal document is the amount recorded by that
   operation at the time it is confirmed, and it is never re-derived from the
   current catalog value. Money and fiscal authority stay with the sale/fiscal
   work units.
2. **Amount and currency are validated as one pair.** Either both are present or
   neither is; an amount without a currency and a currency without an amount are
   both invalid. Unknown or unsupported ISO 4217 codes are rejected server-side.
   No reader may guess a missing currency.
3. **PYG is a default, never a silent coercion.** PYG is the default currency
   offered by the item contract and UI, and the product default per PRD §1. A
   write that supplies an amount must supply the currency it is measured in; the
   server does not invent one.
4. **Currency is per item, converted by nobody.** Each item states its own
   currency. This record defines no exchange rate, conversion or display
   conversion between PYG and the USD secondary currency; comparing amounts
   across items in different currencies is explicitly undefined here.
5. **Rates are global and tenant read-only.** The seed is `EXEMPT` / `IVA_5` /
   `IVA_10` per PRD §15. Tenants cannot create, edit, deactivate or add rates,
   and the item model exposes no per-item rate override or rate-copy field. A
   tenant needing a rate outside the seed is a new decision, not a configuration
   escape hatch.
6. **No arithmetic, no rounding, no tax semantics in this record.** It defines
   no percentage computation, no tax-included/excluded interpretation, no
   rounding rule, no decimal scale per currency and no tax split per item. Those
   belong to the POS/fiscal decision that is still open below.
7. **The item's selected rate is a selection, not a calculation.** PRD §15's
   "authorized users select the applicable rate" remains the rule; this record
   does not change who may select it or how it is authorized.

## Rollback

Acceptance shipped no code: EPIC-09 remains `planned` and nothing is
implemented, so there is nothing to revert today. If the direction is later
reversed, the record moves to `superseded` (or `rejected`) and the PRD §15
clarification is reverted or superseded at that time.

If the price is implemented and then rolled back before POS exists, the fields
are nullable and nothing financial reads them: rollback is dropping the amount
and currency columns, their DTO members, the corresponding validation and tests.
No historical financial record depends on them.

If POS later uses the price as a default and a rollback happens after confirmed
sales exist, the already-confirmed sale lines and fiscal documents keep their
stored totals — the immutability and reversal rules in the engineering baseline
mean a catalog change can never rewrite them. A rollback then stops new
pre-fills; it does not touch history.

## Open questions (unresolved, must not be closed here)

1. **Is POS pricing tax-included or tax-excluded?** Undecided. Both readings are
   compatible with this record, and the answer changes how a POS line total is
   computed from a rate. It needs its own decision, with the arithmetic,
   per-currency scale and rounding rule stated explicitly.
2. **Does the POS pre-fill a line price from the catalog, and may staff override
   it?** Undecided. This record only says the catalog value is a reference.
3. **Is the rate applied per sale line, per document, or per item?** Undecided;
   PRD §15 only fixes who selects a rate.
4. **Does the USD secondary currency ever require conversion or dual display?**
   Undecided; option A deliberately converts nothing.

## Approval and Governance

**Accepted 2026-09-25 by the maintainer**, who formally approved this record
together with the narrow PRD §15 clarification it required. The approval is
recorded here because the repository carries no separate sign-off artifact, and
an accepted decision whose approval lives only in a conversation is
indistinguishable from an unapproved one.

What the acceptance authorizes: Option A as bounded above — an optional per-item
reference price as an amount plus an ISO 4217 currency pair with PYG offered as
the default, and the global `EXEMPT` / `IVA_5` / `IVA_10` rate seed that tenants
read and never mutate. It authorizes nothing else: no POS tax-included/excluded
model, no tax calculation, no rounding rule, no currency conversion or display
conversion, and no per-item rate override. At the time of acceptance it also did
not decide how a selected item rate is represented or whether every item must
carry one; the item-rate requirement was subsequently decided in EPIC-09 on
2026-09-25 (see "Subsequent scope note" below), while the representation remains
an EPIC-09 open implementation choice.

The design direction was selected by the maintainer on 2026-09-25 during EPIC-09
scope preparation and recorded in `odd/tasks/epic-09-catalog-taxes.md` task P1.
No ADR is required: the direction adds no runtime service, datastore, queue,
dependency or API protocol.

## PRD Update

**Made 2026-09-25.** PRD §15 gained two sentences stating that a catalog item
may carry an optional reference price as an amount plus an ISO 4217 currency
code, offered as PYG by default and validated as a pair, and that the reference
price is informational rather than a sale, invoice, cash or fiscal value from
which no tax-inclusive/exclusive interpretation, tax calculation, conversion or
rounding is derived. No other PRD section was edited by this decision.

The clarification was required because PRD §15 did not mention a catalog price
or a catalog currency, so the optional reference price is additive product scope
rather than the fulfilment of existing intent. Editing approved PRD scope
followed the documentation rules: it required an explicitly accepted decision,
which this record now is.

## Subsequent scope note

**2026-09-25, later the same day, after this record's acceptance.** The
maintainer separately chose that every catalog item MUST select exactly one of
the globally seeded rates (`EXEMPT`, `IVA_5`, `IVA_10`) at creation, so a
rate-less item is not a valid state. That choice was made after this record was
accepted and is recorded in `docs/01-roadmap/EPIC-09-Catalog-Taxes.md`; it does
not amend this record's scope or approval, which still decide no item-rate
requirement. Whether a selected rate is represented as an enum, a foreign key or
a stable code reference remains an EPIC-09 open implementation choice, and a
non-null foreign key to the global rate row is a recommended pattern rather than
a product decision.
