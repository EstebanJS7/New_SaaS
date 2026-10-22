---
id: TD-054
type: tech-debt
title:
  The live-PostgreSQL lane is not timezone-independent, and the tenant zone is
  the one that breaks it
status: open
severity: medium
owner: qa
related_epics:
  - EPIC-18
  - EPIC-15
  - EPIC-20
related_stories:
  - REP-001
created: 2026-10-19
updated: 2026-10-19
---

# TD-054 — the live-PostgreSQL lane depends on the database server's timezone

## What was found, and how

`apps/api`'s live-PostgreSQL suite (`test/live-pg-isolation.e2e-spec.ts`, 266
cases) was run against a disposable PostgreSQL 16 cluster on 2026-10-19 while
validating [[REP-001]]. It reported **265 passed, 1 failed**:

```text
FAIL  EPIC-15 fiscal data foundation >
      enforces the FISC-011 range invariants on the applied database

AssertionError: expected 'PrismaClientKnownRequestError: ... violates check
  constraint "fiscal_timbrado_range_validity_start_is_a_date"'
  to match /fiscal_timbrado_range_validity_start_tdFeIniT/
```

The test inserts a scalar case list, and the failing case is
`"a validity start before 2018-05-01"` with the literal `"2018-04-30"`:

```ts
${validityStart}::timestamptz
```

A **zone-less literal cast to `timestamptz` is interpreted in the SESSION
timezone.** With the cluster at `America/Asuncion` that becomes
`2018-04-30 00:00:00-04` = `2018-04-30 04:00:00Z`, which violates **two**
constraints at once:

- `fiscal_timbrado_range_validity_start_tdFeIniT` (`>= 2018-05-01 00:00:00+00`)
  — the one the case expects;
- `fiscal_timbrado_range_validity_start_is_a_date`
  (`(validity_start AT TIME ZONE 'UTC') = date_trunc('day', ...)`) — because
  `04:00:00Z` is not midnight UTC.

PostgreSQL reports whichever constraint it evaluates first, and that order is
not part of any contract. With the cluster at `UTC` the literal becomes
`2018-04-30 00:00:00Z`, only `tdFeIniT` is violated, and the case passes.

Setting the cluster's default timezone to `UTC` turned the suite green at **266
passed (266)** with no other change. Note the suite **creates its own
database**, so `ALTER DATABASE <name> SET timezone` is ineffective — the setting
must be cluster-wide (`ALTER SYSTEM SET timezone TO 'UTC'`, or a `TZ` on the
container).

## Why this is real debt and not a local curiosity

CI runs `postgres:16-alpine`, whose default timezone is UTC, so **CI never sees
this**. And the zone that breaks it is `America/Asuncion` — the exact value of
`TENANT_TIME_ZONE` in `packages/shared/src/platform.ts`, and therefore the
timezone most likely to be set on a developer machine in this product's target
market. A contributor in Paraguay runs the lane and gets a failure that CI
reports as green; a contributor anywhere else never reproduces it.

The schema is not at fault. `schema-fiscal-timbrado.test.ts:108` already pins
the `AT TIME ZONE 'UTC'` form deliberately, with a comment explaining that the
obvious `date_trunc('day', timestamptz)` truncates in the session's zone. The
constraint is correct and timezone-independent. The **test fixture** is not: it
supplies a zone-less literal and then assumes a single violated constraint.

## The trigger that would close it

Any of: a contributor reporting a live-PG failure CI does not show; a new scalar
case that inserts a zone-less timestamp; or [[EPIC-20]] Production Hardening
pinning environment determinism.

## What a fix would touch

- `apps/api/test/live-pg-isolation.e2e-spec.ts` — either cast with an explicit
  zone (`'2018-04-30T00:00:00Z'::timestamptz`) so the case is unambiguous, or
  assert the violated constraint as a set rather than a single name. The first
  is the smaller fix and states the intent.
- The suite's setup — `SET timezone = 'UTC'` on connect, so a lane's result
  never depends on the host.
- `docker-compose.yml` and `.github/workflows/ci.yml` — a `TZ`/`PGTZ` pin, so
  the two environments cannot drift.
- A sweep for other zone-less `::timestamptz` or `::date` literals in the same
  suite, since the same latent ambiguity may exist where it currently passes.

## Pointers

- `apps/api/test/live-pg-isolation.e2e-spec.ts` — the scalar case list and the
  `withEstablishment` helper.
- `packages/database/prisma/migrations/20261007000002_fisc_011_emitter_profile_and_timbrado_ranges/migration.sql`
  — both constraints, with the comment explaining the UTC anchoring.
- `packages/database/src/schema-fiscal-timbrado.test.ts:108` — the DDL guard
  that already got this right.
- `packages/shared/src/platform.ts` — `TENANT_TIME_ZONE`.
