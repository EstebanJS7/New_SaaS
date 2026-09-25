# EPIC-09 WU1 — Catalog foundation and tax-rate seed

## Objective

Deliver EPIC-09 work unit WU1: the tenant-scoped catalog item aggregate, the
global seeded tax-rate list, and the repository seam — with migrations, seed
idempotency and tenant-isolation evidence — without adding any API route, staff
UI, stock dimension, POS behavior or tax arithmetic.

## Problem and why

EPIC-09 is `planned` and no catalog or tax persistence exists. Inventory
(EPIC-10), Purchases (EPIC-11) and POS (EPIC-12) cannot start until a persisted,
tenant-scoped item with a required tax-rate reference exists. Scope was settled
in `odd/tasks/epic-09-catalog-taxes.md`; this document tracks the foundation
slice only.

## Scope and constraints

- In scope: `schema.prisma` models and enum, one migration, the global tax-rate
  seed with idempotency evidence, the tenant-scoped repository seam, and the
  Story/Epic status records for the slice.
- Ratified product rules carried in: exactly one globally seeded rate (`EXEMPT`,
  `IVA_5`, `IVA_10`) required per item at creation; rates global and tenant
  read-only; optional reference price as amount plus per-item ISO currency (PYG
  offered by default, both-or-neither); no stock flag; no hard delete.
