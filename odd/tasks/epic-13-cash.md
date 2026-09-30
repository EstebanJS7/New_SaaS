# EPIC-13 Cash — scope preparation and tracking

## Objective

Prepare EPIC-13 Cash as a docs-only scope pass using the accepted maintainer
decisions already recorded in memory: epic record, accepted Decision records and
planned CASH stories before any implementation.

## Constraints

- Do not change PRD scope.
- Do not write implementation code.
- Keep module docs for implemented behavior only; do not update
  `docs/05-modules/Cash.md` for planned EPIC-13 behavior yet.
- Keep all new docs in English and with YAML frontmatter.
- Do not mark the epic or stories beyond `planned` during this pass.

## Tasks

- [x] Create accepted Decision records DEC-030 through DEC-037 for the eight
      EPIC-13 Cash decisions.
- [x] Create `docs/01-roadmap/EPIC-13-Cash.md` aligned to PRD §20, EPIC-12's
      delivered cash foundation and DEC-030..DEC-037.
- [x] Create planned CASH story records for backend data/API, close, movement
      commands, cash UI and closure evidence.
- [x] Run documentation formatting/checks that are practical for the docs-only
      pass and record results.
- [x] CASH-001 W1: map the existing cash schema, migration and test surfaces.
- [x] CASH-001 W2: implement the additive data foundation migration and schema
      tests.
- [x] CASH-001 W3: add durable live-PostgreSQL applied-schema probes.
- [x] CASH-001 W4: reconcile story/epic docs and run required checks.
- [x] CASH-002 W1: `cash_movement_direction` + `direction` column on
      `cash_movement` with the EXCLUSIVE conditional CHECK, and the
      `cash.movement.create` permission seed (51 → 52).
- [x] CASH-002 W2: `POST /cash/movements` command for the six non-sale kinds.
- [x] CASH-002 W3: durable live-PostgreSQL probes for the command.
- [x] CASH-002 W4: reconcile docs, run checks and run the native review.
- [x] CASH-002 W5: correct the single native-review blocker — the command had no
      idempotency, so a retry could double-count cash. It now requires the
      `Idempotency-Key` and derives a deterministic movement id, inside the
      frozen 200-line correction budget.

## Evidence

- Created: 2026-09-30.
- Branch at start: `main` tracking `origin/main`.
- Formatting: `npx prettier --write ...` over the EPIC-13 docs and task file,
  then `npx prettier --check ...` passed.
- Repository docs format: `pnpm format-check` passed.
- Whitespace: `git diff --check` passed.
- CASH-001 W1/W2: read-only map completed by `gentle-ai-explore`; implemented
  `20260930000001_cash_data_foundation`, Prisma schema updates and
  `schema-cash.test.ts` coverage. Verification:
  `pnpm --filter @newsaas/database exec vitest run src/schema-cash.test.ts`
  passed (36 tests) and `pnpm --filter @newsaas/database db:generate` passed.
- CASH-001 W3/W4 complete: after Docker WSL integration was restored and the
  local Docker volume was reset with maintainer authorization, `db:deploy`
  passed with 26 migrations, `db:live-verify` passed, and
  `pnpm --filter @newsaas/api test:live-pg` passed (100 tests) with schema-less
  `DATABASE_URL` / `DATABASE_URL_TEST`. Final checks also passed:
  `pnpm --filter @newsaas/database test` (17 files / 352 tests),
  `pnpm typecheck`, `pnpm lint`, `pnpm build`, `pnpm format-check` and
  `git diff --check`.
- CASH-001 native review: lineage `review-b32aa574e15849f6` approved and
  acknowledged after one bounded correction (INCOME keeps its optional reason;
  the closed-session guard locks the session row with `FOR UPDATE`).
- CASH-001 commits on `feat/epic-13-cash-data-foundation`: `f74bce1` (EPIC-13
  scope decisions and planned stories) and `e72f38f` (CASH-001 data foundation
  extension).
- CASH-002 slice-level resolution (maintainer decision, 2026-09-30): the
  `ADJUSTMENT` direction is stored in a dedicated `cash_movement.direction`
  column backed by a `cash_movement_direction` enum (`INCREASE`/`DECREASE`),
  required exactly for `ADJUSTMENT` and forbidden for every other kind by an
  exclusive conditional CHECK; movement amounts stay positive.
- CASH-002 commits: `15633f0` (direction data layer and permission), `943c301`
  (the command), `456a33d` (live coverage).
- CASH-002 native review lineage `review-d726ed07cc0e7124` (high tier, scoped to
  the CASH-002 commit range) raised one deterministic CRITICAL finding,
  corrected in W5: the command was not idempotent. The route now requires the
  `Idempotency-Key` and derives the movement id from `(tenant, key)`, so the
  PRIMARY KEY is the guarantee; an identical retry replays as `200`, a reused
  key with a different body is the stable `409`, and a concurrent retry replays
  the winner's row. The correction was first rejected by the provider for
  exceeding the frozen 200-line budget, then shrunk to 197 changed lines and
  approved after targeted validation.
- CASH-002 verification after W5: `cash.integration.test.ts` 28 tests, API live
  suite 110 tests, API suite 1071 tests.
- CASH-002 verification: database suite 17 files / 361 tests; `db:deploy` 27
  migrations applied over a database holding cash rows; live `db:seed` reporting
  52 permissions with `cash.movement.create` on exactly ADMIN, CASHIER and
  OWNER; API suite 75 files / 1069 tests; API live-PostgreSQL suite 109 tests;
  typecheck, lint, format-check and `git diff --check` green. One lint error in
  the new integration case was fixed before the commit.
