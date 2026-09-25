---
id: EPIC-09
type: epic
title: Catalog and Taxes
status: review
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

## Current state before implementation (verified 2026-09-25)

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

Everything below is planned and unchecked: at the time of this observation no
acceptance criterion in this record had been implemented.

**Since that observation (2026-09-25):** the epic is implemented across five
work units (WU1–WU5) and recorded in [[CAT-001 Catalog item foundation]] through
[[CAT-005 Appointment service link]]. The two migrations
`20260925000001_catalog` and `20260925000002_appointment_service` were applied
to a local PostgreSQL 16 database, the seed and the live-PostgreSQL suite ran
there (47/47), and the module documentation [[Catalog-Taxes]] exists. The work
is **not committed, pushed or merged**, so the epic is `review`, not `done`. The
bullets above describe the state observed before that work began, not the
current tree.

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
  association field is nullable for backward compatibility; the integration
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

Every criterion below is mapped to the concrete evidence that exists in the
tree. Checked means observed; the residual qualifiers are stated rather than
hidden. "Local" evidence is a run on this machine against a disposable local
PostgreSQL, not a CI run — see `docs/10-qa/CI-EVIDENCE.md`.

- [x] Catalog items persist tenant-scoped, may be `PRODUCT`, `SERVICE`,
      `MEDICATION` or `SUPPLY`, and are removed only by deactivation; no hard
      delete route exists. Evidence:
      `packages/database/prisma/migrations/20260925000001_catalog/migration.sql`,
      `packages/database/src/schema-catalog.test.ts` (kinds, tenant key,
      `RESTRICT` FKs, `BEFORE DELETE` trigger),
      `apps/api/src/rbac/route-contract.probe.test.ts` (the six-route inventory
      contains no `DELETE`), and the live-PG case "proves the delete-rejecting
      trigger and the reference-price pair CHECK at the database level".
- [x] Exactly three tax rates exist as platform-seeded global rows keyed by the
      stable codes `EXEMPT`, `IVA_5`, `IVA_10` with `0%`, `5%`, `10%`; no
      tenant-scoped rate row, no rate mutation route and no per-item override
      field exists. Evidence: `packages/database/src/reference-seed.ts`
      (`TAX_RATE_SEEDS`), `packages/database/src/reference-seed.test.ts`, the
      migration DDL (`tax_rate` has no `tenant_id`), and the live-PG case
      "serves the three globally seeded rates to both tenants and rejects an
      item with an unknown rate id" (three seeded rows, `tax_rate.tenant_id`
      absent).
- [x] A tenant principal can read the global rate list and cannot create, update
      or delete a rate; any attempt is rejected server-side and persists
      nothing. Evidence: `GET /catalog/tax-rates` in
      `apps/api/src/catalog/catalog.integration.test.ts` (the list plus the
      two-tenant parity case) and the route inventory in
      `route-contract.probe.test.ts` — no rate mutation route exists at all, so
      a write attempt is not a route and cannot persist.
- [x] Every catalog item carries exactly one seeded rate (`EXEMPT`, `IVA_5`,
      `IVA_10`) selected at creation; creation without a selected rate or an
      update attempting to clear the existing rate is rejected and persists
      nothing. An update that omits the rate leaves the selected rate unchanged;
      no stored item exists in a rate-less state. Arbitrary tenant-created rates
      and numeric rate overrides are forbidden and rejected server-side.
      Evidence: `apps/api/src/catalog/catalog.zod.ts` (`taxRateId` required on
      create, non-nullable on update), `CatalogService.assertTaxRateExists`
      (unknown id ⇒ `400`), the create and update rejection sweeps in
      `catalog.integration.test.ts`, and the live-PG probe where a
      service-bypassing raw insert with an unknown rate id is rejected by the
      `RESTRICT` foreign key.
