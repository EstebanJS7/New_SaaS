---
id: CAT-002
type: story
title: Catalog read API
epic: EPIC-09
status: in-progress
priority: high
depends_on:
  - EPIC-02
  - CAT-001
prd_sections:
  - "7"
  - "15"
permissions:
  - catalog.read
branch: main
created: 2026-09-25
updated: 2026-09-25
---

# CAT-002 — Catalog read API

## Objective

Expose the EPIC-09 catalog to authorized staff: one route that returns the
GLOBAL seeded tax-rate list, one that lists the caller tenant's catalog items
with optional `kind`/`isActive` filters, and one that reads a single item —
allowlisted INTERNAL DTOs, granular `catalog.read` enforcement, Zod-validated
query input and byte-equivalent cross-tenant `404`, with no write route, no
audit wiring and no tax or price arithmetic.

## What shipped

| Surface                  | Contract                                                                           |
| ------------------------ | ---------------------------------------------------------------------------------- |
| `GET /catalog/tax-rates` | The three GLOBAL seeded rates (`EXEMPT`, `IVA_5`, `IVA_10`), identical per tenant. |
| `GET /catalog`           | The caller tenant's items, optional `kind` and `isActive` filters.                 |
| `GET /catalog/:id`       | One item; a foreign or unknown UUID is the same byte-equivalent `404`.             |

All three require `catalog.read` at the route AND re-assert it in
`CatalogService`. Routes are unprefixed per DEC-002, and the static
`/catalog/tax-rates` path is registered before `/catalog/:id`.

## Context

- WU1 ([[CAT-001 Catalog item foundation]]) delivered the
  `TaxRate`/`CatalogItem` schema, the `20260925000001_catalog` migration, the
  rate seed and the tenant-safe `CatalogRepository` seam. Nothing could reach
  them over HTTP.
- WU2 A1 seeded the four `catalog.*` permission keys with the decided role
  matrix. This slice consumes `catalog.read`; the other three keys belong to
  `CAT-003`.
- Precedents reused: `PatientsCatalogService` for a GLOBAL reference read on a
  tenant-aware boundary; `AppointmentsController` for a Zod-validated `@Query`
  filter; `ClinicalWeight.quantity` for `Decimal` → string projection; and the
  `customers`/`patients` module shape for the read boundary.
- The API package resolves `@newsaas/database` from its built `dist` types, so
  `pnpm --filter @newsaas/database build` ran first in this slice to make the
  seeded `catalog.*` keys and catalog delegates visible to API consumers.

## In Scope

- `CatalogModule` wired into `AppModule` before the always-last `PortalModule`.
- `CatalogTaxRatesController` (`/catalog/tax-rates`) and `CatalogController`
  (`/catalog`, `/catalog/:id`), both pinned to `catalog.read`.
- `CatalogService` with the defense-in-depth permission re-assertion and the
  allowlisted DTO mapping; `CatalogRepository` reused for the tenant-scoped item
  reads.
- `catalog.dto.ts`, `catalog.zod.ts` (query + path validation) and
  `catalog.permissions.ts`.
- Route-contract probe entries and a `catalog.read` pin for all three routes.
- Shared in-memory boundary: `taxRate` and `catalogItem` delegates plus the
  three seeded GLOBAL rates.
- HTTP integration coverage: `403`, the exact allowlisted key set, cross-tenant
  `404`, both list filters and the rate list parity.

## Out of Scope

- The write surface — create, update and deactivate — is `CAT-003`; see that
  Story for its permissions, pair validation, mandatory seeded rate and
  transactional audit.
- Staff UI and the web proxy (WU3); the `SERVICE`↔`Appointment` association
  (WU4); live-PostgreSQL evidence and closure (WU5).
- Any stock, POS, invoice, fiscal or tax arithmetic; tenant-created rates or
  per-item overrides. This slice reads and projects only.

## Acceptance Criteria

- [x] Every catalog route declares `catalog.read` and the service re-asserts it;
      a missing permission is `403` and persists nothing.
