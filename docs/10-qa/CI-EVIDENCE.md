---
type: qa
status: active
updated: 2026-09-13
---

# CI Evidence

Canonical quality, migration, and live-PostgreSQL evidence for the EPIC-02,
EPIC-03, and EPIC-04 closure reconciliation. This file records the immutable CI
baseline only. It is **not** a production-readiness statement: epic status
transitions and archive moves are gated on criterion-to-evidence maps plus the
open/accepted debt below, and are recorded under the
`2026-09-11-epic-02-04-closure-reconciliation` change.

This is a rolling record. One immutable baseline is appended per closure; the
EPIC-02–04 baseline below is retained verbatim and the EPIC-06 baseline follows
it.

## Canonical baseline

| Field    | Value                                                           |
| -------- | --------------------------------------------------------------- |
| Workflow | `.github/workflows/ci.yml` (`CI`)                               |
| Run      | `34605178149`                                                   |
| SHA      | `c9cff6131b6036849d0899a5735e6a2a6a3be5fd` (`c9cff61`, `main`)  |
| Event    | `push`                                                          |
| Result   | `success`                                                       |
| Started  | `2026-09-11T13:35:28Z`                                          |
| Finished | `2026-09-11T13:38:13Z`                                          |
| URL      | https://github.com/EstebanJS7/New_SaaS/actions/runs/34605178149 |

Both jobs reported `success`:

| Job                            | Job ID         | Result    |
| ------------------------------ | -------------- | --------- |
| `Database migrations`          | `103281737093` | `success` |
| `Lint, Typecheck, Test, Build` | `103281736845` | `success` |

## Executed checks

### `Database migrations` (`103281737093`)

Fresh PG16 service container; both steps below ran against a clean database.

| Step                                                | Result                                                                                                                 |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Apply all migrations to a fresh database            | success                                                                                                                |
| Seed reference data twice with count-equality probe | success — identical counts: roles 6, permissions 14, featureCodes 12, plans 1, rolePermissions 39, planCapabilities 12 |
| Live PostgreSQL migration verification              | success (`pnpm db:live-verify` → `LIVE MIGRATION VERIFICATION PASSED`)                                                 |
| Build workspace packages for live-PG test           | success (`pnpm build --filter=@newsaas/api`, 5/5 tasks)                                                                |
| Live PostgreSQL application-path isolation evidence | success (`pnpm test:live-pg` → live-PG suite **6/6 passed**)                                                           |

### `Lint, Typecheck, Test, Build` (`103281736845`)

| Step         | Command             | Tasks | Result                       |
| ------------ | ------------------- | ----- | ---------------------------- |
| Lint         | `pnpm lint`         | 14/14 | success                      |
| Format check | `pnpm format-check` | —     | success                      |
| Typecheck    | `pnpm typecheck`    | 14/14 | success                      |
| Test         | `pnpm test`         | 15/15 | success (640 passed, 6 skip) |
| Build        | `pnpm build`        | 9/9   | success                      |

## Test totals

`pnpm test` ran 15 turbo tasks; 9 packages emitted a Vitest summary.

| Package / suite                       | Tests                   | Notes                                                                                         |
| ------------------------------------- | ----------------------- | --------------------------------------------------------------------------------------------- |
| `@newsaas/api`                        | 368 passed / 6 skip     | Skipped suite is `test/live-pg-isolation.e2e-spec.ts`, executed in the migrations job instead |
| `@newsaas/web`                        | 91 passed               |                                                                                               |
| `@newsaas/worker`                     | 37 passed               |                                                                                               |
| `@newsaas/database`                   | 85 passed               |                                                                                               |
| `@newsaas/ui`                         | 36 passed               |                                                                                               |
| `@newsaas/shared`                     | 16 passed               |                                                                                               |
| preflight                             | 6 passed                |                                                                                               |
| `typescript-config`                   | 1 passed                |                                                                                               |
| `@newsaas/storage`, `@newsaas/config` | 0                       | No test files yet; tasks still exit 0                                                         |
| **Total**                             | **640 passed / 6 skip** | Live-PG suite re-run green in the migrations job (6/6)                                        |