- [x] Every catalog route enforces a granular permission and the service
      re-asserts it as defense in depth; a missing permission is `403` and
      persists nothing. Evidence:
      `apps/api/src/rbac/route-contract.probe.test.ts`
      (`CATALOG_PERMISSION_BY_ROUTE`), `CATALOG_PERMISSIONS`, the
      `403`-persists-nothing sweep in `catalog.integration.test.ts`, and the
      service-level `requirePermission` re-assertion in
      `apps/api/src/catalog/catalog.service.ts`.
- [x] Cross-tenant catalog-item UUIDs, and any cross-tenant anchor supplied in a
      write, return a byte-equivalent `404 NOT_FOUND` and persist nothing,
      including under a concurrent request race. Evidence:
      `catalog.integration.test.ts` (`expectCrossTenant404`), the repository's
      compound `{ id, tenantId }` predicate and single shared message constant
      in `apps/api/src/catalog/catalog.repository.ts`, the live-PG case "masks
      tenant A's item as a byte-equivalent 404 to an unknown UUID on read,
      update and deactivate", and the live concurrent-deactivation case that
      exercises the same conditional write under contention. The race qualifier
      rests on the tenant predicate riding inside the single conditional
      statement (there is no read-then-write window), not on a dedicated
      cross-tenant race case: this aggregate has no version/cardinality
      invariant to race, which the live suite states explicitly.
- [x] DTOs are allowlisted and classified INTERNAL for non-confidential catalog
      configuration per `docs/03-architecture/DATA-CLASSIFICATION-RETENTION.md`;
      Prisma models are never returned and no catalog response or log carries
      sensitive payloads. Evidence: `apps/api/src/catalog/catalog.dto.ts` (the
      only exported projections), the exact-key assertions in
      `catalog.integration.test.ts`, and the live-PG create case asserting the
      exact DTO key set, the `reference_price_amount` / `is_active` column-name
      absence, and audit metadata carrying no name, amount or currency value.
- [x] Every catalog mutation appends exactly one co-committed audit row with
      stable IDs, and no catalog event is emitted. Evidence:
      `catalog.integration.test.ts` (one row per accepted mutation),
      `AuditWriter` inside `this.prisma.$transaction` in
      `apps/api/src/catalog/catalog.service.ts`, and the live-PG cases asserting
      `catalog_item.created` / `.updated` / `.deactivated` with exactly one row
      each, no durable event table, and the `audit_log` table-lock barrier
      proving item and trail become visible together.
- [x] The staff catalog surface renders loading, empty, error, success and
      permission-denied states with semantic design tokens only, and enforces no
      client-side authority. Evidence:
      `apps/web/src/app/(app)/app/catalog/catalog-list.test.tsx`,
      `catalog-form.test.tsx`, `[id]/catalog-item-detail.test.tsx`,
      `catalog-api.test.ts` and
      `apps/web/src/components/shell/nav-sidebar.test.tsx`. This is
      component-level evidence against a mocked `fetch`; Playwright/E2E remains
      deferred ([[TD-007]]), and the client deliberately does not hide the edit
      route from a read-only role.
- [x] An item may carry an optional reference price as an amount plus ISO 4217
      currency pair, PYG is the offered default, a missing or unknown currency
      alongside an amount is `400 VALIDATION_FAILED`, and no reader derives a
      sale total, invoice total or fiscal value from it — authorized by accepted
      [[DEC-010]] and the PRD §15 clarification of 2026-09-25. Evidence: the
      shared `superRefine` and the `PYG`/`USD` pin in `catalog.zod.ts`, the
      create (17-case) and update (14-case) rejection sweeps and the
      `null`-clears/absent-untouched matrix in `catalog.integration.test.ts`,
      and the live-PG pair `CHECK` probe
      (`catalog_item_reference_price_pair_check`).
