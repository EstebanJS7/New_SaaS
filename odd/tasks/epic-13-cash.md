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
