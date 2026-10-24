---
id: HARD-005
type: story
title: Gate determinism
epic: EPIC-20
status: done
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

- [x] The live-PG suite sets a deterministic session timezone on connect, so its
      result cannot depend on the cluster.
- [x] Zone-less `timestamptz`/`date` literals in the suite are audited; any that
      rely on the session zone are made explicit.
- [x] A cluster at `America/Asuncion` and one at `UTC` produce the same result.
      Both runs are executed and recorded.

### TD-021

- [x] The `DATABASE_URL` fallback is replaced by an explicit contract: a missing
      `DATABASE_URL_TEST` fails loudly with a message naming the variable,
      instead of silently reusing `DATABASE_URL`.
- [x] A test covers the missing-variable path.

### TD-015

- [x] `packages/database/scripts` enters both the package lint and the package
      typecheck scope.
- [x] The root `pnpm lint` and `pnpm typecheck` remain green.
- [x] A deliberately broken type in a script fails the package typecheck,
      proving the coverage is real, and the probe is reverted with its result
      recorded.

### TD-003

- [x] The worker's shutdown handler is idempotent: a repeated `SIGTERM`/`SIGINT`
      does not re-enter teardown.
- [x] A test covers the repeated-signal case.

## Verification

```text
pnpm format-check && pnpm lint && pnpm typecheck && pnpm build
pnpm --filter @newsaas/database test
pnpm --filter @newsaas/worker test
pnpm --filter @newsaas/api test:live-pg     (both timezones, executed)
```

## Implementation summary

Four Tech Debt items with one shared cause: a gate whose result depended on the
machine, or that did not run over code it was supposed to cover. All four are
resolved, and each resolution carries an executed proof rather than a
configuration change asserting its own effectiveness.

### TD-054 — the live-PG lane no longer depends on the cluster's timezone

Two layers, because the record named two causes:

```text
fixtures    '2018-04-30' -> '2018-04-30T00:00:00Z'
            '2019-09-01 12:00:00' -> '2019-09-01T12:00:00Z'
            (a sweep found the other ::timestamptz literals already zoned or bound
             as Date objects, which Prisma serializes with a zone)
suite       createDatabase() now also issues
            ALTER DATABASE <name> SET timezone TO 'UTC'
            — the right lever precisely BECAUSE the suite creates its own database:
            it applies to every connection to it, including the ones migrate and
            the seed spawn, and ignores the cluster's own configuration
```

**The two-directional proof, executed:**

```text
cluster at America/Asuncion (the zone TD-054 said broke it)    266 passed (266)
cluster at UTC   (after ALTER SYSTEM SET timezone TO 'UTC')    266 passed (266)
```

Same suite, same code, two different cluster timezones. Before this change those
two runs produced 265/266 and 266/266.

### TD-021 — the connection contract is explicit

`DATABASE_URL_TEST` is the only source; the `DATABASE_URL` fallback is gone. The
default `pnpm test` lane still skips without it (that is what keeps the suite
usable without a PostgreSQL), and the dedicated lane — now on its own
`vitest.live-pg.config.ts` with `LIVE_PG_REQUIRED=1` — **fails** naming the
variable. Verified by running it unset: it failed with the message instead of
measuring whatever `DATABASE_URL` pointed at.

### TD-015 — the database scripts are inside the quality scope

```text
packages/database/tsconfig.scripts.json   noEmit, rootDir ".", scripts/**/*.ts
typecheck                                 tsc -p tsconfig.json --noEmit && tsc -p tsconfig.scripts.json
lint                                      src/**/*.ts + scripts/**/*.ts + scripts/**/*.mjs
```

A second project was necessary: `tsconfig.json` pins `rootDir: ./src`, and
moving it would relocate every emitted path and break `main: ./dist/index.js`
for every consumer of the package.

**The scope found ten lint errors immediately** that no gate had ever seen
(eight auto-fixable `@typescript-eslint/array-type` violations). Eleven
`no-console` warnings remain and the repository's own rule allows them.

**The coverage was proven by breaking it:** a deliberately ill-typed statement
in `live-migration-verify.ts` produced

```text
scripts/live-migration-verify.ts(21,7): error TS2322: Type 'string' is not
  assignable to type 'number'.
```

and was then reverted, with the gate re-run green.

### TD-003 — the worker survives a repeated signal

The record named listener removal as the defect. There were **two** instances of
it: the explicit `off` calls AND the `once` registration, since a one-shot
listener is removed the moment it fires. Both are gone; the guard is now a
`shuttingDown` flag over persistent `on` listeners.

The evidence gate's scenario — a second signal **while the shutdown promise is
pending** — is exactly the case the old code could not survive, and it now has
its own test: the shutdown starts, `SIGTERM` and `SIGINT` are delivered
mid-flight, the teardown does not re-run, nothing exits, and resolving the
promise produces a single `exit(0)`.

### Two defects found while resolving these, recorded rather than smoothed over

1. **`psql` rejects `?schema=public`** — a Prisma convention, not a libpq one —
   and `adminDatabaseUrl()` passed it straight through. This is why TD-021's
   fallback was dangerous rather than merely untidy: it took the base URL from
   the application's own connection string, which carries that parameter, so a
   local run failed with `invalid URI query parameter: "schema"`. Fixed by
   deleting the parameter before the URL reaches `psql`.
2. **`.mjs` needed `project: null`, not just disabled rules** in the shared
   ESLint config, because `languageOptions` merge across flat-config entries and
   the parser still received a `project` that contains no `.mjs` file.

### An implementation mistake worth recording

While editing `installSignalShutdown` the first time, the parameter
`handle: WorkerHandle` was dropped from the signature by a careless replacement.
The tests caught it, but only after three debug cycles: the failure read
`proc.on is not a function`, because the caller's first argument had become
`proc`. It is recorded here because the diagnostic was genuinely misleading — a
reminder that a signature edit deserves a `git diff` read, not just a green
suite.

### Verification run

```text
pnpm --filter @newsaas/api test:live-pg   266/266 at America/Asuncion
pnpm --filter @newsaas/api test:live-pg   266/266 at UTC
pnpm --filter @newsaas/api test:live-pg   FAILS naming DATABASE_URL_TEST when unset
pnpm --filter @newsaas/database typecheck pass (scripts scope included)
pnpm --filter @newsaas/database typecheck FAILS on a deliberate type error
pnpm --filter @newsaas/database lint      pass, 0 errors (10 fixed by this story)
pnpm --filter @newsaas/database test      30 files / 550 passed
pnpm --filter @newsaas/worker test        20 files / 283 passed  (was 282)
```
