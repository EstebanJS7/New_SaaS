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

- [ ] W1: Create Story `CAT-001` and move EPIC-09 to `in-progress` with the
      working branch recorded.
- [ ] W2: Add the catalog item model, the global tax-rate model, the kind enum
      and the tenant relation to `schema.prisma`, plus the migration, with the
      physical guarantees: composite tenant uniqueness, `Restrict` foreign keys,
      price/currency pair `CHECK`, non-negative guards and a delete-rejecting
      trigger.
- [ ] W3: Add `schema-catalog.test.ts` textual gates mirroring the existing
      schema tests, and keep the convention tests green.
- [ ] W4: Seed the three global rates idempotently through `reference-seed.ts`,
      exported from the package, with the seed test, CI seed-count probe and
      live-migration verification updated.
- [ ] W5: Add the tenant-scoped catalog repository seam and its tenant-isolation
      unit tests.
- [ ] W6: Run the focused and root checks; report every executed command with
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
  conventions completed; candidate surfaces and sub-slices identified. No source
  file written yet.
- Verification: pending.
- Next: W1.

## Verification evidence

- Pending. Each task records the exact command and observed outcome when it
  runs.

## Rationale for settled choices

- Non-null foreign key over an enum: PRD §15 treats rates as data rather than
  hardcoded logic, and the repository already ships that shape for `Species` and
  `Breed`; the cost is a strict seed-before-insert precondition, which is
  documented rather than hidden.
- Fixed price scale: [[DEC-010]] deliberately leaves per-currency scale open, so
  the catalog must not imply per-currency arithmetic; a later POS requirement
  needs its own decision and migration.
