```yaml
schema: gentle-ai.verify-result/v1
evidence_revision: sha256:9d4f40ed01a12db3cecdc2d66561c551a2d84f3bac6e1eaacbd7f0566fb048fa
verdict: fail
blockers: 1
critical_findings: 0
requirements: 13/13
scenarios: 19/19
test_command: "pnpm test"
test_exit_code: 0
test_output_hash: sha256:61fe33bc12b2d0d39945725b9fd84e2b62ea01046da643589e248fab09befb2e
build_command: "pnpm build"
build_exit_code: 0
build_output_hash: sha256:dcf8616a018752874d7ad8fd21d3d6b3e3d41216fa6b63c8f8b14ce9456b7cba
```

## Verification Report

**Change**: `2026-08-26-epic-04-customers`

**Date**: 2026-09-08

**Mode**: Standard (`strict_tdd: false`)

**Candidate**: current dirty worktree

**Verdict**: **FAIL** — blocked by the explicit external Playwright 5.4 blocker.

### Completeness

| Metric           |                Value |
| ---------------- | -------------------: |
| Requirements     |                   13 |
| Scenarios        |                   19 |
| Tasks total      |                   24 |
| Tasks complete   |                   23 |
| Tasks incomplete | 1 (`5.4` Playwright) |

### Corrective H1 Claims (EPIC-04 Customer scope only)

| Claim                                 | Result | Evidence                                                                                                                                                                                                                                                             |
| ------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tenant-scoped Customer writes         | PASS   | Customer/Address/Contact update and deactivate paths use `updateMany` with `id + tenantId` and `customerId` for children, verify `count`, and re-read with the same scope. Focused API tests passed 38/38.                                                           |
| Live PostgreSQL HTTP tenant isolation | PASS   | CI run `34183380781` at commit `853f13099cedcedf51b9e4c76126ed5f841efcca` reported the `Database migrations` job passed, including fresh migrations/seed, `pnpm db:live-verify`, API build, and `pnpm test:live-pg` with the live-PG suite 5/5 passed. C2 satisfied. |
| Fresh-build correctness               | PASS   | CI run `34183380781` reported the quality build as 8/8 passed and the cold API/web build/output verification succeeded. C3 satisfied.                                                                                                                                |

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
Archive readiness is blocked only by the unchecked Playwright E2E task 5.4; all
other required gates and evidence are satisfied by CI run `34183380781`.

### Command Evidence

