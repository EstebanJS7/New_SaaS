---
id: CAT-001
type: story
title: Catalog item foundation
epic: EPIC-09
status: in-progress
priority: high
depends_on:
  - EPIC-02
prd_sections:
  - "7"
  - "15"
permissions: []
branch: main
created: 2026-09-25
updated: 2026-09-25
---

# CAT-001 — Catalog item foundation

## Objective

Persist the EPIC-09 catalog foundation: a tenant-scoped `CatalogItem` aggregate
covering the four PRD §15 kinds, and a global, platform-owned `TaxRate` catalog
— delivered as seeded reference data — that every item must reference, with the
physical guarantees (composite tenant key, `Restrict` foreign keys, price-pair
and non-negative `CHECK`s, delete rejection) that the API, UI and seed slices
depend on.

## Context

- EPIC-09 was `planned` with no catalog or tax persistence; this slice is WU1 of
  that epic and is the first implementation step. The epic record is now
  `in-progress` and points here.
- Precedent reused: `Species`/`Breed` are GLOBAL seeded reference catalogs with
  a stable natural `code` and `Restrict` references; `Patient`/`Customer` are
  tenant-scoped aggregates with a `(tenantId, id)` ownership key.
- [[DEC-010]] (accepted 2026-09-25) authorizes the optional per-item reference
  price as an amount plus ISO 4217 currency pair, informational only. The
  maintainer's later choice of 2026-09-25 — every item must select exactly one
  globally seeded rate — is recorded in EPIC-09 "Decided", which also settles
  the representation used here: a non-null foreign key to the global rate row
  with `Restrict` semantics.
- PRD §15 fixes the kinds (`PRODUCT`, `SERVICE`, `MEDICATION`, `SUPPLY`), the
  Paraguay rate seed (`EXEMPT 0%`, `IVA_5 5%`, `IVA_10 10%`) and the rule that
  rates are data/configuration rather than hardcoded logic. PRD §7 requires
  every private aggregate to be tenant-scoped.
- PRD §15 says physical items may track stock. That column is deliberately NOT
  added here: the maintainer deferred it to [[EPIC-10]] on 2026-09-25, so this
  slice introduces no stock dimension at all.

## In Scope

- Global `TaxRate` model: `code` (`@unique`), `name`, `rate` `Decimal(5,2)`,
  timestamps — mirroring `Species`/`Breed`, with NO `tenantId`.
- `CatalogItemKind` enum pinned to `PRODUCT | SERVICE | MEDICATION | SUPPLY`.
- Tenant-scoped `CatalogItem`: `tenantId`, `kind`, `name`, required non-null
  `taxRateId` (`Restrict` FK to `TaxRate`), nullable `referencePriceAmount`
  `Decimal(14,2)`, nullable `referencePriceCurrency` `VarChar(3)`, `isActive`
  default `true`, timestamps, `@@unique([tenantId, id])` and the lookup indexes.
- The `Tenant.catalogItems` relation.
- Migration `20260925000001_catalog` with the physical guarantees and no data.
- `schema-catalog.test.ts` textual gates over the schema and the DDL.
- The three global Paraguay rates as seeded reference data (`TAX_RATE_SEEDS`):
  `EXEMPT` `0.00`, `IVA_5` `5.00`, `IVA_10` `10.00`, upserted idempotently by
  their stable `code` after the species/breed block, exported from the package,
  and covered by the seed test, the CI count probe and the live-migration table
  scope checks.
- The tenant-scoped `CatalogItem` repository seam
  (`apps/api/src/catalog/catalog.repository.ts`) and its tenant-isolation unit
  tests: tenant identity resolved ONLY from the server-side request context, the
  shared not-found outcome for foreign/unknown ids, soft and idempotent
  deactivation, no delete operation, and no HTTP/DTO/permission/audit surface.
- The Story record and the EPIC-09 status/branch update for this slice.

## Out of Scope

- HTTP routes, DTOs, granular permission keys, transactional audit and
  cross-tenant `404` behavior (WU2). This slice seeds no permission and adds no
  route, so `permissions` above is intentionally empty.
- Staff UI and the web proxy (WU3).
- The `SERVICE`↔`Appointment` association and the agenda service filter (WU4).
- Live-PostgreSQL isolation evidence, module documentation and epic closure
  (EPIC-09 WU5).
- Any stock, POS, invoice, fiscal or tax arithmetic; any tax-included/excluded
  interpretation, rounding or currency conversion ([[DEC-010]] keeps those
  open).

