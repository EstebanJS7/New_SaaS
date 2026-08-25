---
id: TD-006
type: tech-debt
title: Run tenant-isolation suites against live PostgreSQL
status: open
severity: medium
related_epics:
  - EPIC-01
related_stories:
  - DAT-004
created: 2026-08-24
updated: 2026-08-24
---

# TD-006 — Run tenant-isolation suites against live PostgreSQL

## Context

The Batch 5 cross-tenant isolation suites
(`apps/api/test/cross-tenant- isolation.e2e-spec.ts`) execute over an in-memory
structural Prisma boundary (`apps/api/test/support/`) instead of a live
`DATABASE_URL_TEST` PostgreSQL. The fake faithfully mirrors the predicate
semantics the scoping depends on and TypeScript pins column names against the
generated client, but **no machine currently executes the tenant-scoping SQL
through a real PostgreSQL** inside any quality gate. The CI migrations job
proves DDL applies; it does not prove query-path behavior.

Disclosed in the change record at apply time; this record formalizes the
deferral per DOCUMENTATION-RULES instead of leaving it as prose.

## Debt

A future repository path using raw SQL or Prisma features whose semantics
diverge from the in-memory fake would be invisible to every current gate while
passing all isolation tests.

## Why It Is Safe to Defer

The shipped aggregate uses only typed Prisma `where` scoping validated by
typecheck; the fake is fail-loud on unimplemented delegates; and the adversarial
review confirmed deleting the implicit predicate still fails the suite. Risk is
limited to future query-path divergence, which typecheck constrains today.

## Risk

Low-to-moderate: silent scoping regression on a raw-SQL path reaching production
undetected by tests.

## Evidence Gate

Resolution requires the CI migrations job (which already provisions a PG16
service container) to also run the cross-tenant isolation e2e suite against
`DATABASE_URL_TEST` with migrations applied, green.

## Proposed Resolution

Extend `.github/workflows/ci.yml` migrations job: after `migrate deploy` +
seed-count probe, export `DATABASE_URL_TEST` and run
`pnpm --filter @newsaas/api test -- cross-tenant`. No application code changes.

## Trigger / Target

Before the first business-domain epic lands additional tenant-scoped aggregates,
and mandatory before any production deployment.

## Verification After Resolution

- [ ] CI runs the isolation suite against live PG16 and stays green.
- [ ] A deliberately broken predicate fails that CI job (one-off proof).
- [ ] This record closed with a link to the enabling commit.
