---
id: EPIC-09
type: epic
title: Catalog and Taxes
status: planned
priority: high
depends_on:
  - EPIC-02
prd_sections:
  - "9"
  - "14"
  - "15"
  - "27"
  - "28"
  - "29"
created: 2026-09-25
updated: 2026-09-25
---

# EPIC-09 — Catalog and Taxes

## Objective

Give staff a tenant-scoped catalog of `PRODUCT`, `SERVICE`, `MEDICATION` and
`SUPPLY` items, and give every tenant one authoritative, globally seeded and
read-only Paraguay tax-rate list (`EXEMPT`, `IVA_5`, `IVA_10`) from PRD §15 —
without implementing any stock ledger, POS, invoice, fiscal document or tax
arithmetic. The catalog is a prerequisite for [[EPIC-10]] Inventory, [[EPIC-11]]
Suppliers/Purchases and [[EPIC-12]] POS/Payments; this epic delivers the catalog
itself and stops at the boundary those epics own.

A separately reviewed slice associates a `SERVICE` item with appointments so
that PRD §14's agenda service filter becomes real, preserving the
caller-supplied duration that [[DEC-007]] fixed and adding no portal service
selection.

## Current state (verified 2026-09-25)

- No catalog or tax implementation exists.
  `packages/database/prisma/schema.prisma` has no catalog-item, price or
  tax-rate model; the only `catalog` matches are unrelated concepts
  (permission/role/plan/feature catalogs and the global `Species`/`Breed`
  reference catalogs).
- `Appointment` records the gap deliberately: "There is deliberately no
  service/Catalog field and no clinical-encounter linkage yet"
  (`packages/database/prisma/schema.prisma`, `model Appointment`).
- Precedent for global, never-tenant-scoped seeded reference data already
  exists: `Species` and `Breed`, keyed by a stable `code` and protected by
  `Restrict` foreign keys.
- Money precision already has a convention: `Decimal` columns with explicit
  database precision (for example `ClinicalWeight.quantity @db.Decimal(10, 3)`).
- PRD §15 fixes the item kinds and the three-rate seed, states that rates are
  data/configuration rather than hardcoded invoice logic, and says authorized
  users select the applicable rate. Its 2026-09-25 clarification records the
  optional per-item reference price and currency as informational rather than a
  sale or fiscal value ([[DEC-010]]).

Everything below is planned and unchecked. No acceptance criterion in this
record has been implemented.

## Scope

- A tenant-scoped catalog item aggregate covering the four PRD §15 kinds, with
  deactivation (not hard delete) as the only removal, and no branch dimension.
- A required tax-rate selection on every item: each item carries exactly one of
  the three globally seeded rates at creation, and no rate-less item state is
  valid.
- A global, platform-seeded tax-rate list (`EXEMPT 0%`, `IVA_5 5%`,
  `IVA_10 10%`) that tenants read but can never create, edit, deactivate or
  delete, following the existing global-seed shape.
- An allowlisted HTTP surface with granular permissions, typed DTOs,
  transactional audit and cross-tenant `404` behavior, plus an authenticated
  staff web proxy. Catalog configuration that is not confidential is classified
  INTERNAL, consistent with
  `docs/03-architecture/DATA-CLASSIFICATION-RETENTION.md`.
- A staff catalog UI on the shared design system with loading, empty, error,
  success and permission-denied states.
- An optional reference price stored as an amount plus a per-item ISO 4217
  currency defaulting to PYG, validated as one pair and never treated as a sale
  or fiscal total, as authorized by accepted [[DEC-010]] (2026-09-25).
- **In epic scope, delivered as a separately reviewed slice (WU4):** a `SERVICE`
  item association on `Appointment` and the PRD §14 agenda service filter,
  preserving the existing caller-supplied duration and adding no portal service
  selection. The user selected this integration as part of EPIC-09. The
  association field may be nullable for backward compatibility; the integration
  itself is required epic scope and acceptance.

## Out of Scope

- **Stock ledger, stock movements or balances** — owned by [[EPIC-10]].
- **POS, sales, payments, cash, invoices and fiscal documents or providers** —
  owned by [[EPIC-12]] onward. This epic performs no tax arithmetic, no
  percentage computation, no rounding and no tax-included/excluded
  interpretation.
- **Tenant-configurable tax rates, per-item rate overrides, or rate copy
  fields.** The rate list is global and tenant read-only ([[DEC-010]] Option C,
  rejected).
- **Item categories, taxonomies, SKUs or any other identifier scheme beyond the
  item's own identity.** No such field is added by this epic; a future need is a
  new decision, not a silent column.