- [x] **WU4 (in scope):** a `SERVICE` catalog item can be associated with an
      appointment, and the agenda can filter appointments by that service, while
      appointment duration remains the explicit caller-supplied parameter and no
      portal surface exposes service selection. The association field is
      nullable. Evidence: `apps/api/src/scheduling/appointment.dto.test.ts`,
      `appointment.service.test.ts`, `appointments.integration.test.ts`
      (unknown/foreign ⇒ 404, inactive/wrong kind ⇒ 400, duration preserved, no
      monetary key in the response),
      `apps/api/src/scheduling/booking-requests.integration.test.ts` (the portal
      body stays strict), `packages/database/src/scheduling.test.ts` (additive
      migration and nullable composite FK),
      `apps/web/src/app/(app)/app/agenda/{agenda-api,agenda-calendar}.test.ts`
      and `agenda.test.tsx` (selector, filter, name rendering, degraded read),
      `apps/web/src/app/api/scheduling/[[...path]]/route.test.ts` (the widened
      `serviceId` allowlist), and [[Scheduling]]. No live-PostgreSQL case
      exercises this link; its live behavior is covered only by the applied
      migration.
- [x] No stock movement, stock balance, cash movement, invoice or fiscal record
      is created, mutated or read by any catalog operation. Evidence: the
      catalog module touches only `tax_rate`, `catalog_item` and `audit_log`
      (see `apps/api/src/catalog/**`), the route inventory contains no
      stock/cash/invoice/fiscal route, and the live-PG create case asserts the
      mutation's complete durable side effect is the item row plus one audit row
      and that no event/outbox/queue/job table exists in the public schema.
- [x] The durable live-PostgreSQL isolation/concurrency evidence for the catalog
      aggregate passes, and the epic's required lint, typecheck, test and build
      gates are green at closure. Evidence: the live-PG suite reported **47/47
      passed** on 2026-09-25 against a local PostgreSQL 16 database, and the
      per-unit root gates are green — see `docs/10-qa/CI-EVIDENCE.md` for the
      exact commands and results.

## Work Units

Ordered for review; each unit is independently verifiable and must not begin
before the previous unit's evidence exists.

- **WU1 — Foundation and seed.** Catalog-item schema, migration, the global
  tax-rate seed and the repository seam, with tenant-isolation coverage.
  Outcome: delivered — [[CAT-001 Catalog item foundation]];
  `20260925000001_catalog`, `TAX_RATE_SEEDS`, `schema-catalog.test.ts` (15
  gates).
- **WU2 — API and security.** Allowlisted HTTP surface and DTOs, the read-only
  rate surface, the required rate selection, defense-in-depth service checks,
  transactional audit and cross-tenant `404` behavior. Outcome: delivered —
  [[CAT-002 Catalog read API]] and [[CAT-003 Catalog write API]].
- **WU3 — Staff UI.** Catalog list/detail and create/edit/deactivate flows, the
  required rate selection, the web proxy and the full UI state set. Outcome:
  delivered — [[CAT-004 Staff catalog surface]].
- **WU4 — Service association and agenda filter.** `Appointment` service
  association and the PRD §14 agenda service filter, preserving caller-supplied
  `durationMinutes` and adding no portal selection. Outcome: delivered —
  [[CAT-005 Appointment service link]]; `20260925000002_appointment_service`.

- **WU5 — Live-PG evidence, CI and documentation.** Durable live-PostgreSQL
  isolation/concurrency run, full lint/typecheck/test/build gates, module
  documentation, roadmap status update and closure evidence. **Outcome:**
  delivered locally on 2026-09-25 — `pnpm preflight` reachable, `db:deploy`
  applied both catalog migrations, the seed idempotency probe returned identical
  counts with `taxRates: 3`, `db:live-verify` passed, the live-PG suite reported
  47/47, and [[Catalog-Taxes]] plus this record were written. The CI half of
  this unit is open until the work is pushed.

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
  rate. Implemented by the non-null column plus the
  create-required/update-cannot -clear contract; proven live by the `RESTRICT`
  FK rejection of a service-bypassed insert.
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
- **The permission matrix is fixed.** Decided by the maintainer on 2026-09-25:
  `OWNER`, `ADMIN` and `INVENTORY_MANAGER` hold all four `catalog.*` keys, and
  `VETERINARIAN`, `RECEPTIONIST` and `CASHIER` hold `catalog.read` only. The
  catalog is the inventory domain, so the inventory role manages it; the
  front-desk, veterinary and cash roles read it. Seeded in
  `packages/database/src/reference-seed.ts` and asserted by the
  permission-matrix test; `isActive` is not an update field so `catalog.update`
  can never perform a deactivation.