## Acceptance Criteria

- [x] A global `TaxRate` catalog exists with `code` unique, `rate`
      `Decimal(5,2)`, timestamps, no `tenantId` column and a non-negative
      `CHECK`; the migration inserts no rate row.
- [x] `CatalogItem` is tenant-scoped with `@@unique([tenantId, id])`, a
      `Restrict` tenant FK and the `(tenantId, is_active)` / `taxRate_id`
      indexes.
- [x] Every item requires exactly one global rate: `tax_rate_id` is `NOT NULL`
      with a `Restrict` FK, so no stored item can be rate-less and a referenced
      rate cannot be deleted.
- [x] The optional reference price is an amount/currency pair: both columns
      nullable, `CHECK` both-or-neither, `CHECK` amount `>= 0`, `CHECK` currency
      matching `^[A-Z]{3}$`, `Decimal(14,2)` scale.
- [x] A catalog item cannot be hard-deleted: a `BEFORE DELETE` trigger raises
      `restrict_violation`, so deactivation is the only removal.
- [x] The migration is additive: it alters only `catalog_item`, creates no other
      table change and contains no `INSERT`.
- [x] The three global rates are seeded reference data, not migration rows:
      `TAX_RATE_SEEDS` holds `EXEMPT` `0.00`, `IVA_5` `5.00`, `IVA_10` `10.00`
      in fixed array order, upserts each by the stable `code` after the
      species/breed block, and is exported from the package alongside the
      existing seed catalogs.
- [x] Re-running the seed produces no diff: the rate upserts are identity-stable
      (`update: {}`), a second run appends the same three `taxRate.upsert` calls
      and the rate row count stays at three. The CI count probe reports
      `taxRates` so the two-seed comparison covers them.
- [x] No stock flag, SKU, barcode, category, unit or branch column exists in
      either artifact.
- [x] The new textual gates pass: `schema-catalog.test.ts`, 15 tests.
- [x] Existing convention gates stay green: `schema-clinical.test.ts` pinned the
      global count of `@@unique([tenantId, id])` at `7`, and the authorized
      one-line update (`7 → 8`, plus naming `CatalogItem` in the comment above
      it) restored it. The whole `@newsaas/database` suite is green: 13 files,
      203 tests.
- [x] The repository seam resolves the tenant ONLY from the server-side request
      context and never from a caller argument; a foreign-tenant or unknown id
      yields the same not-found outcome as a missing row, `list` never returns
      another tenant's rows, deactivation is soft and idempotent, and no delete
      operation exists. Unit evidence: `catalog.repository.test.ts`, 11 tests.
- [ ] The migration is applied to a live PostgreSQL database and the seeded
      rows, constraints and scopes are exercised there. Authored but unapplied:
      no PostgreSQL instance is reachable in this environment (`pnpm preflight`
      reports `127.0.0.1:5433` refused), so `pnpm db:seed`, the CI count probe
      and `pnpm db:live-verify` (which now requires `tax_rate` and
      `catalog_item`, and asserts the former has no `tenant_id` while the latter
      does) are authored but unexecuted.

## Domain Invariants

- An item has exactly one rate, selected from the global list; there is no
  nullable, unset or "no rate yet" item state and no per-item rate override or
  rate-copy column.
- Rate rows are global and tenant read-only; no tenant-scoped rate row and no
  tenant-scoped rate column exists.
- Amount and currency are stored and validated as one pair; PYG is the offered
  default, never a silent coercion by the database.
- Removal is deactivation; `DELETE` is rejected at the database boundary.
- The reference price is informational: nothing in this slice reads, sums,
  converts or rounds it.

## API

### Added

```text
None. This slice adds no route, DTO or permission.
```

### Changed

```text
None.
```

## Database

### Migration

```text
packages/database/prisma/migrations/20260925000001_catalog/migration.sql
```

Additive DDL only, no data insert: `catalog_item_kind` enum, `tax_rate` and
`catalog_item` tables, `tax_rate_code_key` and `catalog_item_tenant_id_id_key`
unique indexes, `Restrict` foreign keys to `tenant` and `tax_rate`, three lookup
indexes, and the `catalog_item_no_delete` `BEFORE DELETE` trigger.

### Models/Tables