- [x] Read DTOs are allowlisted and INTERNAL: no Prisma model is returned, no
      tenant-private identifier leaks, and the seeded rate arrives as a nested
      read-only projection.
- [x] Cross-tenant item UUIDs return a byte-equivalent `404 NOT_FOUND` identical
      to an unknown id.
- [x] The global rate list is the same three rows for every tenant and carries
      no mutation route.
- [x] Both list filters (`kind`, `isActive`) behave as declared; unknown query
      keys and malformed values are `400 VALIDATION_FAILED`.
- [x] `pnpm --filter @newsaas/api test`, `typecheck`, `lint`,
      `pnpm --filter @newsaas/database test`, package build and targeted
      Prettier/`git diff --check` are reported with exact commands and results.
- [x] Live-PostgreSQL verification of these reads passes in this environment
      (`pnpm --filter @newsaas/api test:live-pg` — 1 file / 47 tests): the item
      read-back, the GLOBAL rate list served to two tenants and the cross-tenant
      read `404` all run against real rows. The DURABLE CI and closure gate
      stays with WU5.

## Domain Invariants

- The rate list is GLOBAL: never tenant-filtered and never mutable through this
  surface.
- An item's rate is resolved from the global rows; it is never copied onto the
  item and never recomputed.
- The reference price is projected as an exact decimal STRING at the stored
  two-decimal scale; the nested rate literal is projected the same way. Nothing
  sums, rounds, trims or converts them, and the scale is the column's own, so a
  real `Prisma.Decimal` read (`"10"`) and the in-memory seeded text (`"10.00"`)
  produce ONE canonical spelling (`"10.00"`). See `CAT-003` "Decided" for the
  full rationale.
- No filter means no filter: an omitted `isActive` does not silently hide
  inactive items, so the `isActive=false` filter stays meaningful. A default
  visibility policy is a product decision this slice deliberately does not make.

## Decided

- **Rate projection by map, not by relation join.** The service loads the three
  GLOBAL rates once per request and maps them to items by `taxRateId`, instead
  of adding a Prisma `include` to the repository. Rationale: the shared
  in-memory boundary then needs no relation-join simulation, and the persistence
  seam stays a single tenant-scoped item read. The cost is one extra global
  query per request, which is acceptable for a three-row reference list.
- **A missing global rate fails loudly.** The column is `NOT NULL` with a
  `RESTRICT` foreign key, so an unresolvable rate is a deploy fault, not an item
  state; the lookup throws `INTERNAL` rather than inventing a rate or exposing a
  nullable projection the UI must handle.
- **`tenantId` stays in the item DTO.** It is the CALLER's own tenant, matching
  the Customer/Patient DTOs, and the foreign tenant id is asserted absent.
- **Nested rate projection omits the rate id.** The item already carries
  `taxRateId`, so the nested `{ code, name, rate }` repeats no identifier; the
  rate list route carries the id for selection.
- **Decimal projections are fixed-scale two-decimal strings.** Settled for the
  whole catalog boundary on 2026-09-25 while closing the WU2 correctness
  findings; the full rationale, the rejected alternatives and the single
  implementation point are recorded in `CAT-003` ("Decided"), which owns the
  write path. This read slice consumes the same rule, so `GET /catalog/:id`,
  `GET /catalog` and `GET /catalog/tax-rates` report the stored two-decimal text
  exactly, whatever padding the persistence path happens to produce.

## API

### Added

```text
GET /catalog/tax-rates   catalog.read   the GLOBAL seeded rate list
GET /catalog             catalog.read   tenant items (kind, isActive filters)
GET /catalog/:id         catalog.read   one item (foreign id ⇒ 404)
```

### Changed

```text
None.
```

## Database

No schema, migration or seed change. The slice reads `tax_rate` and
`catalog_item` through the WU1 repository; `packages/database/dist` was rebuilt
so the seeded `catalog.*` keys and catalog model types are current for API
consumers.

## Tests Added