- **The accepted currency list is exactly `PYG` and `USD`, derived from PRD
  §1.** PRD §1 fixes `currency: PYG` with `secondary currency support: USD`, the
  migration comment states the database enforces ISO 4217 _shape_ while "the
  accepted code list is validated by the API", and [[DEC-010]] boundary 2
  requires unknown or unsupported codes to be rejected server-side. A
  well-formed but unsupported code (`ZZZ`) is therefore a `400` exactly like a
  malformed one (`pyg`); widening the set is a product decision.
- **The staff list defaults to ACTIVE items.** The API deliberately applies no
  implicit active filter (an omitted `isActive` returns active and inactive
  alike, so `isActive=false` stays meaningful). The active-by-default view is a
  presentation rule in `CatalogList`, which asks for `isActive=true` and exposes
  a visible "Include deactivated items" toggle — an unfiltered list would mix
  retired items into daily work. The API contract is unchanged.
- **The human rate display order is `EXEMPT`, `IVA_5`, `IVA_10`, applied in the
  web layer only.** `GET /catalog/tax-rates` orders by `code`, which is
  lexicographic (`EXEMPT`, `IVA_10`, `IVA_5`). `sortTaxRatesForDisplay`
  re-orders the fetched list where the selector renders; the API response, the
  seed and the stored rows keep their own order and no `position` column is
  implied. An unexpected code sorts after the known ones instead of being
  dropped.
- **The canonical decimal representation is a fixed two-decimal string.**
  Settled 2026-09-25 while closing the WU2 correctness findings: both catalog
  decimal columns store two decimals and the write contract caps a submitted
  amount at two decimals, so the API projects every decimal through one helper
  (`decimalToFixedScaleString`) at exactly two decimals — padding, never
  rounding. A real Prisma `Decimal` read trims trailing zeros (`"10"`) while the
  in-memory boundary returns the seeded literal (`"10.00"`); pinning the scale
  gives clients one canonical spelling in both environments. The live suite
  compares the DTO to the raw `::text` column value exactly.

## Exit Criteria

- [ ] The implementation work units are merged with named evidence. **OPEN** —
      the five work units and their tests exist only in the working tree;
      nothing is committed, pushed or merged, so no merged evidence and no CI
      run exists for this epic.
- [x] The durable live-PostgreSQL isolation/concurrency evidence for the catalog
      aggregate passed. Evidence: the local run of 2026-09-25 —
      `pnpm --filter @newsaas/api test:live-pg` reported 1 file / **47 tests
      passed** against a disposable PostgreSQL 16.13 database, including
      "EPIC-09 catalog application-path isolation" and its
      concurrent-deactivation attribution race. Because the branch is unpushed,
      this run is recorded as LOCAL evidence in `docs/10-qa/CI-EVIDENCE.md`; its
      promotion to the immutable CI baseline is part of the delivery step above.
- [x] Lint, typecheck, the required test suites and build are green at the epic
      level. Evidence: `pnpm lint` 14/14, `pnpm typecheck` 14/14, `pnpm test`
      15/15, `pnpm build` 9/9 and `pnpm format-check` clean — local,
      session-reported runs, not CI.

- [x] Documentation is current: this epic, the catalog module documentation, and
      the roadmap status. Evidence: [[Catalog-Taxes]], this record, the
      `docs/05-modules/README.md` index entry and the roadmap row.
