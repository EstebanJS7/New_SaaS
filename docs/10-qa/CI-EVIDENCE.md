---
type: qa
status: active
updated: 2026-09-21
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

## Current gate status (2026-09-21)

Branch protection is **enabled** on `main` with both required checks, so the
quality gate is now merge-blocking for ordinary merges. The rule was applied
through the authenticated GitHub API and read back immediately:

```text
gh api repos/EstebanJS7/New_SaaS/branches/main/protection
→ required_status_checks.contexts = ["Database migrations", "Lint, Typecheck, Test, Build"]
   required_status_checks.strict   = false
   required_pull_request_reviews   = null
   enforce_admins.enabled          = false
   allow_force_pushes.enabled      = false
   allow_deletions.enabled         = false
```

[[TD-001 Branch protection]] is `resolved` as of 2026-09-21. The residual gap is
stated there rather than hidden: `enforce_admins: false`, so an administrator
can still bypass the checks. The 2026-09-11 HTTP 404 finding recorded in the
baselines below was true when captured and is superseded by this status; those
baseline sections remain as historical records, not as current statements about
`main`.

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

| Item                                                                                                                                     | State               | Record                                              |
| ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------- | --------------------------------------------------- |
| `main` branch protection absent at this baseline (2026-09-11 probe → HTTP `404`); **resolved 2026-09-21** — both required checks enabled | resolved 2026-09-21 | [[TD-001 Branch protection]]                        |
| Tenant-settings concurrent partial write (read/merge/upsert loses disjoint fields)                                                       | open                | [[TD-010 Tenant-settings concurrent partial write]] |
| Batch 5 cross-tenant isolation, plus RBAC concurrency and audit-rollback, not run against live PG                                        | open                | [[TD-006 Live PG isolation run]]                    |
| Playwright E2E coverage for Branding settings and Customer CRUD/navigation                                                               | accepted            | [[TD-007 Playwright E2E deferred]]                  |
| Cross-tab appearance synchronization                                                                                                     | accepted            | [[TD-008 Cross-tab appearance sync deferred]]       |
| Virus scanning and reset-cleanup dead-letter alerting/retention                                                                          | open                | [[TD-009 Branding scope deferred]]                  |

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
`Branch not protected`**. That finding was **superseded on 2026-09-21**, when
the rule was applied and read back through the authenticated API (see "Current
gate status" above and [[TD-001 Branch protection]], now `resolved`): both
checks are required and the gate is merge-blocking for ordinary merges. The
residual gap is `enforce_admins: false` — an administrator can bypass the
checks.

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

| Item                                                                                                           | State    | Record                                               |
| -------------------------------------------------------------------------------------------------------------- | -------- | ---------------------------------------------------- |
| `main` branch protection absent at this baseline; **resolved 2026-09-21** — both required checks enabled       | resolved | [[TD-001 Branch protection]]                         |
| Broader Batch 5 cross-tenant isolation plus RBAC concurrency and audit-rollback not yet run against live PG    | open     | [[TD-006 Live PG isolation run]]                     |
| Patient guardian primary-promotion race surfaces `500 INTERNAL` instead of `409 CONFLICT`                      | open     | [[TD-011 Patient primary concurrency error mapping]] |
| Five clinical subdomain no-delete triggers are pinned statically, not live-executed                            | warning  | [[VET-004 Clinical Encounter]]                       |
| Design §10 product questions (minimal encounter field set; whether `close` requires non-empty `clientSummary`) | open     | [[VET-004 Clinical Encounter]]                       |

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

## EPIC-08 Closure Baseline

Canonical quality, migration, and live-PostgreSQL evidence for the EPIC-08
(Portal) closure. This is the post-merge `main` baseline at the merge of PR #53
(`feat/epic-08-wu5-live-pg-evidence`). It is **not** a production-readiness
statement: `done` for EPIC-08 and [[Portal]] means epic implementation closure
only, and [[EPIC-20]] Production Hardening plus the open debt below remain.

### Canonical baseline

| Field     | Value                                                          |
| --------- | -------------------------------------------------------------- |
| Workflow  | `.github/workflows/ci.yml` (`CI`)                              |
| SHA       | `27bc04ac2ca4f1724b8ba506e03d28dcbbd43c91` (`27bc04a`, `main`) |
| Reference | PR #53 (`feat/epic-08-wu5-live-pg-evidence`)                   |
| Event     | `push`                                                         |
| Result    | `success`                                                      |

The two required checks are the merge gate for the epic's chained PRs:

| Job                            | Required | Result    |
| ------------------------------ | -------- | --------- |
| `Database migrations`          | yes      | `success` |
| `Lint, Typecheck, Test, Build` | yes      | `success` |

### Executed checks

#### `Database migrations`

Fresh PG16 service container (a clean host); migrations, reference seed, and the
live-PG suite all ran against a clean database.

| Step                                                | Result                                                                 |
| --------------------------------------------------- | ---------------------------------------------------------------------- |
| Apply all migrations to a fresh database            | success                                                                |
| Seed reference data twice with count-equality probe | success — identical counts across the two seed runs                    |
| Live PostgreSQL migration verification              | success (`pnpm db:live-verify` → `LIVE MIGRATION VERIFICATION PASSED`) |
| Build workspace packages for live-PG test           | success (`pnpm build --filter=@newsaas/api`)                           |
| Live PostgreSQL application-path isolation evidence | success (`pnpm test:live-pg` → live-PG suite **40/40 passed**)         |

#### `Lint, Typecheck, Test, Build`

| Step         | Command             | Tasks | Result  |
| ------------ | ------------------- | ----- | ------- |
| Lint         | `pnpm lint`         | 14/14 | success |
| Format check | `pnpm format-check` | —     | success |
| Typecheck    | `pnpm typecheck`    | 14/14 | success |
| Test         | `pnpm test`         | 15/15 | success |
| Build        | `pnpm build`        | 9/9   | success |

### Live-PostgreSQL coverage added by EPIC-08

The live-PG suite grew to 40/40 and now covers the portal boundary as well as
the earlier domains:

- **EPIC-08 portal identity application-path isolation** — canonical login
  identity, the `portal` entitlement gate (403), the one-active-holder and
  one-active-email partial unique indexes, and session revocation rejecting
  replays with 401.
- **EPIC-08 WU5 portal write concurrency and isolation** (the deferred half of
  [[TD-006]]) — three genuine races, each forced behind a deterministic database
  barrier rather than hoped for:
  - two concurrent approvals of one PENDING request → both callers return the
    same winner appointment with no 500, exactly one `PORTAL` appointment, one
    audit row, request `APPROVED`;
  - two concurrent same-version reschedules → exactly one 200 and one 409, the
    stored row matching the winner with no lost update;
  - two concurrent holder cancels of one PENDING request → exactly one 200 and
    one 409, one audit row, request `CANCELLED`.
  - Isolation on the same database: a same-tenant other-Customer and a
    cross-tenant appointment are byte-equivalent `404` for both cancel and move,
    the foreign rows unchanged, and an appointment stops being actionable once
    its guardian link is revoked.

### Final local closure run (2026-09-21)

This is a **local run on the merged `main` at `c9959db`** (merge of PR #55,
`feat/epic-08-portal-profile-page`), **not** a CI run. It is recorded as the
epic's final gate evidence because it exercises the full root command set —
including the Next build and its post-build verification — on the commit that
carries the last acceptance item, the holder profile page. The CI baselines
above remain the immutable CI evidence, and CI's `Database migrations` job
remains the authority on the clean-host path.

| Command             | Exit | Result                                                                 |
| ------------------- | ---: | ---------------------------------------------------------------------- |
| `pnpm lint`         |    0 | 14/14 tasks                                                            |
| `pnpm format-check` |    0 | all matched files formatted                                            |
| `pnpm typecheck`    |    0 | 14/14 tasks                                                            |
| `pnpm test`         |    0 | 15/15 tasks                                                            |
| `pnpm build`        |    0 | 9/9 tasks, including the Next build and its post-build verification    |
| `pnpm services:up`  |    0 | starts the project's `newsaas-postgres` and `newsaas-redis` containers |
| `pnpm preflight`    |    0 | PostgreSQL and Redis reachable                                         |

Context for `services:up`: an earlier session could not run it because a
pre-existing container with the same name collided; that is resolved and the
command now starts the containers. `pnpm test` is the standard suite; the
live-PostgreSQL application-path suite is a separate target
(`pnpm test:live-pg`) that runs in CI's `Database migrations` job (40/40 above).

### Known warnings and open limitations

Recorded as limitations, not as resolved items.

| Item                                                                                                                                                | State    | Record                             |
| --------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ---------------------------------- |
| `main` branch protection enabled 2026-09-21 with both required checks (supersedes the 2026-09-11 HTTP 404 finding)                                  | resolved | [[TD-001 Branch protection]]       |
| Broader Batch 5 cross-tenant isolation plus RBAC concurrency and audit-rollback not yet run against live PG                                         | open     | [[TD-006 Live PG isolation run]]   |
| Portal contact details can be removed on request: `null` clears a field and the stored row is deactivated, never deleted (2026-09-22)               | resolved | [[Portal]]                         |
| Only the most recently updated active address is written; form `maxLength` is a convenience; `bookingRequiresApproval` unconsumed                   | open     | [[Portal]] / [[DEC-008]]           |
| Species and breed names resolve per pet without exposing the catalog, and `INTERNAL` 5xx messages are no longer echoed to clients (both 2026-09-22) | resolved | [[Portal]]                         |
| Playwright E2E coverage for the portal UI                                                                                                           | accepted | [[TD-007 Playwright E2E deferred]] |

No open item above is treated as resolved by this baseline, and no code fix is
in scope for this closure. Branch protection is no longer an open item: it was
enabled on 2026-09-21 with both required checks (see "Current gate status" above
and [[TD-001 Branch protection]], `resolved`), so the "required check" language
is backed by an enforced rule — with the recorded residual that
`enforce_admins: false` lets an administrator bypass it.

### Documentation review criteria

A reviewer can confirm this baseline without reconstructing the closure story:

- [ ] The baseline SHA is the merge of PR #53 on `main` (`27bc04a`).
- [ ] Both required checks are `success` and the live-PG suite is 40/40.
- [ ] The EPIC-08 WU5 portal write-race block is named as live-PG evidence.
- [ ] Every open limitation cites a Tech Debt ID or the module/decision record
      and is not presented as resolved.
- [ ] No statement claims production readiness; EPIC-20 and open debt are cited.
- [ ] Branch protection is presented as enabled with both required checks,
      consistent with the 2026-09-21 API response and TD-001 `resolved`.
