# Tasks: EPIC-06 Comprehensive Clinical Records

Traceability: clinical-management spec requirements map to WU1 (data/seed), WU2
(lifecycle, audit, tenancy), WU3 (authorization/API), WU4 (workspace), and WU5
(verification/docs); design §§3-10 define the implementation seams.

## Review Workload Forecast

| Field                   | Value                       |
| ----------------------- | --------------------------- |
| Review budget           | 800 changed lines           |
| Estimated changed lines | 950-1,250 (likely >800)     |
| Delivery strategy       | ask-always                  |
| Suggested split         | WU1 → WU2 → WU3 → WU4 → WU5 |

Decision needed before apply: Yes Chained PRs recommended: Yes Chain strategy:
pending 400-line budget risk: High

## Work Units

| Unit | Scope and PR base guidance                                                                         | Focused test command                   | Runtime harness                   | Rollback boundary                                |
| ---- | -------------------------------------------------------------------------------------------------- | -------------------------------------- | --------------------------------- | ------------------------------------------------ |
| WU1  | Schema, migration, permissions, seeds; PR #1 base is the later-selected tracker/main base          | `pnpm test --filter @newsaas/database` | DB migration/test harness         | Revert code; retain additive clinical data       |
| WU2  | Clinical service lifecycle and audit; PR #2 base is WU1 branch if chained, otherwise selected base | `pnpm test --filter @newsaas/api`      | API fake-Prisma unit harness      | Remove module registration/routes only after WU3 |
| WU3  | Controllers, Zod, DTOs, route contract; PR #3 base is WU2 branch if chained                        | `pnpm test --filter @newsaas/api`      | API integration/probe harness     | Remove API exposure; keep immutable records      |
| WU4  | Staff proxy and patient workspace; PR #4 base is WU3 branch if chained                             | `pnpm test --filter @newsaas/web`      | RTL web harness                   | Remove clinical tab/proxy                        |
| WU5  | Live-PG evidence and documentation; PR #5 base is WU4 branch if chained                            | `pnpm test --filter @newsaas/api`      | Live PostgreSQL isolation harness | Revert verification/docs only                    |

## Phase 1: Data Foundation

- [x] 1.1 RED: add `packages/database/src/schema-clinical.test.ts` for six
      models, enum, RESTRICT FKs, indexes, Decimal weight, and
      CLOSED-update/DELETE trigger (spec Clinical subdomain records; design
      §§3,6).
- [x] 1.2 GREEN: update `packages/database/prisma/schema.prisma`; create
      additive `packages/database/prisma/migrations/<ts>_clinical/migration.sql`
      with the guarded immutability trigger.
- [x] 1.3 RED then GREEN: extend `reference-seed` and `demo-seed`
      tests/implementations for all clinical permissions, role matrix,
      idempotent synthetic no-PII encounter and record (spec Synthetic demo
      data; design §3).

## Phase 2: Clinical Domain

- [ ] 2.1 RED: create `apps/api/src/clinical/**/*.spec.ts` for version/stale
      409, CLOSED 409, one transactional audit, amendment
      reason/permission/idempotency, entitlement, and cross-tenant 404 before
      services (spec Lifecycle, Autosave, Amendments, Audit, Isolation).
- [ ] 2.2 GREEN: create `apps/api/src/clinical/**` services/module using request
      tenant context, conditional `updateMany`, AuditWriter transaction, and
      allowlisted DTO mapping; register in `apps/api/src/app.module.ts`.

## Phase 3: API Contracts

- [ ] 3.1 RED: add route/probe tests for all nested encounter and five subdomain
      routes, 403 permissions/entitlement, 400 invalid weight, 404 tenant
      misses, and no leaked `internalNotes` client projection (spec
      Authorization, Confidential API).
- [ ] 3.2 GREEN: add clinical controllers, Zod inputs, DTOs, permission
      declarations, and `apps/api/src/rbac/route-contract.probe.test.ts`
      inventory (design §4).

## Phase 4: Staff Workspace

- [ ] 4.1 RED: add RTL tests for loading, empty, error, success, denied,
      autosave conflict, close, amendment, and no client-safe `internalNotes`
      rendering (spec Staff workspace).
- [ ] 4.2 GREEN: create `apps/web/src/app/api/clinical/[[...path]]/route.ts` and
      `clinical-workspace.tsx`; mount it in `patient-detail.tsx` using semantic
      tokens and authenticated proxy only.

## Phase 5: Evidence and Documentation

- [ ] 5.1 RED then GREEN: extend `apps/api/test/live-pg-isolation.e2e-spec.ts`
      for byte-equivalent cross-tenant 404 and parallel autosaves yielding one
      409; threat matrix cases are N/A per design §8.
- [ ] 5.2 Run root gates, record migration/routes/tests and open questions in
      the change documentation; do not resolve design §10 scope questions
      without a decision.
