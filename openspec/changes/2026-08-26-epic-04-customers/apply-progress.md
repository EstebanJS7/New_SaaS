# Apply Progress: EPIC-04 Customers C1-C4 corrections

**Date:** 2026-09-08 **Mode:** Standard (`strict_tdd: false`) **Active slice:**
C4 evidence documentation **Status:** C1/C2/C3/C4 verified against CI run
`34183380781`; only the 5.4 Playwright blocker remains

## Corrective batch: C1-C3 delivery-evidence fixes applied (2026-09-07)

A fresh review found five blockers in the C1-C3 evidence surface. Only the seven
candidate artifacts were modified; no unrelated feature code or docs were
changed. Live CI proof was later obtained in run `34183380781`.

## Corrective batch: C2 live-PG Fastify listener lifecycle correction (2026-09-07)

CI executed the live-PG suite and observed:

- Test 1 (create tenant A customer/address/contact) passed.
- Tests 2–4 (Customer, Address, Contact cross-tenant byte-equivalence) each
  failed with `ECONNREFUSED` after their first Supertest request path returned
  `404` successfully.

Root cause: the NestJS Fastify adapter does **not** bind the underlying HTTP
server to a port during `app.init()`. Supertest, when handed an unbound server
object, starts and stops an ephemeral listener around each request. With the
previous per-request `supertest(app.getHttpServer())` calls, the lifecycle of
that ephemeral listener raced the next request: the listener could be torn down
before the follow-up request connected, surfacing as `ECONNREFUSED`. Reusing a
single Supertest agent masked the symptom by keeping one listener open, but it
left the actual server lifecycle implicit and added unnecessary cookie-jar
state.

Fix: explicitly bind the Nest/Fastify application once in `beforeAll` with
`await app.listen(0, "127.0.0.1")`, capture the stable URL from
`await app.getUrl()`, and target that URL for every request. The shared
Supertest agent was removed because it only added cookie-jar state; each request
now carries its tenant cookie explicitly. Paired cross-tenant and missing-UUID
requests are built lazily inside arrow functions so they are not created eagerly
and cannot race the listener lifecycle. The server is closed in `afterAll` via
the existing `app.close()`.

| #   | File                                          | Change                                                                                                                                                                                                                                                                                                            |
| --- | --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `apps/api/test/live-pg-isolation.e2e-spec.ts` | Replaced the shared `supertest.agent` with `let serverUrl: string`. In `beforeAll`: `await app.listen(0, "127.0.0.1"); serverUrl = await app.getUrl();`. Every request now uses `supertest(serverUrl)` with an explicit `.set("Cookie", …)`. Cross-tenant/missing-UUID pairs are deferred through arrow builders. |

Focused verification performed (no local PostgreSQL available):

| Command                                | Exit | Result                                                                                          |
| -------------------------------------- | ---: | ----------------------------------------------------------------------------------------------- |
| `pnpm --filter @newsaas/api typecheck` |    0 | Live-PG isolation test compiles with the explicit listen/URL pattern and lazy request builders. |

## Verified CI evidence (2026-09-07)

