# EPIC-09 WU2 — Catalog HTTP surface, permissions and audit

## Objective

Deliver EPIC-09 work unit WU2: an allowlisted HTTP surface over the catalog and
the global tax-rate list, with granular permissions, typed validation,
transactional audit and byte-equivalent cross-tenant `404` behavior — without
staff UI, web proxy, appointment service linkage or any tax arithmetic.

## Problem and why

WU1 delivered the persistence, the seeded rates and a tenant-safe repository,
but nothing can reach them: there is no route, no DTO, no permission key and no
way for the browser to read the catalog. Inventory, Purchases and POS all need a
stable, authorized read and write contract before they can start.

## Scope and constraints

- In scope: the four `catalog.*` permission keys and their role matrix, the
  module wiring, the allowlisted DTO projections, Zod write and query
  validation, the service layer with defense-in-depth permission re-assertion,
  transactional audit, the read surface for items and rates, the write surface
  (create, update, deactivate), route-contract pins, the shared in-memory test
  harness extension and HTTP integration tests.
- Decided permission matrix (maintainer, 2026-09-25): `OWNER` and `ADMIN` hold
  all four; `INVENTORY_MANAGER` holds all four because the catalog is its
  domain; `VETERINARIAN`, `RECEPTIONIST` and `CASHIER` hold `catalog.read` only.
  This mirrors the existing `customers`/`patients` shape, where the operational
  role reads widely and manages its own domain.
- Ratified product rules: exactly one globally seeded rate required per item at
  creation; a rate-less create or a rate-clearing update is rejected and
  persists nothing; an update that omits the rate leaves it unchanged; rates are
  globally seeded and tenant read-only with no mutation route; the optional
  reference price is an amount plus ISO 4217 currency pair (PYG offered by
  default, both-or-neither), informational only.
- Out of scope: staff UI and the web proxy (epic WU3); the
  `SERVICE`↔`Appointment` association and agenda filter (epic WU4); live-PG and
  closure gates (epic WU5); stock, POS, invoice, fiscal and any
  tax-included/excluded, rounding or conversion arithmetic; tenant-created rates
  or per-item rate overrides.
- Preserve unrelated uncommitted work; do not push; commit only when the
  maintainer asks.
- TDD mode: disabled, source `openspec/config.yaml` `strict_tdd: false`; runner
  `pnpm test` (focused: `pnpm --filter @newsaas/api test`,
  `pnpm --filter @newsaas/database test`).

## Tasks

- [x] A1: Add the four `catalog.*` permission keys with the decided role matrix,
      and reconcile every pinned count that the new keys move (seed counts,
      role-permission assertions, route/permission pins), leaving both package
      suites green with no new route.
- [x] A2: Read surface end-to-end: module wiring, read-only rate list, item list
      with filters and item detail, allowlisted DTOs, query validation,
      route-contract pins, in-memory harness delegates, and HTTP integration
      tests including cross-tenant `404`.
- [x] A3: Write surface end-to-end: create, update and soft-deactivate with pair
      validation, mandatory seeded rate, transactional co-committed audit,
      cross-tenant `404`, and byte-equivalence between unknown and foreign ids.
- [x] A4: Run focused and root checks over the whole unit and report every
      executed command with its observed result and anything that could not run.

## Acceptance criteria and checks

- Every catalog route enforces a granular permission and the service re-asserts
  it; a missing permission is `403` and persists nothing.
- Read DTOs are allowlisted and INTERNAL: no Prisma model is returned, no
  sensitive payload is logged, and the seeded rate arrives as a nested read-only
  projection.
- A rate-less create or a rate-clearing update is `400 VALIDATION_FAILED` and
  persists nothing, including a bad amount/currency pair or an unknown rate id.
- Cross-tenant item ids, and any cross-tenant anchor in a write, return a
  byte-equivalent `404` identical to an unknown id, with nothing persisted.
- Every write appends exactly one audit row in the same transaction, with stable
  ids and field names only, and no catalog event is emitted.
