```yaml
schema: gentle-ai.verify-result/v1
evidence_revision: sha256:c1d205be4bc607089c39865781c0872c14e37e8874b65c73d60eb507943d486c
verdict: fail
blockers: 7
critical_findings: 6
requirements: 13/13
scenarios: 19/19
test_command: "pnpm test"
test_exit_code: 1
test_output_hash: sha256:6f0e586b2f04d6c0e100c17931b42651c918d6dc2f4543cd871bf7c2831b201a
build_command: "pnpm build"
build_exit_code: 0
build_output_hash: sha256:2fcec01a5b7952abf3b87b93fda7140f3bed58df0a55b4f0e63b5e93d83d763a
```

## Verification Report

**Change**: `2026-08-26-epic-04-customers`  
**Date**: 2026-09-01  
**Mode**: Standard (`strict_tdd: false`)  
**Candidate**: current dirty worktree  
**Verdict**: **FAIL**

### Completeness

| Metric           |                Value |
| ---------------- | -------------------: |
| Requirements     |                   13 |
| Scenarios        |                   19 |
| Tasks total      |                   18 |
| Tasks complete   |                   17 |
| Tasks incomplete | 1 (`5.4` Playwright) |

### Corrective H1 Claims

| Claim                                 | Result           | Evidence                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tenant-scoped Customer writes         | PASS             | Customer/Address/Contact update and deactivate paths use `updateMany` with `id + tenantId` and `customerId` for children, verify `count`, and re-read with the same scope. Focused API tests passed 38/38.                                                                                                                |
| Audit rollback behavior               | PASS (in-memory) | Branding audit-failure test passed and the transaction-aware fake restores business and audit maps. No live-PostgreSQL audit-failure rollback test was executed.                                                                                                                                                          |
| SSR/preview behavior                  | PASS             | Integrated async layout, local-preference, and bounded preview tests passed within the 15/15 focused web run.                                                                                                                                                                                                             |
| Fresh-build correctness               | PARTIAL          | Root build and postbuild verifier passed, and a negative postbuild probe failed loudly as intended. The build started with `apps/web/.next` already present, so this run is not fresh/cold-cache evidence.                                                                                                                |
| Live PostgreSQL HTTP tenant isolation | FAIL / BLOCKED   | `test:live-pg` ran but skipped all 5 tests because no database URL/server was available. Static inspection also finds CI supplies only `DATABASE_URL_TEST`, while `PrismaService` consumes Prisma's `DATABASE_URL`; the test computes a disposable URL but never assigns it to `DATABASE_URL` before booting `AppModule`. |

### Spec Compliance Matrix

|   # | Scenario                            | Runtime evidence                    | Result    |
| --: | ----------------------------------- | ----------------------------------- | --------- |
|   1 | Create individual                   | `customers.service.test.ts`         | COMPLIANT |
|   2 | Company missing required fields     | `customers.integration.test.ts`     | COMPLIANT |
|   3 | Individual with tax id rejected     | `customers.integration.test.ts`     | COMPLIANT |
|   4 | Deactivate customer                 | customer service/integration tests  | COMPLIANT |
|   5 | Default list excludes inactive      | customer service/integration tests  | COMPLIANT |
|   6 | Add address                         | customer integration tests          | COMPLIANT |
|   7 | Cross-tenant address read           | customer integration tests          | COMPLIANT |
|   8 | Add contact                         | customer integration tests          | COMPLIANT |
|   9 | Scaffold inert                      | `schema-branding-customers.test.ts` | COMPLIANT |
|  10 | Create without permission           | customer integration tests          | COMPLIANT |
|  11 | Response leaks no internals         | customer service/integration tests  | COMPLIANT |
|  12 | Update audited                      | customer service/integration tests  | COMPLIANT |
|  13 | Cross-tenant customer read          | customer integration tests          | COMPLIANT |
|  14 | Demo populated                      | `demo-seed.test.ts`                 | COMPLIANT |
|  15 | Catalog contains customer keys      | `reference-seed.test.ts`            | COMPLIANT |
|  16 | Owner full access                   | `reference-seed.test.ts`            | COMPLIANT |
|  17 | Receptionist manage, not deactivate | `reference-seed.test.ts`            | COMPLIANT |
|  18 | Veterinarian read-only              | `reference-seed.test.ts`            | COMPLIANT |
|  19 | Cashier no customer access          | `reference-seed.test.ts`            | COMPLIANT |