GitHub Actions run
[`34183380781`](https://github.com/EstebanJS7/New_SaaS/actions/runs/34183380781)
for commit `853f13099cedcedf51b9e4c76126ed5f841efcca` succeeded:

| Job / Step                                 | Result | Notes                                                                                   |
| ------------------------------------------ | ------ | --------------------------------------------------------------------------------------- |
| Required quality job                       | PASS   | **500 tests passed, 5 skipped** (API subtotal 300 passed, 5 skipped); build 8/8         |
| Database migrations job                    | PASS   | Fresh migrations/seed, `pnpm db:live-verify`, API build, `pnpm test:live-pg` all passed |
| Live PostgreSQL application-path isolation | PASS   | 5/5 passed; C2 satisfied (EPIC-04 Customer/Address/Contact paths)                       |
| Cold API/web build/output verification     | PASS   | C3 satisfied                                                                            |

Task 7.2 (C2), task 8.1 (C3), and tasks 9.1/9.2 (C4) are now checked in
`tasks.md`. Only the 5.4 Playwright blocker remains unchecked.

| #   | Blocker                                                                                                                    | Fix                                                                                                                                                             | Artifact(s)                                                                                                                         |
| --- | -------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Live-PG suite resolved the database package from the wrong relative path (`../../packages/database` from `apps/api/test`). | Changed to `../../../packages/database` so `runDatabaseCommand` executes in `packages/database`.                                                                | `apps/api/test/live-pg-isolation.e2e-spec.ts`                                                                                       |
| 2   | `packages/database/scripts/live-migration-verify.ts` was a dead script with no package or CI invocation.                   | Added `db:live-verify` to `packages/database/package.json` and wired it as a `Live PostgreSQL migration verification` step in the `Database migrations` CI job. | `packages/database/package.json`, `packages/database/scripts/live-migration-verify.ts` (call path only), `.github/workflows/ci.yml` |
| 3   | EPIC-04 apply/verify evidence did not describe the current candidate and left C2/C3 in an ambiguous state.                 | Updated this file and `verify-report.md` with the correction summary; C2/C3 stay unchecked until CI executes.                                                   | `openspec/changes/2026-08-26-epic-04-customers/apply-progress.md`, `openspec/changes/2026-08-26-epic-04-customers/verify-report.md` |

Static inspection performed after the edits (no broad test/build/lint run):

| Command                                                                                  | Exit | Result                                              |
| ---------------------------------------------------------------------------------------- | ---: | --------------------------------------------------- |
| `pnpm --filter @newsaas/api typecheck`                                                   |    0 | API test and source changes compile.                |
| `pnpm --filter @newsaas/database exec tsc --noEmit ... scripts/live-migration-verify.ts` |    0 | Live-migration verifier script compiles standalone. |

The idempotent fixture fix was verified with a focused static check (no live
PostgreSQL available):

| Command                                | Exit | Result                                                            |
| -------------------------------------- | ---: | ----------------------------------------------------------------- |
| `pnpm --filter @newsaas/api typecheck` |    0 | Live-PG isolation test compiles with `upsert` fixture changes.    |
| `pnpm format-check`                    |    0 | All matched files pass Prettier, including the two OpenSpec docs. |

## Recovery: S1 Customer persistence artifacts restored (2026-09-01)

After the S1 scope separation removed the untracked EPIC-04 persistence
artifacts, the exact recovery sources from audit observation #1764 were applied:

| Restored path                                                                   | Source                                                                        | SHA-256                                                            |                                                                                                                           Lines |
| ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------: |
| `packages/database/prisma/migrations/20260826150100_customers/migration.sql`    | OpenCode record `prt_05fea29b6001F4LdbNIN42yLRX`                              | `ca418ba457cf6bc8fbd276811748c2cbc42090c036c409be664e18ea0bb2a83b` |                                                                                                                             109 |
| `packages/database/src/schema-branding-customers.test.ts`                       | OpenCode record `prt_05fea25c1001xCO0DFb06d6YIb`                              | `9f097c5f660f1cb58f74b15e2693a015805058fbfbad33075163b99bac1bf171` |                                                                                                                             107 |
| `packages/database/prisma/schema.prisma` Customer models/enums/Tenant relations | `/tmp/opencode/epic03-branding-slice-candidate.diff` (S1 separation evidence) | n/a — applied as delta                                             | +CustomerKind, +CustomerContactKind, +Customer, +CustomerAddress, +CustomerContact, +PatientGuardian, +4 Tenant relation fields |
| `packages/database/src/reference-seed.ts` Customer permissions/role matrix      | `/tmp/opencode/epic03-branding-slice-candidate.diff` (S1 separation evidence) | n/a — applied as delta                                             |                                                                              +6 `customers.*` permission seeds, +matrix entries |
| `packages/database/src/reference-seed.test.ts` Customer role-matrix test delta  | `/tmp/opencode/epic03-branding-slice-candidate.diff` (S1 separation evidence) | n/a — applied as delta                                             |                                                                     +customer baseline matrix assertion, permissions count 8→14 |

Focused verification performed:

- `sha256sum` confirmed the two OpenCode-restored files match the audit hashes.
- `DATABASE_URL=postgresql://localhost:5432/postgres pnpm --filter @newsaas/database exec prisma validate --schema=prisma/schema.prisma`
  reported **The schema at prisma/schema.prisma is valid 🚀**.

No `prisma generate`, broad test run, root gates, or CI execution was performed.
Existing EPIC-03 branding worktree changes were preserved.

## Completed

- [x] 7.1 Set the disposable test database as `DATABASE_URL` before `AppModule`
      compilation, restore the original value during teardown, and provide both
      `DATABASE_URL_TEST` and `DATABASE_URL` to the CI live-PG job.
- [x] 9.1 Reconcile EPIC-04 documentation with executed C1–C3 evidence and
      correct the tenant-creation method.
- [x] 9.2 Update the task artifact after C1–C4 pass, keeping 5.4 explicitly
      blocked.

## Pending Blockers

- [x] C4 — Reconcile EPIC-04 documentation with executed C1–C3 evidence.
- [ ] 5.4 — Playwright E2E coverage for Customer CRUD/navigation. **BLOCKED**:
      Playwright is not installed/configured in the repository; do not add
      dependencies or pretend it exists.

## C4 documentation reconciliation (2026-09-07)

Updated documentation to match the executed CI evidence in GitHub Actions run
[`34183380781`](https://github.com/EstebanJS7/New_SaaS/actions/runs/34183380781)
for commit `853f13099cedcedf51b9e4c76126ed5f841efcca`:

| #   | File                                                             | Change                                                                                                                                                                              |
| --- | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `docs/05-modules/Customers.md`                                   | Records that live-PG HTTP isolation is verified for EPIC-04 Customer/Address/Contact paths and describes fixture creation via `PrismaService`; removes EPIC-03/Branding/SSR claims. |
| 2   | `docs/09-releases/CHANGELOG.md`                                  | Replaces the "not yet automated" claim with the CI live-PG 5/5 result for EPIC-04 Customer isolation; removes EPIC-03 Phase B / Branding / SSR entries from this boundary.          |
| 3   | `docs/08-tech-debt/TD-006-live-pg-isolation-run.md`              | Marks EPIC-04 live-PG evidence automated/verified, corrects tenant-creation method, and removes EPIC-03/Branding/SSR claims from this C4 update.                                    |
| 4   | `openspec/changes/2026-08-26-epic-04-customers/tasks.md`         | Marks 9.1/9.2 complete, removes stale C2 evidence paragraphs, and reports the corrected workspace/API test counts.                                                                  |
| 5   | `openspec/changes/2026-08-26-epic-04-customers/verify-report.md` | Conforms to the supported verify-report contract, adds canonical CI output hashes, reports the corrected counts, and represents 5.4 as an explicit external blocker.                |

No code, CI, Branding docs, or unrelated files were changed.

## Evidence

| Command                                                                                    | Exit | Result                                                                                                                                                                 |
| ------------------------------------------------------------------------------------------ | ---: | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docker version --format '{{.Server.Version}}'`                                            |  127 | Docker is not installed in this WSL distro; the chained live-PG command did not run.                                                                                   |
| `command -v psql`                                                                          |    0 | `/usr/bin/psql` is installed.                                                                                                                                          |
| environment probe                                                                          |    0 | `DATABASE_URL_TEST` and `DATABASE_URL` are both unset.                                                                                                                 |
| `pnpm --filter @newsaas/api typecheck`                                                     |    0 | Test and CI changes compile.                                                                                                                                           |
| `pnpm --filter @newsaas/api test:live-pg`                                                  |    0 | Suite collected; five tests skipped because no PostgreSQL URL is configured.                                                                                           |
| `git diff --check -- .github/workflows/ci.yml apps/api/test/live-pg-isolation.e2e-spec.ts` |    0 | No whitespace errors.                                                                                                                                                  |
| `gh auth status`                                                                           |    0 | Authenticated GitHub CLI access for `EstebanJS7`.                                                                                                                      |
| `gh workflow list`                                                                         |    0 | `CI` is active (workflow ID `337182701`).                                                                                                                              |
| `gh run list --workflow ci.yml --limit 20 --json ...`                                      |    0 | Latest successful run is `32988995498` at pre-C2 SHA `d683e0af5b6affcd85f3ac1d96b800a540cd2156`.                                                                       |
| `gh run view 32988995498 --json url,conclusion,headSha,jobs`                               |    0 | [`Database migrations` job `98241831885`](https://github.com/EstebanJS7/New_SaaS/actions/runs/32988995498/job/98241831885) passed but has no live-PG build/test steps. |
| `gh workflow run CI`                                                                       |    1 | HTTP 422: `CI` has no `workflow_dispatch` trigger; no run was created.                                                                                                 |

## Corrective Slice Evidence

- Verify findings used: #1733 critical findings 5 and 6. The pre-existing
  datasource mismatch and absent byte-equivalence proof were not rediscovered
  beyond targeted test/CI inspection.
- Files read: `proposal.md`, both delta specs, `design.md`, `tasks.md`,
  `verify-report.md`, `openspec/config.yaml`,
  `apps/api/test/live-pg-isolation.e2e-spec.ts`, `.github/workflows/ci.yml`,
  `apps/api/package.json`, `apps/api/vitest.config.ts`, and the relevant
  Prisma/error-filter source through CodeGraph.
- Files changed: `apps/api/test/live-pg-isolation.e2e-spec.ts`,
  `.github/workflows/ci.yml`, and this change's OpenSpec artifacts. This
  continuation changed only `tasks.md` and `apply-progress.md`.
- Failed experiments: Docker availability probe; Docker is absent. No temporary
  configuration was retained. `gh workflow run CI` was rejected with HTTP 422
  because the workflow lacks `workflow_dispatch`; no remote run was created.
- Root gates: not run; C2 is blocked before live proof, and no final root-gate
  execution is warranted.
- Slice budget: below the 350-line C2 limit. The live-PG test was already
  untracked before C2, so Git cannot compute an exact patch-only baseline;
  implementation/test changes plus C2 evidence are bounded below the limit and
  pre-existing dirtiness is excluded.
- Scope expansions: None.
- Stop point: C2 stops at the live PostgreSQL CI execution prerequisite. GitHub
  CLI access is available, but the current-code workflow cannot be dispatched
  because it has no `workflow_dispatch` trigger, and publishing the dirty C2
  change through a commit, push, or PR is forbidden. C3 and C4 were not started.

## Smallest Safe Next Action

After a permitted publication or an explicitly approved minimal dispatch
mechanism, run the `Database migrations` job containing
`Live PostgreSQL application-path isolation evidence`, then retain the
`pnpm test:live-pg` result and canonical run/job URL as the only live HTTP
proof. If it fails, diagnose only the failing test/CI surface before rerunning
that job.