| Table          | Scope  | Notes                                                              |
| -------------- | ------ | ------------------------------------------------------------------ |
| `tax_rate`     | Global | `code` unique, `rate` `DECIMAL(5,2)`, `rate >= 0`, no `tenant_id`. |
| `catalog_item` | Tenant | `@@unique([tenantId, id])`, required `tax_rate_id`, price pair.    |

## UI

None. No component, token or branding surface is touched by this slice.

## Implementation Summary

WU1 (data foundation: schema, migration, rate seed and the tenant-safe
repository seam) is implemented on branch `main`; WU2–WU5 of EPIC-09 are not
started.

- **Schema** (`packages/database/prisma/schema.prisma`): added the global
  `TaxRate` model (mirroring `Species`/`Breed`), the `CatalogItemKind` enum, the
  tenant-scoped `CatalogItem` aggregate and the `Tenant.catalogItems` relation.
- **Migration** (`.../20260925000001_catalog/migration.sql`): additive DDL with
  `Restrict` FKs, the composite tenant ownership key, the amount/currency pair
  `CHECK`, the non-negative and ISO 4217 `CHECK`s, and the delete-rejecting
  trigger. No data is inserted; the rate rows are seed-owned.
- **Seed** (`packages/database/src/reference-seed.ts`): added `TAX_RATE_SEEDS`
  and `TaxRateCode`, extended the `ReferenceSeedClient` delegate pick with
  `taxRate`, and upserted the three rates by natural `code` after the
  species/breed block. New seeds and the code type are re-exported from
  `packages/database/src/index.ts`.
- **Tests** (`packages/database/src/schema-catalog.test.ts`): 15 textual gates
  over the schema and the DDL, including non-vacuity guards on every block the
  negative assertions inspect. **Tests**
  (`packages/database/src/reference-seed.test.ts`): registered the `taxRate`
  delegate in the recording fake, added the `taxRates` count, and pinned the
  three codes/rates plus the idempotent rerun shape (3 new cases).
- **Evidence scripts** (`packages/database/scripts/ci-seed-counts.mjs`,
  `packages/database/scripts/live-migration-verify.ts`): the count probe now
  reports `taxRates`; the live verifier now requires `tax_rate` and
  `catalog_item` and checks the global vs tenant column scope.
- **Repository** (`apps/api/src/catalog/catalog.repository.ts`): the tenant-safe
  `CatalogRepository` persistence seam — `create` (required `taxRateId`),
  `findById`, `list({ kind, isActive })`, `update` and `deactivate` — resolving
  the tenant only through `requireTenantId()`, using `updateMany`/`count === 0`
  for the single byte-equivalent NOT_FOUND outcome, accepting an optional
  transaction client for later co-commit, and exposing no delete path. It adds
  no route, DTO, permission, module registration, audit write or UI, and uses
  the codebase's structural Prisma delegate contract so it compiles against the
  package's published types.
- **Docs**: this Story; EPIC-09 status moved to `in-progress` with the working
  branch recorded.

### Deviation: branch

The working branch is `main`, recorded verbatim in the frontmatter. No dedicated
`feat/epic-09-*` branch exists for this slice, unlike EPIC-05 and EPIC-06, which
used one per epic. Creating a branch is a git operation outside this slice's
authorization, so it was not performed; the human owns whether to retro-fit a
feature branch.

## Verification

```text
pnpm --filter @newsaas/database test ...... 13 files passed (13);
                                            203 tests passed (203)
pnpm --filter @newsaas/database typecheck  clean
pnpm --filter @newsaas/database lint ..... clean
pnpm exec prettier --check <slice files> . clean for reference-seed.ts,
                                            reference-seed.test.ts, index.ts,
                                            ci-seed-counts.mjs,
                                            live-migration-verify.ts,
                                            catalog.repository.ts,
                                            catalog.repository.test.ts and this
                                            Story (`.prisma` paths are excluded:
                                            the schema has no Prettier parser)
pnpm --filter @newsaas/api test .......... 68 files passed (68), 1 skipped
                                            (the live-PG suite); 804 tests
                                            passed (804), 40 skipped (40)
pnpm --filter @newsaas/api typecheck ..... clean
pnpm --filter @newsaas/api lint .......... clean
pnpm lint (root) ......................... exit 0 — 14 tasks successful
pnpm typecheck (root) .................... exit 0 — 14 tasks successful
pnpm test (root) ......................... exit 0 — 15 tasks successful
                                           preflight 2 files / 6 tests,
                                           database 13 / 203, worker 6 / 37,
                                           web 43 / 428, api 68 passed +
                                           1 skipped / 804 passed + 40 skipped
pnpm build (root) ........................ exit 0 — 9 tasks successful
pnpm format-check (root) ................. all matched files use Prettier
                                           code style
git diff --check ......................... clean (tracked and staged)
git status --short ....................... no unexpected tracked change;
                                           only the intended slice files
pnpm preflight ........................... PostgreSQL unreachable
                                           (127.0.0.1:5433), Redis unreachable
                                           (127.0.0.1:6380)
```