**Compliance summary**: 19/19 scenarios have passing focused runtime coverage.
Archive readiness still fails on incomplete H1 work and failed required gates.

### Command Evidence

| Command                                                                                                                                                                                       |         Exit | Result                                                                                          | Output SHA-256                                                     |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -----------: | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `pnpm --dir apps/api exec vitest run --config vitest.config.ts src/customers/customers.service.test.ts src/customers/customers.integration.test.ts src/branding/branding.integration.test.ts` |            0 | 3 files, 38 tests passed                                                                        | `19bec12a96a3ec78848b82a5891f7316df3fa82db4b08da1db512f9fd7addd11` |
| `pnpm --dir apps/web exec vitest run --config vitest.config.ts ...`                                                                                                                           |            0 | 4 files, 15 tests passed                                                                        | `95ca7f44767bdb81454b45b0cf6c47db755c140378b2a28cf5e5fb7b4e30fb21` |
| `pnpm --dir packages/database exec vitest run src/schema-branding-customers.test.ts src/demo-seed.test.ts src/reference-seed.test.ts`                                                         |            0 | 3 files, 34 tests passed                                                                        | `1e45733782eb62b2d1ba2932260dfc8e8c496b73a99a5bb5de376e2e0e9eed85` |
| `DATABASE_URL=postgresql://... pnpm --dir packages/database exec prisma validate`                                                                                                             |            0 | Schema valid                                                                                    | `7f2ee637a172c9f21e083af25eeecdb6631842af8a69765775c9a87e51c00df9` |
| `pnpm lint`                                                                                                                                                                                   |            1 | Web lint rejects `scripts/verify-build-output.mjs`: not in parser project                       | `9fd5e5b922fbe2f226542760d8bbbf54d29ff8c9fa9ff391677e62cf0c2150ef` |
| `pnpm format-check`                                                                                                                                                                           |            1 | Five files unformatted, including EPIC-04 tasks and postbuild script                            | `d7226552bbac1cd5848e4927f61332e88607937c8ba9589e419f6a3bf8d75059` |
| `pnpm typecheck`                                                                                                                                                                              |            0 | 12/12 tasks passed                                                                              | `0de3eb3bcb5852371a3a2862a53a8492c8b2b8a20030ac3e706653993124350a` |
| `pnpm test`                                                                                                                                                                                   |            1 | All reported assertions passed; API ended with Vitest `onTaskUpdate` timeout; live-PG 5 skipped | `6f0e586b2f04d6c0e100c17931b42651c918d6dc2f4543cd871bf7c2831b201a` |
| `pnpm build`                                                                                                                                                                                  |            0 | 8/8 tasks passed; postbuild output verification passed                                          | `2fcec01a5b7952abf3b87b93fda7140f3bed58df0a55b4f0e63b5e93d83d763a` |
| `pnpm --filter @newsaas/api test:live-pg`                                                                                                                                                     |            0 | 1 file and 5 tests skipped; no live evidence                                                    | `b4c3ffc0a9c04e28c8f5055283dc5532ee8e8a3770ef9b8bbded22d474d14397` |
| `NEXT_DIST_DIR=/tmp/epic04-missing-build-output node scripts/verify-build-output.mjs`                                                                                                         | 1 (expected) | Negative probe correctly detects all missing artifacts                                          | `0a0b34e7026ae8d3fab26de2d8b5941ba6f9ff9639b10325e5a89ae179742a27` |

### Findings

#### CRITICAL

1. **Required lint gate fails.** The newly added `.mjs` postbuild verifier is
   included by `eslint .` but excluded from the configured TypeScript parser
   projects.