## Known warnings and open limitations

Recorded as limitations, not as resolved items.

| Item                                                                                                        | State    | Record                                              |
| ----------------------------------------------------------------------------------------------------------- | -------- | --------------------------------------------------- |
| `main` branch protection absent (`gh api .../branches/main/protection` → HTTP `404` "Branch not protected") | open     | [[TD-001 Branch protection]]                        |
| Tenant-settings concurrent partial write (read/merge/upsert loses disjoint fields)                          | open     | [[TD-010 Tenant-settings concurrent partial write]] |
| Batch 5 cross-tenant isolation, plus RBAC concurrency and audit-rollback, not run against live PG           | open     | [[TD-006 Live PG isolation run]]                    |
| Playwright E2E coverage for Branding settings and Customer CRUD/navigation                                  | accepted | [[TD-007 Playwright E2E deferred]]                  |
| Cross-tab appearance synchronization                                                                        | accepted | [[TD-008 Cross-tab appearance sync deferred]]       |
| Virus scanning and reset-cleanup dead-letter alerting/retention                                             | open     | [[TD-009 Branding scope deferred]]                  |

No open item above is treated as resolved by this baseline. `done` for
EPIC-02/03/04 means epic implementation closure only; EPIC-20 hardening and the
open debt remain.

## Maintainer closure authorization

On 2026-09-11 the maintainer authorized proceeding with **evidence-based
closure** of EPIC-02, EPIC-03, and EPIC-04 using run `34605178149` at `c9cff613`
as the immutable CI baseline, paired with criterion-to-evidence maps and the
preserved open/accepted debt records listed above.

This authorization covers epic implementation closure under the
`2026-09-11-epic-02-04-closure-reconciliation` change only. It is **not** a
production-readiness approval, a security sign-off, or authorization to
remediate the remaining debt. Archive moves stay gated on per-folder verify
records and their own dated authorization.

## Documentation review criteria

A reviewer can confirm this baseline without reconstructing the closure story:

- [ ] Run, SHA, event, and result match the canonical baseline table.
- [ ] Both CI jobs are `success` with the step names shown above.
- [ ] Test totals reconcile to 640 passed / 6 skipped.
- [ ] The branch-protection finding is recorded as TD-001 with the HTTP 404.
- [ ] Every open limitation cites a Tech Debt ID and is not presented as
      resolved.
- [ ] No statement claims production readiness; EPIC-20 and open debt are cited.
- [ ] The change touches only `docs/**` and `openspec/**` — no code, migration,
      PRD, or ADR.

## Merge-blocking policy (TD-001)

`.github/workflows/ci.yml` defines two required checks:

- `Database migrations` (job ID `migrations`)
- `Lint, Typecheck, Test, Build` (job ID `quality`)

Branch protection is a repository-admin setting and cannot be enabled from the
workflow file. On 2026-09-11 the read-only probe
`gh api repos/EstebanJS7/New_SaaS/branches/main/protection` returned **HTTP 404
`Branch not protected`**, confirming the default branch has no protection rule.
CI is therefore green but **not merge-blocking**; this is tracked as
[[TD-001 Branch protection]] and is not remediated by this closure.

## EPIC-06 Closure Baseline

Canonical quality, migration, and live-PostgreSQL evidence for the EPIC-06
(Clinical) closure reconciliation. This is the immutable post-merge `main`
baseline for the `2026-09-13-epic-06-closure-and-readme` change. It is **not** a
production-readiness statement: `done` for EPIC-06 and
[[VET-004 Clinical Encounter]] means epic implementation closure only, and
[[EPIC-20]] Production Hardening plus the open debt below remain.

### Canonical baseline

| Field    | Value                                                           |
| -------- | --------------------------------------------------------------- |
| Workflow | `.github/workflows/ci.yml` (`CI`)                               |
| Run      | `34793644348`                                                   |
| SHA      | `ff786138b359317b1afb1c33c2350bd605ff84ef` (`ff786138`, `main`) |
| Event    | `push`                                                          |
| Result   | `success`                                                       |
| Started  | `2026-09-14T00:44:33Z`                                          |
| Finished | `2026-09-14T00:47:43Z`                                          |
| URL      | https://github.com/EstebanJS7/New_SaaS/actions/runs/34793644348 |

