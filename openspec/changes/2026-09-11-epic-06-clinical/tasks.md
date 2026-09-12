# Tasks: EPIC-06 Comprehensive Clinical Records

Traceability: clinical-management spec requirements map to WU1 (data/seed), WU2A
(encounter lifecycle, audit, tenancy), WU2B (specialized records), WU3
(authorization/API), WU4 (workspace), and WU5 (verification/docs); design §§3-10
define the implementation seams.

## Review Workload Forecast

| Field                   | Value                                                                                                  |
| ----------------------- | ------------------------------------------------------------------------------------------------------ |
| Review budget           | 800 changed lines per slice                                                                            |
| Estimated changed lines | WU2A 768 impl / 1,392 incl. tests; WU2B 844 impl / 1,145 incl. tests (re-sliced, corrected 2026-09-12) |
| Delivery strategy       | force-chained (feature-branch-chain)                                                                   |
| Suggested split         | WU1 → WU2A → WU2B → WU3 → WU4 → WU5                                                                    |

Decision needed before apply: No Chained PRs recommended: Yes Chain strategy:
feature-branch-chain 400-line budget risk: High

Re-slice note (2026-09-12): the original WU2 ("Clinical Service Core") mixed the
encounter lifecycle with the five specialized record kinds in one 2,104-line
uncommitted slice. The maintainer rejected a `size:exception` and required a
split for maintainability and CI diagnosis; WU2 is therefore re-sliced into
**WU2A Encounter Core** and **WU2B Specialized Records** without changing
approved product scope.

Slice boundary (corrected 2026-09-12, review findings 1 and 4): **WU2A is the
current reviewable slice and is complete.** WU2B is **planned and uncommitted**
— its source/test files exist in the working tree but are OUT of the WU2A commit
boundary. The WU2A `clinical.module.ts` wires only `ClinicalService` and MUST
NOT reference WU2B's `ClinicalRecordsService`; WU2A typechecks, builds, and
tests independently with the WU2B files absent. A strict ≤800 total including
tests is infeasible without deleting tests or comments, which the workload guard
forbids; the measure is reported per part and WU2A's `size:exception` is
maintainer-approved.

## Work Units

| Unit | Scope and PR base guidance                                                                                                                                                                                                    | Focused test command                   | Runtime harness                   | Rollback boundary                                    |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- | --------------------------------- | ---------------------------------------------------- |
| WU1  | Schema, migration, permissions, seeds; base is the tracker/main base                                                                                                                                                          | `pnpm test --filter @newsaas/database` | DB migration/test harness         | Revert code; retain additive clinical data           |
| WU2A | Encounter core (`ClinicalServiceBase` + `ClinicalService`): create/list/get, versioned autosave, close, linked amendments, tenancy, entitlement/permissions, client-safe DTO, module registration, tests; base is WU1/tracker | `pnpm test --filter @newsaas/api`      | API fake-Prisma unit harness      | Remove module registration only after WU3            |
| WU2B | Specialized records (`ClinicalRecordsService`): treatments, vaccinations, deworming, studies, weights CRUD + tests; base is the WU2A branch                                                                                   | `pnpm test --filter @newsaas/api`      | API fake-Prisma unit harness      | Remove subdomain service/export; keep encounter core |
| WU3  | Controllers, Zod, DTOs, route contract; base is the WU2B branch                                                                                                                                                               | `pnpm test --filter @newsaas/api`      | API integration/probe harness     | Remove API exposure; keep immutable records          |
| WU4  | Staff proxy and patient workspace; base is the WU3 branch                                                                                                                                                                     | `pnpm test --filter @newsaas/web`      | RTL web harness                   | Remove clinical tab/proxy                            |
| WU5  | Live-PG evidence and documentation; base is the WU4 branch                                                                                                                                                                    | `pnpm test --filter @newsaas/api`      | Live PostgreSQL isolation harness | Revert verification/docs only                        |

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

## Phase 2A: Encounter Core (WU2A)

- [x] 2A.1 RED: create `apps/api/src/clinical/clinical.service.test.ts` (repo
      runner uses `*.test.ts`) for version/stale 409, CLOSED 409, one
      transactional audit, amendment reason/permission/idempotency, entitlement,
      cross-tenant 404, allowlisted projection and client-safe `internalNotes`
      exclusion before the service (spec Lifecycle, Autosave, Amendments, Audit,
      Isolation).
- [x] 2A.2 GREEN: create `apps/api/src/clinical/clinical.service.base.ts`
      (shared tenant/entitlement/permission/audit boundary),
      `clinical.service.ts` (encounter lifecycle with conditional
      `updateMany(status=DRAFT, version=N)`; concurrency-safe amendment:
      `SELECT ... FOR UPDATE` on the original inside the transaction, in-tx
      idempotency replay, and exact-target `P2002` unique-conflict recovery
      scoped to `clinical_encounter_tenant_id_idempotency_key_key`),
      `clinical.dto.ts` (encounter allowlist + `toClientSafeEncounter`) and
      `clinical.module.ts`; register `ClinicalModule` in
      `apps/api/src/app.module.ts`. `clinical.module.ts` provides/exports ONLY
      `ClinicalService` — it does not reference WU2B's `ClinicalRecordsService`.

## Phase 2B: Specialized Records (WU2B)

> **Planned and uncommitted (out of the WU2A boundary).** The source/test files
> below exist in the working tree but are NOT part of the WU2A commit; the WU2A
> `clinical.module.ts` does not wire `ClinicalRecordsService`.

- [ ] 2B.1 RED: create `apps/api/src/clinical/clinical.records.service.test.ts`
      covering the five subdomain record kinds, tenant-scoped
      create/list/update, exactly-one co-committed audit, and invalid-weight
      rejection (spec Clinical subdomain records, Transactional audit, Tenant
      isolation). Implemented in the working tree; pending the WU2B slice.
- [ ] 2B.2 GREEN: create `apps/api/src/clinical/clinical.records.service.ts`
      (`ClinicalRecordsService` extending `ClinicalServiceBase`) and
      `clinical.records.dto.ts` for treatment/vaccination/deworming/study/weight
      create/list/update; add the `ClinicalRecordsService` provider/export to
      `clinical.module.ts` without changing the WU2A encounter core. Implemented
      in the working tree; pending the WU2B slice.

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