The canonical current evidence is GitHub Actions run
[`34183380781`](https://github.com/EstebanJS7/New_SaaS/actions/runs/34183380781)
for commit `853f13099cedcedf51b9e4c76126ed5f841efcca`, which passed all required
quality, migration, live-PG, and build gates. The output hashes below are
SHA-256 digests of the raw `Test` and `Build` step logs (timestamp/job/step
prefixes removed) obtained with `gh run view --job 101926813780 --log`.

| Command      | Exit | Result                                                                         | Output SHA-256                                                            |
| ------------ | ---: | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| `pnpm test`  |    0 | Workspace total **500 passed, 5 skipped** (API subtotal 300 passed, 5 skipped) | `sha256:61fe33bc12b2d0d39945725b9fd84e2b62ea01046da643589e248fab09befb2e` |
| `pnpm build` |    0 | 8/8 tasks passed; postbuild output verification passed                         | `sha256:dcf8616a018752874d7ad8fd21d3d6b3e3d41216fa6b63c8f8b14ce9456b7cba` |

The `Database migrations` CI job also passed, including fresh migrations/seed,
`pnpm db:live-verify`, API build, and `pnpm --filter @newsaas/api test:live-pg`
with the live-PG suite 5/5 passed.

### Findings

#### CRITICAL

No critical code findings. All C1–C3 delivery-evidence corrections were verified
by GitHub Actions run
[`34183380781`](https://github.com/EstebanJS7/New_SaaS/actions/runs/34183380781)
for commit `853f13099cedcedf51b9e4c76126ed5f841efcca` (workspace quality 500
passed / 5 skipped; build 8/8; fresh migrations/seed; `pnpm db:live-verify`; API
build; live-PG 5/5; cold build/output verification).

#### BLOCKER

1. **Task 5.4 is incomplete.** Playwright is absent and Customer CRUD/navigation
   E2E remains unverified. This is an explicit external blocker: Playwright is
   not installed or configured in the repository, and the corrective scope
   forbids adding it. Per SDD verification rules, an unchecked implementation
   task blocks archive.

#### WARNING

1. **Documentation was temporarily inconsistent.** `Customers.md` and
   `CHANGELOG.md` previously claimed live PostgreSQL HTTP isolation was not
   automated, and TD-006 said tenants were created through HTTP. The C4
   documentation reconciliation corrected all three claims to match the executed
   CI evidence and the actual `PrismaService` fixture-creation method, and
   removed EPIC-03/Branding/SSR claims from the EPIC-04 Customer-only commit
   boundary.
2. **Fresh-build proof is complete.** CI run `34183380781` captured a cold
   API/web build with output verification; C3 satisfied.
3. **Review budget is substantially exceeded.** The dirty candidate spans at
   least 1,500 tracked changed lines plus many untracked files, contrary to the
   planned <=400-line review slices.

### Verdict

**FAIL** — blocked by the explicit external Playwright 5.4 blocker.
Tenant-scoped writes, fresh PostgreSQL migration evidence, live-PG HTTP
tenant-isolation byte-equivalence, and root quality/build gates are all verified
by CI run `34183380781`. EPIC-04 Customer documentation has been reconciled with
that evidence and stripped of EPIC-03/Branding/SSR claims. Archive readiness
remains blocked only by the unchecked Playwright E2E task 5.4.

## Post-review C1-C3 corrections (2026-09-07)

The following delivery-evidence corrections were applied in a focused batch.
They do not constitute a new verification run and do not claim live CI proof.

1. **Live-PG relative path fixed.**
   `apps/api/test/live-pg-isolation.e2e-spec.ts` now resolves the database
   package with `../../../packages/database`.
2. **Live-PG Fastify listener lifecycle corrected.** The harness now explicitly
   binds the Nest/Fastify application once in `beforeAll`
   (`await app.listen(0, "127.0.0.1")`), captures a stable URL
   (`await app.getUrl()`), and targets that URL with `supertest(serverUrl)` on
   every request. The shared Supertest agent was removed because it only added
   cookie-jar state; each request sets its tenant cookie explicitly. Paired
   cross-tenant and missing-UUID requests are built lazily through arrow
   functions so they cannot race the listener lifecycle.
3. **Dead migration verifier wired.** `packages/database/package.json` gained
   `db:live-verify: tsx scripts/live-migration-verify.ts`, and the
   `Database migrations` CI job now runs it after the seed-count probe.

**Verified items (2026-09-08):** GitHub Actions run
[`34183380781`](https://github.com/EstebanJS7/New_SaaS/actions/runs/34183380781)
for commit `853f13099cedcedf51b9e4c76126ed5f841efcca` succeeded:

- Required quality job: **500 tests passed, 5 skipped** (API subtotal 300
  passed, 5 skipped); build 8/8.
- Database migrations job: fresh migrations/seed, `pnpm db:live-verify`, API
  build, `pnpm test:live-pg` all passed.
- Live-PG suite: 5/5 passed; C2 satisfied.
- Cold API/web build/output verification succeeded; C3 satisfied.

**Remaining unverified items:** 5.4 (Playwright Customer CRUD/navigation E2E)
remains unchecked. Playwright is not installed/configured and must not be added
under this corrective scope.

## Post-C4 documentation reconciliation (2026-09-08)

The C4 slice reconciled EPIC-04 Customer documentation with the executed CI
evidence from GitHub Actions run
[`34183380781`](https://github.com/EstebanJS7/New_SaaS/actions/runs/34183380781)
for commit `853f13099cedcedf51b9e4c76126ed5f841efcca`:

- `docs/05-modules/Customers.md` now records that live application-path HTTP
  tenant isolation has been executed against PostgreSQL for
  Customer/Address/Contact paths and describes the fixture-creation method
  (tenants/users/memberships created directly through `PrismaService`). EPIC-03
  Branding/SSR claims were removed from the EPIC-04 Customer-only boundary.
- `docs/09-releases/CHANGELOG.md` now records the CI live-PG 5/5 result for
  EPIC-04 Customer isolation instead of claiming live HTTP isolation is not
  automated. EPIC-03 Phase B / Branding / SSR entries were removed from the
  EPIC-04 commit boundary.
- `docs/08-tech-debt/TD-006-live-pg-isolation-run.md` now records the EPIC-04
  live-PG isolation evidence as automated and verified, corrects the
  tenant-creation method, and removes EPIC-03/Branding/SSR claims from this
  corrective update.
- This report and `apply-progress.md` now conform to the supported verify-report
  contract, include the canonical CI `test_output_hash` and `build_output_hash`,
  report the workspace quality count as 500/5 with the API subtotal as 300/5,
  and represent 5.4 as an explicit external blocker rather than a critical code
  finding.

No code, CI, Branding docs, or unrelated files were changed during C4.