Both jobs reported `success`:

| Job                            | Job ID         | Result    |
| ------------------------------ | -------------- | --------- |
| `Lint, Typecheck, Test, Build` | `103822468217` | `success` |
| `Database migrations`          | `103822468335` | `success` |

### Executed checks

#### `Lint, Typecheck, Test, Build` (`103822468217`)

| Step         | Command             | Tasks | Result  |
| ------------ | ------------------- | ----- | ------- |
| Lint         | `pnpm lint`         | 14/14 | success |
| Format check | `pnpm format-check` | —     | success |
| Typecheck    | `pnpm typecheck`    | 14/14 | success |
| Test         | `pnpm test`         | 15/15 | success |
| Build        | `pnpm build`        | 9/9   | success |

#### `Database migrations` (`103822468335`)

Fresh PG16 service container; migrations, reference seed, and the live-PG suite
all ran against a clean database.

| Step                                                | Result                                                                 |
| --------------------------------------------------- | ---------------------------------------------------------------------- |
| Apply all migrations to a fresh database            | success                                                                |
| Seed reference data twice with count-equality probe | success — identical counts across the two seed runs                    |
| Live PostgreSQL migration verification              | success (`pnpm db:live-verify` → `LIVE MIGRATION VERIFICATION PASSED`) |
| Build workspace packages for live-PG test           | success (`pnpm build --filter=@newsaas/api`)                           |
| Live PostgreSQL application-path isolation evidence | success (`pnpm test:live-pg` → live-PG suite **24/24 passed**)         |

This run is the first CI observation of the EPIC-06 clinical live-PG block green
on a pushed commit; see [[TD-006 Live PG isolation run]].

### Criterion-to-evidence source

Every EPIC-06 acceptance criterion maps to the archived EPIC-06 verification
report at
`openspec/changes/archive/2026-09-13-2026-09-11-epic-06-clinical/verify-report.md`:
verdict `pass_with_warnings`, 0 blockers, 10/10 requirements, 16/16 scenarios,
19/19 tasks. The run above is the immutable post-merge CI baseline for that map.

### Known warnings and open limitations

Recorded as limitations, not as resolved items.

| Item                                                                                                           | State   | Record                                               |
| -------------------------------------------------------------------------------------------------------------- | ------- | ---------------------------------------------------- |
| `main` branch protection absent; CI is green but not merge-blocking                                            | open    | [[TD-001 Branch protection]]                         |
| Broader Batch 5 cross-tenant isolation plus RBAC concurrency and audit-rollback not yet run against live PG    | open    | [[TD-006 Live PG isolation run]]                     |
| Patient guardian primary-promotion race surfaces `500 INTERNAL` instead of `409 CONFLICT`                      | open    | [[TD-011 Patient primary concurrency error mapping]] |
| Five clinical subdomain no-delete triggers are pinned statically, not live-executed                            | warning | [[VET-004 Clinical Encounter]]                       |
| Design §10 product questions (minimal encounter field set; whether `close` requires non-empty `clientSummary`) | open    | [[VET-004 Clinical Encounter]]                       |

No open item above is treated as resolved by this baseline, and no code fix is
in scope for this closure.

### Maintainer closure authorization (2026-09-13)

On 2026-09-13 the maintainer authorized proceeding with **evidence-based
closure** of EPIC-06 using run `34793644348` at `ff786138` as the immutable CI
baseline, paired with the archived EPIC-06 verification report and the preserved
open/accepted debt and limitation records above.

This authorization covers epic implementation closure under the
`2026-09-13-epic-06-closure-and-readme` change only. It is **not** a
production-readiness approval, a security sign-off, or authorization to
remediate the remaining debt: TD-006 stays `open` for its broader gates and
TD-011 stays separate.
