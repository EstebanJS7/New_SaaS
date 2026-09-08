# Tasks: EPIC-04 — Customers (Core)

**Train**: S1–S4 are code-first feature-branch slices: no per-slice tests,
gates, docs, review, or ticking. H1 follows both epics; final DoD remains
mandatory.

## Review Workload Forecast

| Field                   | Value                        |
| ----------------------- | ---------------------------- |
| Estimated changed lines | 1,050–1,400; each slice ≤400 |
| 400-line budget risk    | High                         |
| Chained PRs recommended | Yes                          |
| Suggested split         | S1 → S2 → S3 → S4 → H1       |
| Delivery strategy       | ask-always                   |
| Chain strategy          | feature-branch-chain         |

Decision needed before apply: Yes Chained PRs recommended: Yes Chain strategy:
feature-branch-chain 400-line budget risk: High

### Suggested Work Units

| Unit | Goal               | Likely PR        | Focused test command | Runtime harness              | Rollback boundary |
| ---- | ------------------ | ---------------- | -------------------- | ---------------------------- | ----------------- |
| S1   | Persistence/seed   | #1; base=tracker | H1                   | N/A—code-first               | schema/seeds      |
| S2   | Customer API/audit | #2; base=S1      | H1                   | N/A—code-first               | customer API      |
| S3   | Child APIs/routes  | #3; base=S2      | H1                   | N/A—code-first               | child controllers |
| S4   | Web/nav/proxies    | #4; base=S3      | H1                   | N/A—code-first               | web/proxy/nav     |
| H1   | Harden/finalize    | #5; base=S4      | root gates           | live PG (Playwright blocked) | tests/docs        |

## Phase 1: S1 — Persistence, Authorization, Demo Seed

- [x] 1.1 Modify `packages/database/prisma/schema.prisma` with tenant-scoped
      Customer, Address, Contact, and inert `PatientGuardian` (`customerId`
      only).
- [x] 1.2 Create additive
      `packages/database/prisma/migrations/<ts>_customers/migration.sql` with
      four tables, indexes, and no Patient linkage.
- [x] 1.3 Update `packages/database/src/reference-seed.ts` with six
      `customers.*` permissions and the approved role matrix.
- [x] 1.4 Update `packages/database/src/demo-seed.ts` with synthetic
      individual/company Customers and linked children.

## Phase 2: S2 — Customer API and Audit

- [x] 2.1 Create `apps/api/src/customers/customer.zod.ts` and `customer.dto.ts`
      for CONFIDENTIAL allowlists and kind-field rejection.
- [x] 2.2 Create `customers.service.ts` using `requireTenantId()`, active list,
      idempotent deactivate, and co-committed ID-only audit per mutation.
- [x] 2.3 Create `customers.controller.ts` and `customers.module.ts`; enforce
      read/create/update/deactivate permissions and register the module in
      `apps/api/src/app.module.ts`.

## Phase 3: S3 — Address/Contact API and Route Surface

- [x] 3.1 Create `customer-address.dto.ts` and
      `customer-addresses.controller.ts` with tenant-scoped commands and
      `customers.address.manage`.
- [x] 3.2 Create `customer-contact.dto.ts` and `customer-contacts.controller.ts`
      with tenant-scoped commands and `customers.contact.manage`.
- [x] 3.3 Update `apps/api/src/rbac/route-contract.probe.test.ts` route
      inventory for the 11 approved customer routes.

## Phase 4: S4 — Web, Navigation, Proxies

- [x] 4.1 Create `apps/web/src/app/api/customers/**` route handlers for approved
      verbs, forwarding session cookie and `x-request-id` only.
- [x] 4.2 Create `apps/web/src/app/(app)/app/customers/**`
      list/detail/create/edit states with UX-only permissions and
      loading/empty/error states.
- [x] 4.3 Modify `apps/web/src/components/shell/nav-sidebar.tsx` with a semantic
      `/app/customers` destination.

## Phase 5: H1 — Consolidated Hardening After Both Epics

- [x] 5.1 Write RED/GREEN Vitest/Supertest coverage for validation, allowlists,
      idempotency, six permission gates, audit, routes, and cross-tenant 404
      byte-equivalence.
- [x] 5.2 Write RED/GREEN schema/seed coverage for migration, indexes, inert
      guardian imports, seed, and roles; obtain live-PG migration/isolation
      evidence.
- [x] 5.3 Run root gates; complete security review, CONFIDENTIAL log/audit
      inspection, and TD-006.
- [ ] 5.4 Playwright E2E coverage for Customer CRUD/navigation. **BLOCKED /
      ACCEPTED DEFERRAL**: Playwright is not installed/configured in the
      repository; do not add dependencies or pretend it exists. Deferral
      formalized in [[TD-007 Playwright E2E deferred]].

## Corrective H1 Slices (2026-09-01)

These unchecked slices supersede only the unverified H1 completion claims in the
prior section; they do not weaken the original requirements.