- `apps/api/src/catalog/catalog.integration.test.ts` — 6 HTTP cases over the
  real guard chain: the `403` sweep with no persistence, the exact allowlisted
  key set with foreign-tenant non-leakage, the single-item read plus the
  byte-equivalent cross-tenant `404`, the malformed-id `400`, both list filters
  with rejected unknown/invalid query input, and the rate-list parity between
  two tenants.
- `apps/api/src/rbac/route-contract.probe.test.ts` — the three routes added to
  the exact inventory plus a `CATALOG_PERMISSION_BY_ROUTE` pin asserting
  `catalog.read` on each and failing on any undeclared catalog route.

## Verification

```text
pnpm --filter @newsaas/database build ...... Prisma Client 6.19.3 generated;
                                            tsc clean
pnpm --filter @newsaas/api test ........... 69 files passed, 1 skipped (the
                                            live-PG suite); 838 tests passed,
                                            47 skipped
pnpm --filter @newsaas/api typecheck ...... clean
pnpm --filter @newsaas/api lint ........... clean
pnpm --filter @newsaas/database test ...... 13 files passed; 204 tests passed
pnpm exec prettier --check <touched files, no .prisma path>
                                           All matched files use Prettier code
                                           style
git diff --check .......................... clean
DATABASE_URL_TEST=... DATABASE_URL=... pnpm --filter @newsaas/api test:live-pg
                                           1 file passed; 47 tests passed (46
                                           before this slice's race case was
                                           added), including the item read-back,
                                           the two-tenant rate list and the
                                           cross-tenant read 404
```

Focused pre-run:
`pnpm exec vitest run --config vitest.config.ts src/catalog/catalog.integration.test.ts src/rbac/route-contract.probe.test.ts`
reported 2 files / 21 tests passed. The package suite grew from 68 files / 804
tests to 69 files / 811 tests (6 new integration cases + 1 new route pin); the
unit totals moved on afterwards with other in-flight slices.

## Known Limitations

- These reads are proven at the HTTP level against the shared in-memory boundary
  and against real PostgreSQL rows by the live suite (item read-back, the rate
  list for two tenants and the cross-tenant read `404`). The DURABLE CI/closure
  run remains with WU5.
- The rate list is ordered by `code` (`EXEMPT`, `IVA_10`, `IVA_5`), which is
  deterministic but not presentation-ordered. There is no `position` column; a
  display order is a future product decision, not a silent catalog rule.
- The in-memory `catalogItem` delegate implements the full repository contract
  (including `create`/`updateMany`); this slice exercised only its read paths,
  and `CAT-003` then covered the write paths.
- The `~400` authored-line review heuristic is exceeded because the shared
  test-double extension is included here; the coverage it buys was left intact
  rather than trimmed to fit.

## Next Step

WU2 A3 landed as `CAT-003` (the write surface: create, update, soft-deactivate,
pair validation, the mandatory seeded rate, transactional audit and the same
byte-equivalent cross-tenant `404`). What remains for this epic is the staff UI
and web proxy (`WU3`), the appointment service linkage (`WU4`) and the
live-PostgreSQL closure evidence (`WU5`).

## Files / Modules

- `apps/api/src/catalog/catalog.permissions.ts` — the `catalog.*` key contract.
- `apps/api/src/catalog/catalog.dto.ts` — allowlisted read projections.
- `apps/api/src/catalog/catalog.zod.ts` — kind pin, id param and list query.
- `apps/api/src/catalog/catalog.service.ts` — permission re-assertion, global
  rate load and DTO mapping.
- `apps/api/src/catalog/catalog.controller.ts` — `/catalog` and `/catalog/:id`.
- `apps/api/src/catalog/catalog-tax-rates.controller.ts` — `/catalog/tax-rates`.
- `apps/api/src/catalog/catalog.module.ts` — module wiring and controller order.
- `apps/api/src/catalog/catalog.integration.test.ts` — HTTP read coverage.
- `apps/api/src/app.module.ts` — `CatalogModule` (before `PortalModule`).
- `apps/api/src/rbac/route-contract.probe.test.ts` — route inventory and pin.
- `apps/api/test/support/in-memory-database.ts` — `taxRate`/`catalogItem`
  delegates and the three seeded rates.