Root-gate note: these root commands were executed by the orchestrator session
itself. The delegated read-only verifier role failed twice without running a
single command, and the native agent fallback is not exposed in this session, so
the root evidence above is self-reported rather than independently produced. An
independent verification or a CI run on the eventual pull request remains the
stronger check.

Post-build note: after `pnpm build`,
`packages/database/dist/generated/index.d.ts` now contains the catalog
delegates, so the generated types are current again. The repository keeps its
structural delegate contract because that is what lets the isolation tests
inject a typed fake, not because the generated types are still stale.

Focused unit evidence for the W5 seam:
`pnpm exec vitest run --config vitest.config.ts src/catalog/catalog.repository.test.ts`
reports 1 file / 11 tests passed. The `@newsaas/api` suite grew by those 11
cases; the 40 skipped tests are the `test/live-pg-isolation.e2e-spec.ts` suite,
which needs the unreachable PostgreSQL instance and is reported as unexecuted,
not assumed.

The package `typecheck` and `lint` scripts cover `src/**` only, so the edited
`scripts/live-migration-verify.ts` was additionally checked in isolation with
the project's strict compiler options (a scoped
`tsc --noEmit --strict --module NodeNext` over that single file): clean. The
mutation probe below confirms the new seed assertions are revert-sensitive.

The suite grew from 200 to 203 tests: 15 catalog gates plus 3 new seed cases
(the three codes/rates, the natural-key upserts, and the rerun shape). The
earlier pre-existing global count assertion at
`packages/database/src/schema-clinical.test.ts:189` was already reconciled from
`7` to `8` in the schema slice and stayed green here.

A read-only mutant probe (the rate loop restricted to an empty slice) turned the
new seed cases red: the row-volume count, the natural-key upsert assertion and
the rerun assertion all failed. The original loop was then restored and the
suite re-ran green, so the assertions fail when the seed block is missing rather
than passing vacuously.

Unexecuted, and reported as unverified rather than assumed: `pnpm db:seed`, the
`scripts/ci-seed-counts.mjs` probe and `pnpm db:live-verify` all need a live
PostgreSQL instance, and `pnpm preflight` shows `127.0.0.1:5433` refused. The
seed logic is proven against the recording fake only, and the migration plus the
new `tax_rate`/`catalog_item` table checks remain unexercised against a real
database.

## Tests Added

- `packages/database/src/schema-catalog.test.ts` — 15 gates: enum pinning,
  global vs tenant scope, `Restrict` FKs, composite ownership key, price-pair
  and ISO 4217 `CHECK`s, delete-rejecting trigger, additivity,
  forbidden-dimension absence, and the schema-side model/relation mapping.
- `packages/database/src/reference-seed.test.ts` — 3 new seed cases: the three
  global rates and their `Decimal(5,2)` literals, the natural-code upserts with
  the `taxRates` count, and the identity-stable rerun with no duplicate rate.
- `apps/api/src/catalog/catalog.repository.test.ts` — 11 tenant-isolation cases:
  context-only tenant resolution (a smuggled `tenantId` is ignored on both
  create and update), the same id visible in its own tenant and `NOT_FOUND` in a
  foreign one, byte-equivalent foreign/unknown 404s on read and write, `list`
  filtering with no foreign rows and no implicit `isActive` predicate,
  cross-tenant write rejection that leaves the foreign row unchanged, soft
  idempotent deactivation, the optional transaction client seam, the absent
  delete path, and `FORBIDDEN` before any database call when no tenant context
  was resolved.

## Known Limitations

- The three rate rows are seed-owned and no PostgreSQL instance is reachable
  here, so no database in this environment holds them yet and `pnpm db:seed` /
  `pnpm db:live-verify` are unexecuted. Until the seed runs against a migrated
  database, a catalog item cannot be inserted; this is a real precondition of
  the non-null rate FK, recorded in EPIC-09 "Decided" rather than hidden.