- [x] All open decisions above are either decided with a record or explicitly
      carried forward as debt. Evidence: "Decided" above and the [[TD-013]],
      [[TD-014]], [[TD-015]] records.

Every gate this environment can run is green and the live-PostgreSQL evidence
exists locally, but the work is not committed, pushed or merged, so the exit
criterion that requires merged work units is still open. That is why `status` is
`review` and not `done`.

`status: done` will mean epic implementation closure only, never a
production-readiness statement. [[EPIC-20]] Production Hardening would remain.

## Stories

The epic was delivered as five Story records, all on the working branch `main`
(no dedicated `feat/epic-09-*` branch exists). Their frontmatter still reads
`in-progress` because each keeps one live-database criterion unchecked at the
time it was written; the epic-level evidence above is the current truth for the
local state.

- [[CAT-001 Catalog item foundation]] — WU1: the `TaxRate`/`CatalogItem` schema,
  the `20260925000001_catalog` migration, `TAX_RATE_SEEDS`, the tenant-safe
  `CatalogRepository` seam and the textual gates (`schema-catalog.test.ts`, 15
  cases; `reference-seed.test.ts`; `catalog.repository.test.ts`, 11 cases).
- [[CAT-002 Catalog read API]] — WU2 A2: `catalog.read`-gated `GET /catalog`,
  `GET /catalog/:id` and `GET /catalog/tax-rates`, the allowlisted INTERNAL DTOs
  with a nested read-only rate projection, Zod query validation, the
  route-contract pins and the HTTP read coverage.
- [[CAT-003 Catalog write API]] — WU2 A3: the `catalog.create` /
  `catalog.update` / `catalog.deactivate` commands, the mandatory seeded rate,
  the amount/currency pair semantics, the transactional `catalog_item.*` audit
  rows and the byte-equivalent cross-tenant `404` over read and write.
- [[CAT-004 Staff catalog surface]] — WU3: the `/api/catalog` proxy with its
  `(method, path-shape)` allowlist, the staff-cookie-only forwarding, the
  `catalog-api.ts` client and the `/app/catalog` list/detail/create/edit/
  deactivate pages with their required states.
- [[CAT-005 Appointment service link]] — WU4: the nullable
  `Appointment.serviceId` with its composite tenant FK, the anchor guard
  (`404`/`400`), the identity-only service projection, the agenda `serviceId`
  filter and the staff selector, preserving the caller-supplied duration and
  adding no portal service selection.

The lifecycle-frontmatter mismatch is deliberate and left as written: those
Story files are outside this documentation pass's edit surface.

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
  duration as an explicit parameter, which WU4 preserved.
- [[DEC-003]] — the analogous immutable platform baseline with a narrow tenant
  override shape; it is the precedent for keeping the rate list global and
  tenant read-only.
- No ADR is anticipated: this epic adds no runtime service, datastore, queue,
  ORM, auth strategy, API protocol or design-system change and stays inside the
  frozen MVP architecture. If implementation reveals otherwise, an ADR proposal
  is required before the change.

## Technical Debt

- [[TD-013 Staff-proxy rejection inconsistency]] — the catalog proxy answers
  `405` where the older scheduling proxy answers `404` for a disallowed method,
  and refuses a cookie-less request locally instead of forwarding it.
- [[TD-014 Catalog writes have no optimistic concurrency]] — no version column;
  concurrent updates are last-write-wins, unlike `Appointment` and the clinical
  encounter.
- [[TD-015 Database scripts outside the quality scope]] —
  `packages/database/scripts/*` is executed by CI but sits outside that
  package's lint and typecheck coverage.
- [[TD-007 Playwright E2E deferred]] — the staff catalog surface is covered by
  Vitest + testing-library against a mocked `fetch`; no browser-to-API round
  trip is proven.
