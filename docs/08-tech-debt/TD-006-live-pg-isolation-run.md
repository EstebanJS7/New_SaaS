---
id: TD-006
type: tech-debt
title: Run tenant-isolation suites against live PostgreSQL
status: open
severity: medium
related_epics:
  - EPIC-01
  - EPIC-04
related_stories:
  - DAT-004
created: 2026-08-24
updated: 2026-09-11
---

# TD-006 — Run tenant-isolation suites against live PostgreSQL

## Context

The EPIC-04 portion of the tenant-isolation evidence is executed in CI. The
`Database migrations` job provisions a PG16 service container, applies
migrations, seeds reference data, runs `pnpm db:live-verify`, builds the API,
and runs `apps/api/test/live-pg-isolation.e2e-spec.ts` via
`pnpm --filter @newsaas/api test:live-pg`. GitHub Actions run
[`34605178149`](https://github.com/EstebanJS7/New_SaaS/actions/runs/34605178149)
for commit `c9cff6131b6036849d0899a5735e6a2a6a3be5fd` reported that live-PG
suite as **6/6 passed**. The suite now covers the Customer/Address/Contact
mutation paths plus the tenant-relative authorized branding mutation and the
test-only branding reset cleanup producer injection added by commit `c9cff61`.

The Batch 5 cross-tenant isolation suites
(`apps/api/test/cross-tenant-isolation.e2e-spec.ts`) still execute over an
in-memory structural Prisma boundary (`apps/api/test/support/`) and are not run
against the PG16 service container. The fake faithfully mirrors the predicate
semantics the scoping depends on and TypeScript pins column names against the
generated client, but **no machine currently executes that broader suite's SQL
through a real PostgreSQL** inside any quality gate. The CI migrations job
proves DDL applies and the EPIC-04 application-path suite proves the
Customer/Address/Contact query paths; it does not prove the broader Batch 5
cross-tenant query-path behavior.

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

**2026-09-01 corrective H1 round (EPIC-04 Customer):**

- Customer/Address/Contact update and deactivate writes were corrected to use
  tenant-scoped `updateMany` with affected-count verification; the prior
  `findFirst` + bare `update({ where: { id } })` pattern was removed.
- The fresh web build was stabilized with a post-build output verification
  script that fails loudly if `pages-manifest.json` or other required artifacts
  are missing.
- Live PostgreSQL application-path isolation evidence is implemented in
  `apps/api/test/live-pg-isolation.e2e-spec.ts`. It boots the real `AppModule`
  with the real `PrismaService` against a disposable PostgreSQL database,
  applies migrations, seeds reference data, sets `process.env.DATABASE_URL` to
  the disposable database before `AppModule` compilation, creates the fixture
  tenants, users, and memberships directly through `PrismaService`, and uses
  Supertest over an explicitly bound NestJS/Fastify listener to prove that
  cross-tenant Customer/Address/Contact mutations return byte-equivalent
  `404 NOT_FOUND`. The CI migrations job now runs
  `pnpm --filter @newsaas/api test:live-pg` after the seed-count probe.

The EPIC-04 portion of this record is therefore addressed; the broader Batch 5
RBAC concurrency and RBAC audit-rollback evidence gates remain open and are
tracked under this same TD-006 until a future epic exercises those paths.

## Proposed Resolution

For the remaining Batch 5 cross-tenant isolation suites, extend the
`.github/workflows/ci.yml` migrations job: after `migrate deploy` + seed-count
probe, export `DATABASE_URL_TEST` and run the broader suite against the PG16
service container. The EPIC-04 application-path isolation evidence is already
automated and verified.

## Trigger / Target

Before the first business-domain epic lands additional tenant-scoped aggregates,
and mandatory before any production deployment.

## Verification After Resolution

- [x] CI migrations job runs the EPIC-04 live-PG isolation evidence
      (`pnpm --filter @newsaas/api test:live-pg`) against the PG16 service
      container. **Verified:** GitHub Actions run `34605178149` at commit
      `c9cff6131b6036849d0899a5735e6a2a6a3be5fd` — live-PG suite 6/6 passed,
      including the Customer/Address/Contact mutation paths and the
      tenant-relative branding mutation.
- [ ] CI runs the broader cross-tenant isolation suite against live PG16 and
      stays green.
- [ ] A deliberately broken predicate fails that CI job (one-off proof).
- [ ] RBAC concurrency and audit-rollback evidence gates proven live.
- [ ] This record closed with a link to the enabling commit.