2. **Required format gate fails.** Five files fail Prettier, including
   `openspec/changes/2026-08-26-epic-04-customers/tasks.md` and
   `apps/web/scripts/verify-build-output.mjs`.
3. **Required root test gate still exits 1.** The prior Vitest worker IPC
   `onTaskUpdate` timeout reproduced after all reported assertions passed. This
   is a tooling/runner failure, not a failed customer assertion, but it remains
   a failed required gate.
4. **Task 5.4 is incomplete.** Playwright is absent and Customer CRUD/navigation
   E2E remains unverified. Per SDD verification rules, an unchecked
   implementation task blocks archive.
5. **Live-PG evidence is neither executed here nor correctly wired for CI.** The
   environment lacks PostgreSQL/Docker support, so runtime verification skipped.
   Independently, the CI/test datasource contract is inconsistent: CI sets
   `DATABASE_URL_TEST`; generated Prisma reads `DATABASE_URL`; the disposable
   database URL is never installed before `AppModule` boot.
6. **The corrective “byte-equivalent 404” claim is untested.** Live and
   in-memory tests assert status/code only; none compare a cross-tenant response
   body with a nonexistent-UUID response. Design D5 and task 5.1 explicitly
   require byte equivalence.

#### WARNING

1. **Documentation contradicts the candidate.** `Customers.md` and
   `CHANGELOG.md` say live PostgreSQL HTTP isolation is not automated, while
   tasks, TD-006, CI, and the new test say it is implemented. TD-006 also says
   tenants are created through HTTP, but the test creates them directly through
   Prisma.
2. **Fresh-build proof is incomplete.** The build passed from an existing
   `.next` directory; the negative verifier probe validates fail-loud behavior
   but does not prove cold-cache generation.
3. **Audit rollback evidence is fake-backed only.** The corrected in-memory
   transaction rollback test is meaningful and passed, but no live PostgreSQL
   audit-failure rollback scenario ran.
4. **Review budget is substantially exceeded.** The dirty candidate spans at
   least 1,500 tracked changed lines plus many untracked files, contrary to the
   planned <=400-line review slices.

#### SUGGESTION

1. Make the live-PG harness set and restore `process.env.DATABASE_URL` to the
   disposable database before compiling `AppModule`, then compare complete
   normalized error envelopes against a missing UUID.
2. Add a reproducible clean-output build command or CI step that
   removes/isolates `.next` before `next build`, while retaining the postbuild
   manifest verifier.

### Verdict

**FAIL — FIXES REQUIRED.** Tenant-scoped writes, in-memory audit rollback,
SSR/preview behavior, and a warm production build are improved and focused tests
pass, but required lint/format/test gates fail, Playwright remains incomplete,
live-PG evidence is blocked and statically miswired, byte-equivalent 404 is not
actually asserted, and documentation is contradictory.

## Post-review C1-C3 corrections (2026-09-07)

The following delivery-evidence corrections were applied in a focused batch.
They do not constitute a new verification run and do not claim live CI proof.

1. **Live-PG relative path fixed.** `apps/api/test/live-pg-isolation.e2e-spec.ts`
   now resolves the database package with `../../../packages/database`.
2. **Branding assertion corrected.** The invalid cross-tenant `404` expectation
   for Tenant B on `/branding/current` was replaced with a tenant-relative
   success assertion: Tenant B mutates its own branding, Tenant A's branding
   remains unchanged. `tenantBId` tracking was added.
3. **Dead migration verifier wired.** `packages/database/package.json` gained
   `db:live-verify: tsx scripts/live-migration-verify.ts`, and the
   `Database migrations` CI job now runs it after the seed-count probe.
4. **Evidence documents updated.** This report and `apply-progress.md` now
   describe the corrected candidate.

**Remaining unverified items:** C2 (live-PG HTTP byte-equivalence execution) and
C3 (cold build evidence) remain unchecked until CI executes them. No live CI
run was performed during this correction batch.
