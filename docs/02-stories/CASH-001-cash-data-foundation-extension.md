---
id: CASH-001
type: story
title: Cash data foundation extension
epic: EPIC-13
status: review
priority: high
depends_on:
  - EPIC-12
prd_sections:
  - "20"
  - "27"
  - "28"
  - "29"
  - "41"
permissions: []
branch: feat/epic-13-cash-data-foundation
created: 2026-09-30
updated: 2026-09-30
---

# CASH-001 — Cash data foundation extension

## Objective

Extend the EPIC-12 Cash schema additively so the Cash module can support the
remaining PRD §20 movement kinds, close-result storage, mandatory reasons for
manual/corrective movements and a database-owned closed-session guard.

## Context

EPIC-12 shipped `CashRegister`, `CashSession` and `CashMovement` with `SALE` as
the only cash movement kind, required `opening_amount`, one `OPEN` session per
register, immutable movements and no close route. EPIC-13 must build on that
foundation rather than replace it.

## In Scope

- Add `REFUND`, `INCOME`, `EXPENSE`, `WITHDRAWAL`, `DEPOSIT` and `ADJUSTMENT` to
  `cash_movement_type` additively.
- Add close-result fields to `cash_session`: `expected_amount`, `counted_amount`
  and `difference_amount`.
- Add the conditional reason requirement for the movement kinds named by
  [[DEC-032]].
- Add the database trigger that rejects movement inserts into a `CLOSED`
  session.
- Schema, migration and live-PostgreSQL applied-schema coverage.

## Out of Scope

- Movement creation API — [[CASH-002]].
- Close command behavior — [[CASH-003]].
- Staff Cash UI — [[CASH-004]].
- Sale reversal and payment refund — [[TD-018]].

## Acceptance Criteria

- [x] `cash_movement_type` is extended additively with the six remaining PRD §20
      kinds; `SALE` remains present and unchanged. Evidence:
      `schema-cash.test.ts` pins the migration and Prisma enum order, and the
      live-PostgreSQL suite reads `pg_enum` ordered by `enumsortorder`.
- [x] `cash_session` carries close-result columns for expected, counted and
      difference amounts, using Decimal/NUMERIC money precision. Evidence:
      `schema-cash.test.ts` pins nullable `DECIMAL(14,2)` columns and the
      live-PostgreSQL suite reads `information_schema.columns`.
- [x] A conditional database `CHECK` rejects missing or blank reasons for
      `REFUND`, `EXPENSE`, `WITHDRAWAL`, `DEPOSIT` and `ADJUSTMENT`, while
      keeping `SALE` reason-optional. Evidence: migration tests pin the
      transaction-safe `type::text IN ('SALE', 'INCOME') OR reason present`
      shape, and live-PostgreSQL rolled-back probes reject null and blank
      reasons for every required kind while admitting `SALE` and `INCOME`
      without a reason.
- [x] A database trigger rejects inserting a movement into a `CLOSED` session.
      Evidence: migration tests pin
      `cash_movement_no_insert_into_closed_session_trigger`, and the
      live-PostgreSQL suite proves the exact trigger message.
- [x] Tenant composite ownership keys, foreign keys, immutability triggers and
      the one-open-session partial unique index stay intact. Evidence: the
      existing EPIC-12 cash live probes still pass and the CASH-001 migration
      tests assert the extension does not recreate or weaken those invariants.
- [x] Tenant isolation is enforced when applicable. Evidence: no tenant-boundary
      behavior changed, and the EPIC-12 cash live tenant-isolation cases still
      pass inside the 100-test live suite.
- [x] Backend authorization is enforced when applicable. Evidence: this Story
      adds no route or permission surface; the existing Cash route guard cases
      still pass inside the live and API/typecheck gates.
- [x] Required loading/error/empty/success UX exists. Evidence: not applicable;
      this Story has no UI change.
- [x] Required audit exists. Evidence: this Story adds no write command; close
      and movement audit are owned by [[CASH-002]] and [[CASH-003]].
- [x] Tests required by the Story pass. Evidence: schema, database, live-PG,
      lint, typecheck, build, format and whitespace checks passed locally.

## Domain Invariants

- Movement enum changes are additive only.
- Closed sessions are terminal accounting records.
- A movement reason is a database invariant for manual/corrective movement
  kinds; `SALE` and `INCOME` remain reason-optional.
- No cash balance is mutated directly.

## API

### Added

```text
None yet
```

### Changed

```text
None yet
```

## Database

### Migration

Planned: an additive EPIC-13 migration extending `cash_movement_type`, adding
close-result columns to `cash_session`, adding the conditional reason `CHECK`
and adding the closed-session insert guard.

### Models/Tables

- `CashSession` — gains close-result fields.
- `CashMovement` — keeps immutable movement rows and gains the enum values the
  command stories use.

## UI

- None. This is a data-foundation story.
- If UI is changed, confirm reusable components use semantic branding tokens
  rather than project-specific literals.

