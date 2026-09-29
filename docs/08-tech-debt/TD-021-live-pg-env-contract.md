---
id: TD-021
type: tech-debt
title:
  Live-PostgreSQL suite falls back to the Prisma DATABASE_URL when
  DATABASE_URL_TEST is undeclared
status: open
severity: low
related_epics:
  - EPIC-12
related_stories:
  - POS-001
created: 2026-09-27
updated: 2026-09-27
---

# TD-021 — Live-PostgreSQL suite falls back to the Prisma DATABASE_URL when DATABASE_URL_TEST is undeclared

## Context

The live-PostgreSQL suite reads its base connection string with a fallback
(`apps/api/test/live-pg-isolation.e2e-spec.ts:907`):

```text
const livePgDatabaseUrl = process.env.DATABASE_URL_TEST ?? process.env.DATABASE_URL;
```

The fallback is what makes the suite runnable without a test variable, and it is
also the source of this defect: `.env` supplies a **Prisma-style**
`DATABASE_URL` that ends in `?schema=public`, and the suite's provisioning
helper passes the derived admin URL straight to `psql`.

Reproduction, from the repository root, with the Prisma-style `DATABASE_URL`
exported and `DATABASE_URL_TEST` **unset**:

```text
pnpm --filter @newsaas/api test
```

Observed result:

```text
psql: error: invalid URI query parameter: "schema"
1 file failed / 918 passed / 80 skipped
```

The failing file is the live-PostgreSQL spec itself: its `describe.skipIf` guard
sees a non-empty URL and starts provisioning, the `CREATE DATABASE` invocation
fails on the Prisma query parameter, and the suite's 80 cases are reported as
skipped behind the file-level failure.

This is **pre-existing and not introduced by the EPIC-12 sale-draft slice**: the
same command reproduces identically at `fd73edc`, the slice's W2 commit, before
its W3 live coverage was added. It was found while verifying [[POS-001]].

Cause: `turbo.json` declares `globalEnv: [..., "DATABASE_URL", ...]` but not
`DATABASE_URL_TEST`, and Turbo 2's strict env mode does not forward an
undeclared variable to a task. The suite therefore never sees the test variable
even when the caller exports it, falls back to `DATABASE_URL`, and the
`adminDatabaseUrl` helper only rewrites the pathname:

```text
url.pathname = "/postgres";
```

It does not strip the query string, so `?schema=public` survives into the URL
handed to `psql`, which rejects it.

CI is unaffected: `.github/workflows/ci.yml` sets both `DATABASE_URL_TEST` and
`DATABASE_URL` to schema-less URLs
(`postgres://postgres:postgres@localhost:5432/newsaas_migrations`), so the
provisioning step never sees the Prisma parameter. The defect is confined to a
local environment that mirrors the `.env` Prisma URL and runs the suite through
Turbo without the test variable.

## Debt

The suite's environment contract is implicit and silently environment-dependent.
Two independent local conditions must both hold for the live suite to run, and
neither is declared where a developer would look:

- `DATABASE_URL_TEST` must be exported **and** schema-less, and
- the schema-less value only reaches the task if Turbo forwards it.

Because the value is undeclared in `globalEnv`, a caller who exports the test
variable still gets the fallback, and the resulting error names `psql` and a
query parameter rather than the missing turbo declaration. A developer can
plausibly chase the wrong layer — the suite, Prisma or the database — before
finding `turbo.json`. The blast radius is low (no runtime, data or schema
effect; CI is green), which is why the severity is `low`, but the failure is
misleading rather than merely noisy.

No fix was applied in the POS-001 slice because the declaration and the URL
normalization live outside that Story's scope, and changing the shared test
environment contract is a harness decision rather than a sale-draft one.

Two candidate fixes, each sufficient on its own and preferable together:

1. **Declare `DATABASE_URL_TEST` in `turbo.json`'s `globalEnv`.** This restores
   the intended contract: an exported test variable reaches the test task, the
   fallback is no longer taken, and the suite provisions against the schema-less
   URL the CI job already uses. Trade-off: it widens the global environment
   surface for every task, so every task's cache key now invalidates on
   `DATABASE_URL_TEST`; that cost is the honest one, since the variable
   genuinely changes test behavior.
2. **Strip the query string inside `adminDatabaseUrl`.** Clearing the search
   parameters after rewriting the pathname makes the helper robust to any
   Prisma-style URL, so a Prisma-style value also stops failing provisioning.
   Trade-off: it fixes the symptom for the admin connection only — the app
   connection still receives the Prisma URL, and the fallback remains, so the
   undeclared-variable confusion stays.

Option 1 addresses the contract; option 2 makes the helper tolerant of a value
the repository actively documents in `.env`. Doing both leaves no path where a
schema-less test URL is silently replaced by a Prisma URL.

## Trigger / Target

The next change to the API test environment, to `turbo.json`'s `globalEnv`, or
to the live-PostgreSQL suite's connection or provisioning helpers.

## Verification After Resolution

- [ ] The root `pnpm test` passes with only the Prisma-style `DATABASE_URL`
      exported and no `DATABASE_URL_TEST`.
- [ ] A Prisma-style `DATABASE_URL_TEST` also stops failing the provisioning
      step.
- [ ] The live suite still skips cleanly when no database is configured, with no
      provisioning attempt and no file-level failure.