- **Hard delete of catalog items.** Deactivation only.
- **Branch-specific or branch-scoped pricing.**
- **A stock-tracking flag on the item.** PRD §15 says physical items may track
  stock, but the maintainer deferred that column to [[EPIC-10]] on 2026-09-25 so
  this epic adds no stock dimension at all. [[EPIC-10]] owns whether the flag
  exists, which kinds default to tracking, and how it is consumed.
- **Portal service selection.** Portal holders gain no catalog or service
  surface in this epic ([[EPIC-08]] explicitly deferred it).
- **Recurring appointments, reminders and clinical-encounter linkage**
  ([[EPIC-07]], [[EPIC-17]] non-goals, unchanged).

## Acceptance Criteria

- [ ] Catalog items persist tenant-scoped, may be `PRODUCT`, `SERVICE`,
      `MEDICATION` or `SUPPLY`, and are removed only by deactivation; no hard
      delete route exists.
- [ ] Exactly three tax rates exist as platform-seeded global rows keyed by the
      stable codes `EXEMPT`, `IVA_5`, `IVA_10` with `0%`, `5%`, `10%`; no
      tenant-scoped rate row, no rate mutation route and no per-item override
      field exists.
- [ ] A tenant principal can read the global rate list and cannot create, update
      or delete a rate; any attempt is rejected server-side and persists
      nothing.
- [ ] Every catalog item carries exactly one seeded rate (`EXEMPT`, `IVA_5`,
      `IVA_10`) selected at creation, per PRD §15 and the maintainer choice of
      2026-09-25; creation without a selected rate or an update attempting to
      clear the existing rate is rejected and persists nothing. An update that
      omits the rate leaves the selected rate unchanged; no stored item exists
      in a rate-less state. Arbitrary tenant-created rates and numeric rate
      overrides are forbidden and rejected server-side.
- [ ] Every catalog route enforces a granular permission and the service
      re-asserts it as defense in depth; a missing permission is `403` and
      persists nothing.
- [ ] Cross-tenant catalog-item UUIDs, and any cross-tenant anchor supplied in a
      write, return a byte-equivalent `404 NOT_FOUND` and persist nothing,
      including under a concurrent request race.
- [ ] DTOs are allowlisted and classified INTERNAL for non-confidential catalog
      configuration per `docs/03-architecture/DATA-CLASSIFICATION-RETENTION.md`;
      Prisma models are never returned and no catalog response or log carries
      sensitive payloads.
- [ ] Every catalog mutation appends exactly one co-committed audit row with
      stable IDs, and no catalog event is emitted.
- [ ] The staff catalog surface renders loading, empty, error, success and
      permission-denied states with semantic design tokens only, and enforces no
      client-side authority.
- [ ] An item may carry an optional reference price as an amount plus ISO 4217
      currency pair, PYG is the offered default, a missing or unknown currency
      alongside an amount is `400 VALIDATION_FAILED`, and no reader derives a
      sale total, invoice total or fiscal value from it — authorized by accepted
      [[DEC-010]] and the PRD §15 clarification of 2026-09-25.
- [ ] **WU4 (in scope):** a `SERVICE` catalog item can be associated with an
      appointment, and the agenda can filter appointments by that service, while
      appointment duration remains the explicit caller-supplied parameter and no
      portal surface exposes service selection. The association field may be
      nullable for backward compatibility.
- [ ] No stock movement, stock balance, cash movement, invoice or fiscal record
      is created, mutated or read by any catalog operation.
- [ ] The durable live-PostgreSQL isolation/concurrency evidence for the catalog
      aggregate passes, and the epic's required lint, typecheck, test and build
      gates are green at closure.

## Work Units

Ordered for review; each unit is independently verifiable and must not begin
before the previous unit's evidence exists.

- **WU1 — Foundation and seed.** Catalog-item schema and migration (tenant
  scope, four kinds, deactivation, composite tenant FKs, database CHECKs), the
  global tax-rate model and its three-row seed, and the repository seam. Owns
  the rate seed, the required non-null `tax_rate_id` reference settled under
  "Decided", and the optional nullable amount/currency columns of accepted
  [[DEC-010]]. Includes tenant-isolation unit coverage for the aggregate, and
  adds no stock flag.
- **WU2 — API and security.** Allowlisted HTTP surface and DTOs, granular
  permissions and route-contract pins, the read-only rate surface, required rate
  selection on every item write, defense-in-depth service checks, transactional
  audit and cross-tenant `404` behavior. Owns amount/currency pair validation
  and rejection of any rate-less item write.
- **WU3 — Staff UI.** Catalog list/detail and create/edit/deactivate flows on
  the shared shell, required rate selection from the read-only list with no
  rate-less item state, the web proxy with strict route/query allowlists, and
  all required UI states using semantic tokens.
