---
id: HARD-005
type: story
title: Gate determinism
epic: EPIC-20
status: planned
priority: high
depends_on: []
prd_sections:
  - "29"
permissions: []
branch: feat/epic-20-production-hardening
created: 2026-10-22
updated: 2026-10-22
---

# HARD-005 — Gate determinism

## Objective

Four Tech Debt items share one failure mode: a quality gate whose result depends
on the machine it runs on, or that does not run at all over code it is supposed
to cover. A release gate that is green here and red there is not a gate.

```text
TD-054  the live-PG lane depends on the database server's timezone
TD-021  the live-PG lane silently falls back to DATABASE_URL
TD-015  packages/database/scripts sits outside lint and typecheck
TD-003  the worker's shutdown is not guarded against repeated signals
```

## Context

**TD-054** is the sharpest. The live-PG lane reported 265/266 against a cluster
at `America/Asuncion` and 266/266 against one at `UTC`, with no code change
between them: a zone-less literal cast to `timestamptz` is interpreted in the
session timezone, so `'2018-04-30'::timestamptz` becomes `2018-04-30 04:00:00Z`
in Paraguay and violates two constraints at once. PostgreSQL reports whichever
it evaluates first, and that order is not contractual. CI runs
`postgres:16-alpine` (UTC) and never sees it; `America/Asuncion` is
`TENANT_TIME_ZONE` in `packages/shared/src/platform.ts`, so it is the zone most
likely to be set on a developer machine in this product's market.

**TD-021**: the suite reads
`process.env.DATABASE_URL_TEST ?? process.env.DATABASE_URL`, so a misconfigured
run silently targets whatever `DATABASE_URL` points at — including a developer's
real database.

**TD-015**: `packages/database` lints and typechecks `src/**/*.ts` only, but CI
executes `scripts/live-migration-verify.ts` and `scripts/ci-seed-counts.mjs` in
the `Database migrations` job. Both are part of the release gate and neither is
covered.

**TD-003**: the worker's shutdown path is not guarded against a repeated signal.

## Acceptance Criteria

### TD-054

- [ ] The live-PG suite sets a deterministic session timezone on connect, so its
      result cannot depend on the cluster.
- [ ] Zone-less `timestamptz`/`date` literals in the suite are audited; any that
      rely on the session zone are made explicit.
- [ ] A cluster at `America/Asuncion` and one at `UTC` produce the same result.
      Both runs are executed and recorded.

### TD-021

- [ ] The `DATABASE_URL` fallback is replaced by an explicit contract: a missing
      `DATABASE_URL_TEST` fails loudly with a message naming the variable,
      instead of silently reusing `DATABASE_URL`.
- [ ] A test covers the missing-variable path.

### TD-015

- [ ] `packages/database/scripts` enters both the package lint and the package
      typecheck scope.
- [ ] The root `pnpm lint` and `pnpm typecheck` remain green.
- [ ] A deliberately broken type in a script fails the package typecheck,
      proving the coverage is real, and the probe is reverted with its result
      recorded.

### TD-003

- [ ] The worker's shutdown handler is idempotent: a repeated `SIGTERM`/`SIGINT`
      does not re-enter teardown.
- [ ] A test covers the repeated-signal case.

## Verification

```text
pnpm format-check && pnpm lint && pnpm typecheck && pnpm build
pnpm --filter @newsaas/database test
pnpm --filter @newsaas/worker test
pnpm --filter @newsaas/api test:live-pg     (both timezones, executed)
```
