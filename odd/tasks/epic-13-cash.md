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
- [x] CASH-003 W1: the expected-amount helper (`cash.expected-amount.ts`) and
      the `POST /cash/sessions/:id/close` command (row lock, OPEN gate,
      conditional write, audit).
- [x] CASH-003 W2: durable live-PostgreSQL coverage for close.
- [x] CASH-003 W3: reconcile docs, run checks and run the native review
      (`review-24ef69934fe4e591`, approved on the first pass).
- [x] CASH-004 W1: `GET /cash/movements` (`9796aa2`).
- [x] CASH-004 W2: the proxy extension and the Cash client move (`f81cf5b`).
- [x] CASH-004 W3: the staff Cash pages, their states and the navigation entry
      (`2b0e3e9`).
- [ ] CASH-004 W5 (RESUME HERE): candidate C needs its correction. State after
      the chained review: A `9796aa2` (the movement read, worktree
      `/tmp/cash-review-a`) — lineage `review-eb52f160ccb3d48e` APPROVED and
      acknowledged after one bounded correction: the route-contract inventory
      now lists `GET /cash/movements` in the controller's registration order.
      That fix landed on the branch as `f447a7a`. Informational findings only
      otherwise. B `f81cf5b` (proxy + client move, worktree
      `/tmp/cash-review-b`) — lineage `review-1ae7d843132142ca` APPROVED and
      acknowledged on the first pass, no correction; two informational findings.
      C `f81cf5b..bd97851` (pages, navigation and docs, worktree
      `/tmp/cash-review-c`) — lineage `review-49541177bab12a4c` ran its single
      `reliability` lens and returned `correction_required`; the correction
      request has NOT been read or applied yet. Resume with STATUS on
      `/tmp/cash-review-c` for that lineage, then apply the fix inside the
      worktree, cherry-pick it onto the branch, and run the targeted validation.
      Budget note: a medium-tier candidate of 3668 lines reviewed fine, while a
      high-tier 4-lens candidate of 4763 was refused, so keep any further split
      under roughly 3.5k lines.
- [x] CASH-004 W4 (superseded): the single-candidate review was refused. range
      with `lens_context_budget_exceeded` (about 4.8k changed lines), so it is
      being reviewed as three CHAINED candidates, each in its own detached
      worktree and without rewriting history: A `9796aa2` the movement read, 337
      lines, worktree `/tmp/cash-review-a`; B `f81cf5b` the proxy plus the
      client move, 788 lines; C `2b0e3e9..HEAD` the pages, navigation and docs,
      3638 lines. State: A's lineage `review-eb52f160ccb3d48e` ran its four
      lenses and returned `correction_required`; the correction request has NOT
      been read or applied yet. B and C have no lineage yet. Candidate C may
      itself exceed the reviewer budget and would then need the pages commit
      split further.

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
- CASH-002 review outcome: approved and acknowledged
  (`review-d726ed07cc0e7124`); the remaining findings were informational only.
- CASH-003 delivery (`03e4d22`): `cash.expected-amount.ts` with its 15 unit
  tests, the close command in the cash module, the DTO extension and the live
  close block. Verification: database 17 files / 361 tests; API 76 files / 1104
  tests; API live suite 119 tests; typecheck, lint, format-check and
  `git diff --check` green.
- CASH-003 native review: `review-24ef69934fe4e591` (high tier, scoped to the
  CASH-003 commit range) approved and acknowledged on the first pass, with no
  correction requested. Informational findings only: a duplicated raw movement
  insert helper in the live spec, the reused opening-amount pattern name in the
  close body, and the deliberate non-idempotent retry semantics the DEC-036
  terminal state requires.
- CASH-004 review split (2026-09-30): the provider refused the single-candidate
  review with `lens_context_budget_exceeded` and instructed smaller chained
  candidates. The split is non-destructive: the commits and the branch are
  unchanged, and only a detached worktree at each intermediate commit is added.
- Branch published (2026-09-30): `feat/epic-13-cash-data-foundation` is pushed
  and PR #84 is open against `main` with the `type:feature` label and both
  required checks GREEN on CI run `36797910280` (`Database migrations` 1m14s,
  `Lint, Typecheck, Test, Build` 4m10s). The stories stay `review` until that PR
  MERGES: `done` requires a merged CI receipt, never an open one.
- CASH-004 verification: web suite 81 files / 939 tests; API suite 76 files /
  1107 tests; API live suite 119 tests; typecheck, lint, build, format-check and
  `git diff --check` green after fixing one lint error in the movement panel.
- CASH-004 slice-level resolutions (verified before implementation, 2026-09-30):
  the epic's approved scope already lists "the movement list" for the staff Cash
  UI, but EPIC-12 shipped no movement read route (`GET /cash/registers` and
  `GET /cash/sessions` only) and CASH-002 added only the create, so CASH-004
  adds the minimal `GET /cash/movements` read behind the existing `cash.read`
  permission — no new permission, no new capability and no product scope change.
  Also verified: `apps/web/src/app/(app)/app/sales/cash-api.ts` has NO consumer
  outside its own test, so the planned move changes no POS behavior.
- CASH-003 slice-level resolutions (verified before implementation, 2026-09-30):
  `cash.session.close` is ALREADY seeded on OWNER/ADMIN/CASHIER since EPIC-01,
  so the seeded catalog stays at 52 and only the role-matrix/probe assertions
  need no change; `POST` commands in this repo return `201` by convention (the
  purchase receive and session open precedents), so the close returns `201`; and
  per DEC-036 a second close is the stable `409`, never a replay.
- CASH-002 verification: database suite 17 files / 361 tests; `db:deploy` 27
  migrations applied over a database holding cash rows; live `db:seed` reporting
  52 permissions with `cash.movement.create` on exactly ADMIN, CASHIER and
  OWNER; API suite 75 files / 1069 tests; API live-PostgreSQL suite 109 tests;
  typecheck, lint, format-check and `git diff --check` green. One lint error in
  the new integration case was fixed before the commit.