| Unit | Goal                             | Likely PR        | Limit | Evidence / rollback                                                              |
| ---- | -------------------------------- | ---------------- | ----- | -------------------------------------------------------------------------------- |
| C1   | Restore root quality gates       | #6; base=tracker | <=250 | `pnpm lint`, `pnpm format-check`, `pnpm test`; revert config/test-runner changes |
| C2   | Prove live-PG tenant isolation   | #7; base=C1      | <=350 | CI live-PG HTTP run; revert harness/CI/test only                                 |
| C3   | Prove cold build generation      | #8; base=C2      | <=160 | clean-output `pnpm build`; revert script/CI only                                 |
| C4   | Reconcile evidence documentation | #9; base=C3      | <=100 | documentation matches executed evidence; revert docs only                        |

### Phase 6: C1 — Root Quality Gates

- [x] 6.1 Update `apps/web/eslint.config.js` and
      `apps/web/scripts/verify-build-output.mjs` so the verifier is linted with
      a valid parser configuration; format every file reported by Prettier.
- [x] 6.2 Diagnose and fix the API Vitest `onTaskUpdate` timeout in its runner
      configuration or test teardown; `pnpm test` MUST exit zero, not merely
      report passing assertions.

### Phase 7: C2 — Live PostgreSQL HTTP Proof

- [x] 7.1 Update `apps/api/test/live-pg-isolation.e2e-spec.ts` to install the
      disposable URL as `DATABASE_URL` before `AppModule` boot and restore the
      prior environment afterwards; align `.github/workflows/ci.yml`
      accordingly.
- [x] 7.2 In that live-PG HTTP test, compare complete normalized error bodies
      for Customer, Address, and Contact cross-tenant UUIDs versus nonexistent
      UUIDs; require byte-equivalence and execute against CI PostgreSQL.
      **Verified:** CI run `34183380781` at `853f1309` — live-PG 5/5 passed.

**C2 evidence verified (2026-09-08):** GitHub Actions run
[`34183380781`](https://github.com/EstebanJS7/New_SaaS/actions/runs/34183380781)
for commit `853f13099cedcedf51b9e4c76126ed5f841efcca` succeeded. The required
quality job reported **500 tests passed, 5 skipped** (API subtotal 300 passed, 5
skipped). The `Database migrations` job executed fresh migrations/seed,
`pnpm db:live-verify`, API build, and `pnpm test:live-pg`; the live-PG suite
reported 5/5 passed. Task 7.2 and C2 are satisfied.

### Phase 8: C3 — Cold Build Evidence

- [x] 8.1 Add a reproducible isolated or removed `apps/web/.next` build path in
      the relevant package script/`.github/workflows/ci.yml`; retain the
      fail-loud output verifier and capture a successful cold `pnpm build` run.
      **Verified:** CI run `34183380781` at `853f1309` — cold build/output
      verification succeeded, build 8/8.

**C3 evidence verified (2026-09-08):** The same CI run
[`34183380781`](https://github.com/EstebanJS7/New_SaaS/actions/runs/34183380781)
succeeded the required quality job with **500 tests passed, 5 skipped** (API
subtotal 300 passed, 5 skipped), build 8/8, and cold API/web build/output
verification. Task 8.1 and C3 are satisfied.

### Phase 9: C4 — Evidence Documentation

- [x] 9.1 Reconcile `docs/05-modules/Customers.md`,
      `docs/09-releases/CHANGELOG.md`, and
      `docs/08-tech-debt/TD-006-live-pg-isolation-run.md` only with executed
      EPIC-04 Customer evidence; correct the tenant-creation method, remove
      contradictory automation claims, and strip EPIC-03/Branding/SSR claims
      from the EPIC-04 Customer-only commit boundary.
- [x] 9.2 Update this task artifact with command outcomes only after C1–C4 pass;
      keep 5.4 unchecked and explicitly blocked until Playwright is separately
      installed/configured under approved scope.

### C4 evidence (2026-09-08)

Documentation reconciled with executed CI evidence from GitHub Actions run
[`34183380781`](https://github.com/EstebanJS7/New_SaaS/actions/runs/34183380781)
for commit `853f13099cedcedf51b9e4c76126ed5f841efcca`:

- `docs/05-modules/Customers.md` updated to state that live application-path
  HTTP tenant isolation has been executed against PostgreSQL for EPIC-04
  Customer/Address/Contact paths and to describe the fixture-creation method
  (tenants/users/memberships created directly through `PrismaService`).
- `docs/09-releases/CHANGELOG.md` updated to record the executed CI live-PG
  evidence for EPIC-04 Customer isolation instead of claiming live HTTP
  isolation is not automated.
- `docs/08-tech-debt/TD-006-live-pg-isolation-run.md` updated to reflect that
  the EPIC-04 live-PG isolation evidence is now automated and verified, and to
  correct the tenant-creation method.
- `apply-progress.md` and `verify-report.md` updated to conform to the supported
  verify-report contract, include canonical CI output hashes, report the
  corrected workspace/API test counts, and show C4 complete with only the
  Playwright 5.4 blocker remaining.

**Persistent blocker:** 5.4 Playwright Customer CRUD/navigation E2E remains
unchecked. Playwright is not installed/configured; these corrective slices MUST
NOT add it, change scope, or represent it as verified.