- The migration is unapplied and unexercised against PostgreSQL here; the
  textual gates are faithful to the DDL but are not a substitute for a live run.
- The seed upserts rates with `update: {}` (the global-catalog convention), so a
  corrected rate value reaches an existing database only after that row is
  removed or the seed is taught to update it; this mirrors `Species`/`Breed`.
- Tenant-isolation behavior of the aggregate now has unit evidence
  (`catalog.repository.test.ts`, 11 tests) against the structural Prisma
  boundary fake. Durable live-PostgreSQL isolation/concurrency evidence is still
  unexecuted (`pnpm test:live-pg` needs the unreachable database).
- The `@newsaas/api` package resolves `@newsaas/database` from its built `dist`
  types. Those types predated the catalog models while only `src/generated` had
  been regenerated, so the repository uses the codebase's structural Prisma
  delegate contract (the customer/patient/clinical convention), which the real
  client satisfies at runtime. After the W6 root `pnpm build`,
  `dist/generated/index.d.ts` contains the catalog delegates again, so the
  contract is now a testability choice (it is what allows injecting a typed
  fake) rather than a workaround for stale types. WU2 owns registering the
  repository in a module, so no runtime path constructs it yet.
- Tax rates are protected only by the `Restrict` FK and the service layer that
  WU2 owns; there is no database-level delete rejection on `tax_rate` itself, so
  an unreferenced rate row is still deletable by direct SQL.

## Technical Debt

- None recorded. The single unchecked acceptance criterion (applying the
  migration to a live database) is unfinished work of this Story, and the
  remaining live-PostgreSQL isolation evidence is named under Known Limitations
  and belongs to the epic's live-evidence work unit; neither is deferred quality
  work.

## Decisions / ADRs

- [[DEC-010]] — optional catalog reference price with per-item ISO currency and
  global read-only rates (accepted 2026-09-25); this slice implements its
  nullable amount/currency pair and its global-rate boundary.
- The rate-per-item requirement and the non-null `tax_rate_id` representation
  are recorded in EPIC-09 "Decided" (2026-09-25); no ADR is required, since this
  slice adds no runtime service, datastore, queue, dependency or API protocol.

## Files / Modules

- `packages/database/prisma/schema.prisma`
- `packages/database/prisma/migrations/20260925000001_catalog/migration.sql`
- `packages/database/src/reference-seed.ts` — `TAX_RATE_SEEDS`, `TaxRateCode`,
  the `taxRate` delegate pick and the idempotent rate upsert block.
- `packages/database/src/index.ts` — re-exports `TAX_RATE_SEEDS` and
  `TaxRateCode` alongside the existing seed catalogs.
- `packages/database/src/reference-seed.test.ts` — `taxRate` recording delegate,
  the `taxRates` count and 3 new seed cases.
- `packages/database/scripts/ci-seed-counts.mjs` — `taxRates` in the probe.
- `packages/database/scripts/live-migration-verify.ts` — `tax_rate` and
  `catalog_item` required tables plus the global-vs-tenant column scope check.
- `packages/database/prisma/seed.ts` — unchanged: it delegates to
  `seedReferenceData`, so the new rates flow through it with no edit.
- `packages/database/src/schema-catalog.test.ts`
- `packages/database/src/schema-clinical.test.ts` — one-line update
  (`toHaveLength(7)` → `toHaveLength(8)`, plus naming `CatalogItem` in the
  comment) so the pre-existing global composite-key count assertion matches the
  new tenant-scoped aggregate; no other assertion or test name changed.
- `apps/api/src/catalog/catalog.repository.ts` — `CatalogRepository`, the
  tenant-safe persistence seam for `CatalogItem`: `create` (required
  `taxRateId`), `findById`, `list({ kind, isActive })`, `update` and
  `deactivate`, with the implicit `requireTenantId()` predicate, the single
  shared NOT_FOUND message, an optional transaction client and no delete path.
- `apps/api/src/catalog/catalog.repository.test.ts` — 11 tenant-isolation unit
  tests for that seam.
- `docs/02-stories/CAT-001-catalog-item-foundation.md`
- `docs/01-roadmap/EPIC-09-Catalog-Taxes.md`

## Completion Notes

_Status must remain non-done until all required gates pass._ The schema,
migration, rate-seed and repository slices are authored and their focused checks
are green; the live migration application (and with it the real seed run and CI
count probe) remains open, so this Story stays `in-progress` with that single
unverified gate recorded above.