- **WU4 — Service association and agenda filter (in scope).** `Appointment`
  service association and the PRD §14 agenda service filter, preserving the
  caller-supplied `durationMinutes` contract from [[DEC-007]] and adding no
  portal service selection. The field may be nullable for backward
  compatibility. Delivered as its own reviewed slice.
- **WU5 — Live-PG evidence, CI and documentation.** Durable live-PostgreSQL
  isolation/concurrency run, full lint/typecheck/test/build gates, module
  documentation, roadmap status update and closure evidence.

## Dependencies

- [[EPIC-02 RBAC Entitlements Tenant Settings]] is the roadmap dependency: it
  supplies permissions, the tenant-settings registry, audit and typed request
  context this epic consumes.
- [[EPIC-03 Staff Shell Design System Branding]] is an existing implementation
  reliance, not a roadmap dependency entry: the staff catalog UI reuses the
  shared resolved brand, shell and semantic design tokens. The roadmap
  dependency row for EPIC-09 is unchanged by this record.
- [[EPIC-04 Customers]] and [[EPIC-05 Veterinary Patients]] remain the anchor
  precedents for tenant-scoped aggregates and are not modified.
- Downstream consumers — [[EPIC-10]] Inventory, [[EPIC-11]], [[EPIC-12]]
  POS/Payments — depend on this epic and are not implemented here.

## Open Decisions

No epic-level product decision remains open. [[DEC-010]]'s POS tax-inclusion,
price pre-fill, rate-application and currency-conversion questions stay with
that record and are consumed by [[EPIC-12]] onward, not here.

## Decided

- **A rate is required per item.** Chosen by the maintainer on 2026-09-25, after
  the [[DEC-010]] acceptance of the same day: every catalog item MUST select
  exactly one of the globally seeded rates (`EXEMPT`, `IVA_5`, `IVA_10`) at
  creation. There is no nullable, unset or "no rate yet" item state; an item may
  not be created or updated without a rate, and no stored item may hold an unset
  rate.
- **The rate is represented as a non-null foreign key to the global rate row.**
  Settled as an implementation choice while preparing WU1 on 2026-09-25: the
  item stores `tax_rate_id` referencing the global seeded row with `Restrict`
  semantics, mirroring `Species` and `Breed`. PRD §15 states rates are
  data/configuration rather than hardcoded logic, and an enum or a
  `CHECK`-constrained code column would hardcode the rate set into the item type
  in a second place. The consequence is a real precondition: the three rate rows
  must exist before any item can be inserted, so the seed runs before items are
  created and a migrate-only database cannot create items.
- **The reference price uses one fixed scale for every currency.**
  `Decimal(14, 2)`, settled as an implementation choice on 2026-09-25, because
  [[DEC-010]] deliberately leaves per-currency scale undecided and the catalog
  must not invent per-currency arithmetic. PYG amounts are representable at that
  scale; if POS later requires per-currency exponent handling, that belongs to
  its own decision and migration rather than to an implicit catalog rule.

## Exit Criteria

- [ ] The implementation work units are merged with named evidence.
- [ ] The durable live-PostgreSQL isolation/concurrency evidence for the catalog
      aggregate passed.
- [ ] Lint, typecheck, the required test suites and build are green at the epic
      level.
- [ ] Documentation is current: this epic, the catalog module documentation, and
      the roadmap status.
- [ ] All open decisions above are either decided with a record or explicitly
      carried forward as debt.

`status: done` will mean epic implementation closure only, never a
production-readiness statement. [[EPIC-20]] Production Hardening would remain.

## Stories

No Story file yet. This record is a planning artifact; the work units above are
the intended slicing.

## Decisions / ADRs

- [[DEC-010]] — optional catalog reference price with per-item ISO currency and
  global read-only tax rates. **Accepted 2026-09-25 by the maintainer**, with
  the PRD §15 clarification made the same day, so the reference-price slice is
  authorized scope of this epic. Its own POS tax-inclusion, pre-fill,
  rate-application and currency-conversion questions remain open there and are
  not settled by this epic. The later maintainer choice of 2026-09-25 that every
  item must carry a seeded rate is recorded under "Decided" above and in
  [[DEC-010]]'s subsequent-scope note; it postdates and does not amend that
  record.
- [[DEC-007]] — agenda v2. It explicitly deferred Catalog to this epic and fixed
  duration as an explicit parameter, which WU4 must preserve.
- [[DEC-003]] — the analogous immutable platform baseline with a narrow tenant
  override shape; it is the precedent for keeping the rate list global and
  tenant read-only.
- No ADR is anticipated: this epic adds no runtime service, datastore, queue,
  ORM, auth strategy, API protocol or design-system change and stays inside the
  frozen MVP architecture. If implementation reveals otherwise, an ADR proposal
  is required before the change.

## Technical Debt

- None recorded yet: the epic is planned and no implementation exists.