- Deactivation is the only removal; no delete route exists.
- `pnpm --filter @newsaas/api test`, `pnpm --filter @newsaas/database test`,
  root lint, typecheck, test, build and format-check are reported with exact
  commands and results.
- Anything requiring a live database is reported as unexecuted, not assumed.

## Progress

- Planning: WU1 is complete and its repository, schema, migration and seed are
  the base for this unit. Permission matrix decided by the maintainer on
  2026-09-25. No source file written yet for this unit.
- A1: `catalog.read`, `catalog.create`, `catalog.update` and
  `catalog.deactivate` seeded and granted exactly per the decided matrix; the
  permission row-volume pin moved 28 -> 32 and a catalog matrix test was added.
  The API-side pins did not move because no route exists yet. Database suite is
  13 files / 204 tests green and the API suite is unchanged at 68 files / 804
  tests.
- A2: the three `catalog.read` routes are live (`GET /catalog/tax-rates`,
  `GET /catalog` with `kind`/`isActive` filters, `GET /catalog/:id`) with
  allowlisted INTERNAL DTOs, Zod query and path validation, defense-in-depth
  permission re-assertion, route-contract pins, the shared test double extended
  with `taxRate`/`catalogItem` and the three seeded rates, six HTTP integration
  cases and the CAT-002 Story. The rate arrives as a nested read-only projection
  built by loading the three global rows once and mapping by id, so the test
  double needs no Prisma `include`.
- Verification: A1 and A2 green. Database 13 files / 204 tests, API 69 files /
  811 tests passed with 40 live-PG tests skipped, focused harness 21/21, both
  package typechecks and the API lint clean, targeted Prettier and
  `git diff --check` clean. Live database steps remain unexecuted: PostgreSQL
  and Redis are unreachable.
- Open question for the UI slice, not a defect: `GET /catalog` applies no
  implicit active-only filter, so an omitted `isActive` returns inactive items
  too. The staff list should default to active and expose a toggle.
- A3: `POST /catalog`, `PUT /catalog/:id` and `POST /catalog/:id/deactivate` are
  live with per-route permissions, defense-in-depth re-assertion, strict Zod
  bodies, seeded-rate resolution, one co-committed audit row per mutation and
  byte-equivalent cross-tenant `404`. Audit actions follow the repository's
  `<entity_snake>.<past_verb>` convention (`catalog_item.created`, `.updated`,
  `.deactivated`) and record changed field names only. Twelve new HTTP cases
  bring the API suite to 69 files / 823 tests. The in-memory double needed no
  further extension because its catalog write paths already existed.
- A4: Root gates green after A3 — `pnpm lint` (14 tasks), `pnpm typecheck` (14
  tasks), `pnpm test` (exit 0: preflight 2 files / 6 tests, shared 3 / 16,
  database 13 / 204, worker 6 / 37, web 43 / 428, api 69 passed + 1 skipped /
  823 passed + 40 skipped), `pnpm build` (9 tasks), `pnpm format-check`, and
  both `git diff --check` variants.
- Verification: WU2 complete for every check this environment can run. Still
  unexecuted because PostgreSQL and Redis are unreachable: migration
  application, `pnpm db:seed`, the CI count probe, `pnpm db:live-verify` and
  `pnpm test:live-pg`, so no catalog write has been exercised against a real
  database.
- Next: epic WU3 (staff UI and web proxy), then WU4 (appointment service
  linkage) and WU5 (live-PostgreSQL closure evidence).

## Verification evidence

- Pending for this unit. WU1 evidence is recorded in
  `odd/tasks/epic-09-wu1-catalog-foundation.md` and in
  `docs/02-stories/CAT-001-catalog-item-foundation.md`.

## Notes

- The shared in-memory Prisma double in
  `apps/api/test/support/in-memory-database.ts` has no catalog delegates yet;
  the read surface cannot be tested over HTTP until it does, and that extension
  is expected to be the highest-effort part of A2.
- `POST /catalog/:id/deactivate` follows the repository's command-style
  convention for transitions rather than a generic status `PATCH`.