## Implementation Summary

In progress on `feat/epic-13-cash-data-foundation`.

Implemented the additive data foundation migration
`20260930000001_cash_data_foundation`:

- appended `REFUND`, `INCOME`, `EXPENSE`, `WITHDRAWAL`, `DEPOSIT` and
  `ADJUSTMENT` to `cash_movement_type` without rewriting `SALE`;
- added nullable `expected_amount`, `counted_amount` and `difference_amount` to
  `cash_session`;
- added the transaction-safe `cash_movement_reason_required` `CHECK` as
  `type::text IN ('SALE', 'INCOME') OR reason present`, avoiding unsafe
  same-transaction enum-literal use while preserving [[DEC-032]]'s optional
  reason for `INCOME`;
- added `cash_movement_no_insert_into_closed_session_trigger`, which rejects a
  movement insert into a `CLOSED` session with `restrict_violation`.

Updated `packages/database/prisma/schema.prisma` to mirror the enum values and
close-result fields, and updated `packages/database/src/schema-cash.test.ts`
plus `apps/api/test/live-pg-isolation.e2e-spec.ts` with CASH-001 coverage.

## Verification

Run locally on 2026-09-30 on `feat/epic-13-cash-data-foundation`.

```text
pnpm services:up                                                                 -> passed after Docker WSL integration was restored
set -a && source .env && set +a && pnpm --filter @newsaas/database db:deploy     -> passed, 26 migrations applied including 20260930000001_cash_data_foundation
set -a && source .env && set +a && pnpm --filter @newsaas/database db:live-verify -> passed after resetting the local Docker volume for a clean database
set -a && source .env && export DATABASE_URL="${DATABASE_URL%%\?*}" && export DATABASE_URL_TEST="$DATABASE_URL" && set +a && pnpm --filter @newsaas/api test:live-pg -> passed, 100 tests
pnpm --filter @newsaas/database exec vitest run src/schema-cash.test.ts           -> passed, 36 tests
pnpm --filter @newsaas/database db:generate                                      -> passed
pnpm --filter @newsaas/database test                                             -> passed, 17 files / 352 tests
pnpm typecheck                                                                   -> passed
pnpm lint                                                                        -> passed
pnpm build                                                                       -> passed
pnpm format-check                                                                -> passed
npx prettier --write apps/api/test/live-pg-isolation.e2e-spec.ts                 -> passed; file unchanged after the transaction-abort probe fix
git diff --check                                                                 -> passed
```

Notes:

- The first `db:live-verify` attempt failed on a dirty local database because
  `live-migration-verify.ts` creates fixed-slug tenants. The local Docker volume
  was reset with maintainer authorization, then the command passed.
- The first `test:live-pg` attempt used Prisma's `?schema=public` URL and failed
  before tests because `psql` rejects that query parameter on the admin URL. The
  passing run exported schema-less `DATABASE_URL` and `DATABASE_URL_TEST`, which
  is the existing [[TD-021]] live-suite contract.
- The first CASH-001 live probe kept testing after a rejected SQL statement
  inside the same transaction, so PostgreSQL correctly reported the transaction
  aborted. The probe now isolates each expected rejection in its own rolled-back
  transaction.

## Tests Added

- `packages/database/src/schema-cash.test.ts` — CASH-001 migration tests for the
  appended enum values, nullable close-result columns, transaction-safe reason
  `CHECK`, closed-session insert trigger, additivity and data classification;
  schema tests for the expanded Prisma enum, close fields and movement reason
  documentation.
- `apps/api/test/live-pg-isolation.e2e-spec.ts` — planned live-PostgreSQL probes
  for the applied enum order, close columns, reason `CHECK`, closed-session
  trigger and updated applied trigger/constraint inventories. These compile via
  `pnpm typecheck` but have not run because Docker is unavailable.

## Known Limitations

- The Story is locally complete and in `review`, but it is not marked `done`
  until the branch is committed and receives the required CI/PR receipt.
- The live suite still requires schema-less `DATABASE_URL` / `DATABASE_URL_TEST`
  locally per [[TD-021]].

## Technical Debt

- None planned.

## Decisions / ADRs

- [[DEC-030]] — movement sign convention.
- [[DEC-031]] — close-result storage and audit.
- [[DEC-032]] — reason requirement.
- [[DEC-035]] — closed-session insert guard.

## Files / Modules

- `packages/database/prisma/schema.prisma`
- `packages/database/prisma/migrations/`
- `packages/database/src/schema-cash.test.ts`
- `apps/api/test/live-pg-isolation.e2e-spec.ts`
- `docs/01-roadmap/EPIC-13-Cash.md`

## Completion Notes

Local implementation and verification are complete on
`feat/epic-13-cash-data-foundation`. Status is `review`, not `done`, because no
CI receipt exists yet. `done` remains reserved for merged, CI-backed closure.
