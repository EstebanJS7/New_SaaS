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
updated: 2026-08-26
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

**Scope extension (2026-08-25, EPIC-02 review CRITICAL-2):** the RBAC
last-administrator and last-manager rules now decide inside transactions that
first take `SELECT ... FOR UPDATE` row locks over ALL ACTIVE membership rows for
the current tenant (`tenant-membership.repository.ts`, `rbac-admin.service.ts`).
The tenant-wide row set is deliberate: a tenant override can make a non-admin
role an effective `users.membership.manage` holder. The lock order is
deterministic by membership id. The in-memory fake executes that raw query
synchronously against maps — it proves WHICH rows the decision reads, never READ
COMMITTED interleaving/serialization. The concurrency property (two concurrent
effective-holder removals cannot both observe the same vanishing retainer) is
therefore unproven by every current gate and is explicitly part of this record's
evidence gate below.

**Scope extension (2026-08-26, EPIC-02 re-judge composition-gap fix):** both
administration flows now use one effective-holdership stranding predicate
(`apps/api/src/rbac/manage-holdership.ts`) across the tenant override and
membership-assignment paths, and append their audit rows INSIDE the same
transaction. Until live PostgreSQL evidence exists, two properties remain
unproven by every current gate:

1. effective-holder lock interleavings: concurrent override or assignment
   transactions could expose behavior that the in-memory fake cannot model;
2. transactional rollback/audit atomicity: the fake's `$transaction` executes
   against the same in-memory maps with NO rollback, so a rejected post-write
   check (or other failure) is not proven to roll back BOTH the mutation and its
   audit row, leaving neither behind.

Both limits are explicitly named in the evidence gate below.

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
`DATABASE_URL_TEST` with migrations applied, green — AND BOTH fake-unprovable
transactional properties proven live:

1. a concurrency proof that parallel effective-holder-removal transactions
   across BOTH override replacement and membership assignment serialize on the
   `FOR UPDATE` lock (exactly one succeeds where both would strand the tenant),
   since the in-memory fake cannot express interleaving;
2. an audit-in-transaction rollback proof: a rejected RBAC mutation (e.g., the
   composed stranding repro) leaves NEITHER the business write NOR its audit row
   behind, since the in-memory fake's `$transaction` never rolls anything back.

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