- Settled implementation choices
  ([EPIC-09](file:///home/esteb/code/NewSaaS/docs/01-roadmap/EPIC-09-Catalog-Taxes.md)
  "Decided"): non-null `tax_rate_id` foreign key to the global rate row; price
  scale fixed at `Decimal(14, 2)` for every currency.
- Out of scope: HTTP routes, DTOs, permissions and audit wiring (WU2); staff UI
  and web proxy (WU3); appointment service association and agenda filter (WU4);
  live-PG and closure gates (WU5); stock, POS, invoice, fiscal and tax
  arithmetic.
- No category, SKU, barcode, image or branch dimension. No `tracksStock` column:
  the maintainer deferred it to EPIC-10.
- Preserve unrelated uncommitted work; do not push; commit only when the
  maintainer asks.
- TDD mode: **disabled**, source `openspec/config.yaml` `strict_tdd: false`;
  runner `pnpm test` (focused: `pnpm --filter @newsaas/database test`,
  `pnpm --filter @newsaas/api test`). This is not a no-check pass:
  schema/migration textual tests, seed idempotency probe, tenant-isolation unit
  tests, lint, typecheck and build apply.

## Tasks

- [x] W1: Create Story `CAT-001` and move EPIC-09 to `in-progress` with the
      working branch recorded; keep the roadmap table row consistent.
- [x] W2: Add the catalog item model, the global tax-rate model, the kind enum
      and the tenant relation to `schema.prisma`, plus the migration, with the
      physical guarantees: composite tenant uniqueness, `Restrict` foreign keys,
      price/currency pair `CHECK`, non-negative guards and a delete-rejecting
      trigger.
- [x] W3: Add `schema-catalog.test.ts` textual gates mirroring the existing
      schema tests and keep the convention tests green. The required composite
      tenant key pushed the pre-existing count assertion in
      `packages/database/src/schema-clinical.test.ts` from `7` to `8`; the
      maintainer authorized that one file, the literal and its model-list
      comment were updated, and the package suite is green again.
- [x] W4: Seed the three global rates idempotently through `reference-seed.ts`,
      exported from the package, with the seed test, CI seed-count probe and
      live-migration verification updated.
- [x] W5: Add the tenant-scoped catalog repository seam and its tenant-isolation
      unit tests.
- [x] W6: Run the focused and root checks; report every executed command with
      its observed result and any command that could not run.

## Acceptance criteria and checks

- Catalog items persist tenant-scoped with `@@unique([tenantId, id])` and cannot
  be hard-deleted; the tenant foreign key is `Restrict`.
- Exactly three global rate rows exist, keyed by the stable codes `EXEMPT`,
  `IVA_5`, `IVA_10`, with no `tenant_id`; no item can exist without a resolvable
  `tax_rate_id`.
- Price amount and currency are both present or both absent, enforced in the
  database as well as in the future write path.
- Re-running the seed twice produces identical counts.
- Cross-tenant access through the repository seams is impossible by
  construction, with unit evidence.
- `pnpm --filter @newsaas/database test`, `pnpm typecheck`, `pnpm lint` and
  `pnpm format-check` reported with exact commands and results.
- Any database-dependent step that cannot execute in this environment is
  reported as unverified, not assumed.

## Progress

- Exploration: read-only map of the schema, migrations, seed and evidence
  conventions completed; candidate surfaces and sub-slices identified.
- W1: Story `CAT-001` created, EPIC-09 flipped to `in-progress`, and the roadmap
  table row aligned by the parent.
- W2: `TaxRate`, `CatalogItemKind`, `CatalogItem` and the tenant relation added,
  with the migration authored at `20260925000001_catalog`. The Prisma client was
  regenerated; package typecheck and lint are clean.
- W3: `schema-catalog.test.ts` written with 15 gates. The convention gate in
  `schema-clinical.test.ts` needed the authorized one-line count update; after
  it, the package suite is 13 files / 200 tests green. A read-only mutant probe
  confirmed the new gates are revert-sensitive and that the negative assertions
  cannot pass against an empty block.
- W4: `TAX_RATE_SEEDS` added in fixed order (`EXEMPT` `0.00`, `IVA_5` `5.00`,
  `IVA_10` `10.00`) and upserted by natural `code` with `update: {}` after the
  species/breed block; the package exports, the recording-fake seed test, the CI
  count probe and the live-migration table checks were updated. The package
  suite is now 13 files / 203 tests green, and a scoped mutation (emptying the
  seed loop) turned the three new seed cases red, so they are revert-sensitive.
- W5: `apps/api/src/catalog/catalog.repository.ts` and its unit test added. The
  repository resolves the tenant only from `RequestContextService`, keeps the
  predicate implicit on every path, funnels unknown and foreign ids into one
  shared not-found outcome, allows only an allowlisted update payload, offers
  create/read/list/update/soft-deactivate and exposes no delete path. It adds no
  route, DTO, permission, module registration, audit write or UI. The API suite
  is green at 68 files / 804 tests with the live-PG file skipped.
- Verification: green for the executed checks, with the same honest gap. `api`
  suite (68/804), focused repository test (11/11), `api` `typecheck` and `lint`,
  `database` suite (13/203), root `pnpm format-check` and `git diff --check` all
  passed. `scripts/*` sit outside the database package's lint/typecheck scope,
  so that edited verifier script was checked with a scoped `tsc --noEmit`.
  `pnpm preflight` still shows PostgreSQL and Redis unreachable, so the
  migration, the seed and the live-PG isolation suite remain unexecuted.
- W6: Root gates run and green — `pnpm lint` (14 tasks), `pnpm typecheck` (14),
  `pnpm test` (15 tasks: database 13/203, worker 6/37, web 43/428, api 68 passed
  - 1 skipped, preflight 2/6), `pnpm build` (9 tasks), `pnpm format-check`, and
    both `git diff --check` variants. After the build
    `packages/database/dist/generated/index.d.ts` contains the catalog delegates
    again, and the package `typecheck` still passes.
- Verification: complete for every check this environment can run. Still
  unexecuted because PostgreSQL `127.0.0.1:5433` and Redis `6380` are
  unreachable: migration application, `pnpm db:seed`, the CI count probe,
  `pnpm db:live-verify` and `pnpm test:live-pg`. No live constraint or row has
  been exercised, so CAT-001 keeps its live-migration criterion unchecked and
  stays `in-progress`.
- Tooling note: the delegated read-only verifier role failed twice without
  running a single command, and no native agent fallback is exposed in this
  session, so the root gates were executed by the orchestrator itself and that
  evidence is self-reported rather than independently produced.
- Next: none for WU1 beyond the live-database evidence. WU1 code is still
  uncommitted; EPIC-09 WU2 owns the HTTP surface, permissions and audit.

## Verification evidence

- `pnpm --filter @newsaas/database db:generate`: success, Prisma Client 6.19.3
  generated.
- `pnpm --filter @newsaas/database typecheck`: clean.
- `pnpm --filter @newsaas/database test`: 13 files / 203 tests passed, after the
  authorized count update in `schema-clinical.test.ts` and the new seed cases.
  The parent reproduced the 199/200, 200/200 and 203/203 states.
- `pnpm --filter @newsaas/api test`: 68 files passed, 1 skipped; 804 tests
  passed, 40 skipped. The skipped file is the live-PG isolation suite, which
  needs an unreachable database.
- `pnpm --filter @newsaas/api typecheck` and `lint`: clean.
- Focused `vitest run src/catalog/catalog.repository.test.ts`: 11/11 passed.
- `pnpm --filter @newsaas/database lint`: clean.
- `pnpm exec prettier --check` on the `.prisma` path fails with "No parser could
  be inferred"; verified pre-existing on the untouched base, and root
  `pnpm format-check` passes.
- `pnpm preflight`: PostgreSQL `127.0.0.1:5433` and Redis `6380` refused, so no
  migration was applied anywhere.
  `prisma migrate diff --from-empty --to-schema-datamodel` was used read-only to
  confirm the hand-written DDL matches the schema.
- `git diff --check`: clean.

## Rationale for settled choices

- Non-null foreign key over an enum: PRD §15 treats rates as data rather than
  hardcoded logic, and the repository already ships that shape for `Species` and
  `Breed`; the cost is a strict seed-before-insert precondition, which is
  documented rather than hidden.
- Fixed price scale: [[DEC-010]] deliberately leaves per-currency scale open, so
  the catalog must not imply per-currency arithmetic; a later POS requirement
  needs its own decision and migration.
- Seed idempotency uses `upsert` by stable natural key with `update: {}`,
  matching the existing global-catalog convention; a corrected rate literal
  would not overwrite an existing row and would need an explicit decision.
- The catalog repository depends on a structural Prisma delegate contract rather
  than the generated `PrismaClient` type, because the database package's local
  build output predates the catalog models until `pnpm build` regenerates it.
  The real client satisfies the contract at runtime, and the contract is also
  what makes the isolation tests able to inject a typed fake without touching
  the shared in-memory harness. WU2 owns module registration, so nothing
  constructs the repository at runtime yet; W6's full build should confirm the
  generated types now include the catalog delegates.
