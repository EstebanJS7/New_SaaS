# Apply Progress: EPIC-07 — Staff Scheduling

Change: `epic-07` Artifact store: **hybrid (OpenSpec + Engram)**
(`sdd/epic-07/apply-progress`) Mode: **Standard** (`openspec/config.yaml`
`strict_tdd: false`; no strict-TDD module loaded). Delivery strategy:
**feature-branch-chain** (resolved by the orchestrator); WU1 is the first child
slice and its eventual base is the EPIC-07 feature/tracker branch. No commit,
push, or PR was performed.

Batches: **WU1 — Data/settings** (tasks 1.1–1.6) + the **WU1 corrective batch**;
**WU2 — Domain service** (2.1–2.6) + the WU2 formatting correction + the WU2
corrective batch (test-only); **WU3 — API/controller/route contract** (3.1–3.3);
**WU4 — Staff agenda UI/proxies/nav** (4.1–4.3) + WU4 corrective batches; **WU5
— Live-PG race/isolation evidence, preflight, docs** (5.1–5.3). Canonical files:
`openspec/changes/epic-07/{tasks.md,apply-progress.md}`.

## Completed Tasks (WU1 — Data/settings)

- [x] 1.1 `packages/database/prisma/schema.prisma`: added `AppointmentStatus`
      enum (7 states) and the `Appointment` model with tenant/branch/patient/
      professional-membership composite FKs, `version`, status default,
      tenant-ownership key and lookup indexes; added `@@unique([tenantId, id])`
      to `Branch` and `TenantMembership` plus back-relations on `Tenant`,
      `Branch`, `Patient` and `TenantMembership`.
- [x] 1.2
      `packages/database/prisma/migrations/20260915000001_scheduling/migration.sql`:
      additive DDL with the `appointment_status` enum, the `appointment` table,
      tenant-ownership unique keys declared before the composite FKs, RESTRICT
      FKs, four indexes, the `end_at > start_at` CHECK
      (`appointment_time_range_check`) over UTC `TIMESTAMPTZ(3)` columns, and
      the DELETE-rejecting trigger `appointment_no_delete_trigger`.
- [x] 1.3 `packages/database/src/scheduling.test.ts`: 20 schema/migration/seed
      tests pinning the enum, table, composite FKs and key-before-FK ordering,
      indexes, time-range CHECK, DELETE trigger, model inventory, the scheduling
      role matrix, and the synthetic demo appointment.
- [x] 1.4 `apps/api/src/settings/registry.ts`: registered the `scheduling`
      namespace (version 1, `conflictPolicy` default `REJECT`, empty
      `availability`/`blocks`, `scheduling.settings.manage`, no feature gate);
      `registry.test.ts` updated for the two v1 namespaces and the scheduling
      schema.
- [x] 1.5 `apps/api/src/settings/settings.controller.ts` and
      `apps/api/src/settings/tenant-settings.service.ts`: settings writes are
      now authenticated-only at the route layer, with the namespace-specific
      registry key enforced by the service; the audit row now carries a
      `changedFields` diff. `tenant-settings.service.test.ts` covers the
      registry-iterating denial and the scheduling positive path.
- [x] 1.6 `packages/database/src/reference-seed.ts`: added
      `scheduling.appointment.read`, `.transition` and
      `scheduling.settings.manage` and expanded the role matrix (OWNER/ADMIN all
      four; RECEPTIONIST read/manage/transition; VETERINARIAN read/transition).
      `packages/database/src/demo-seed.ts`: added `seedDemoScheduling`
      (synthetic Branch + VETERINARIAN membership + `SCHEDULED` appointment) and
      wired it into `packages/database/prisma/demo-seed.ts`.

## Files Changed — WU1

| File                                                                          | Action   | What Was Done                                                                                                                                                                |
| ----------------------------------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/database/prisma/schema.prisma`                                      | Modified | `AppointmentStatus` + `Appointment`; `Branch`/`TenantMembership` `@@unique([tenantId, id])`; back-relations on Tenant/Branch/Patient/TenantMembership.                       |
| `packages/database/prisma/migrations/20260915000001_scheduling/migration.sql` | Created  | Additive DDL: enum, table, 4 RESTRICT FKs (tenant + 3 composite tenant-ownership), 3 tenant-ownership unique keys (2 new), 4 indexes, range CHECK, DELETE-rejecting trigger. |
| `packages/database/src/scheduling.test.ts`                                    | Created  | 20 migration/schema/seed tests including key-before-FK ordering and the demo appointment transaction/convergence/failure paths.                                              |
| `packages/database/src/reference-seed.ts`                                     | Modified | Granular `scheduling.appointment.*` + `scheduling.settings.manage` catalog keys and role matrix.                                                                             |
| `packages/database/src/reference-seed.test.ts`                                | Modified | Updated the pinned `VETERINARIAN` array and permission volume (23 → 26).                                                                                                     |
| `packages/database/src/schema-clinical.test.ts`                               | Modified | Updated the `@@unique([tenantId, id])` inventory count (2 → 5) for the new tenant-ownership keys.                                                                            |
| `packages/database/src/demo-seed.ts`                                          | Modified | `seedDemoScheduling` + structural client contracts, fixed synthetic IDs, VETERINARIAN membership and appointment fixtures.                                                   |
| `packages/database/prisma/demo-seed.ts`                                       | Modified | Wired `seedDemoScheduling` into the guarded entrypoint and extended the run log.                                                                                             |
| `apps/api/src/settings/registry.ts`                                           | Modified | `scheduling` namespace definition + schemas + types; registry now `{ sales, scheduling }`.                                                                                   |
| `apps/api/src/settings/registry.test.ts`                                      | Modified | Two-namespace registry, scheduling defaults, no feature gate, schema accept/reject.                                                                                          |
| `apps/api/src/settings/tenant-settings.service.ts`                            | Modified | Audit metadata now includes the `changedFields` field diff.                                                                                                                  |
| `apps/api/src/settings/tenant-settings.service.test.ts`                       | Modified | Updated audit metadata expectations; added registry-iterating denial and scheduling positive-path tests.                                                                     |
| `apps/api/src/settings/settings.controller.ts`                                | Modified | `PUT /settings/:namespace` is authenticated-only; the registry key is enforced by the service (per-namespace key cannot be a static decorator).                              |

SDD artifact updated: `openspec/changes/epic-07/tasks.md` (1.1–1.6 marked
`[x]`); this `apply-progress.md`; Engram twins `sdd/epic-07/tasks` and
`sdd/epic-07/apply-progress`.

## Verification Evidence — WU1 (focused)

| Command                                                                                                                                                                                                                           | Result                                                                                                                 |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `pnpm --filter @newsaas/database test`                                                                                                                                                                                            | exit 0 — 11 files, **144 passed** (incl. `scheduling.test.ts` **20/20**)                                               |
| `pnpm --filter @newsaas/database build`                                                                                                                                                                                           | exit 0 — `prisma generate` + `tsc` + client copy                                                                       |
| `pnpm --filter @newsaas/database typecheck`                                                                                                                                                                                       | exit 0 — no errors                                                                                                     |
| `pnpm --filter @newsaas/database lint`                                                                                                                                                                                            | exit 0 — no errors                                                                                                     |
| `pnpm --filter @newsaas/api test`                                                                                                                                                                                                 | exit 0 — 52 files passed / 1 skipped, **482 passed / 24 skipped** (baseline API suite + new settings/scheduling cases) |
| `pnpm --filter @newsaas/api exec vitest run --config vitest.config.ts src/settings/tenant-settings.service.test.ts src/settings/registry.test.ts src/settings/settings.integration.test.ts src/rbac/route-contract.probe.test.ts` | exit 0 — 4 files, **43 passed**                                                                                        |
| `pnpm --filter @newsaas/api typecheck`                                                                                                                                                                                            | exit 0 — no errors                                                                                                     |
| `pnpm --filter @newsaas/api lint`                                                                                                                                                                                                 | exit 0 — no errors                                                                                                     |
| `pnpm exec prettier --check <13 changed files>`                                                                                                                                                                                   | exit 0 — all match Prettier style                                                                                      |

Note: `.prisma` and `.sql` have no inferred Prettier parser; they are excluded
from `prettier --check .` exactly like the existing migrations.

## Deviations from Design

- Design's settings file-change row reads "tx read + `changedFields` audit". The
  write path already read the current row inside the transaction; this batch
  added the `changedFields` diff to the audit metadata. `get()` remains a single
  `findUnique` outside a transaction because it has no multi-statement invariant
  to protect — no behavioral change to reads.
- The migration expresses the design's "UTC CHECK" as
  `appointment_time_range_check CHECK ("end_at" > "start_at")` on UTC
  `TIMESTAMPTZ(3)` columns; there is no separate UTC-literal constraint because
  `TIMESTAMPTZ` already normalizes to UTC.
- Design open question "Should VETERINARIAN also receive
  `scheduling.appointment.manage`?" remains unresolved; the implemented matrix
  follows the design decision table (VETERINARIAN read + transition only).

## Issues Found

- No live database is available through the project's default path in this
  environment (no Docker daemon / no running server): the WU1 batch did not
  execute the migration against real PostgreSQL. **Resolved by the WU1
  corrective batch**: a user-owned local PostgreSQL 16 cluster was used to apply
  every migration and prove the scheduling DDL behavior (see the Corrective
  Batch section). The concurrent-overlap race remains WU5 (tasks 5.1/5.2).
- The migration depends on `patient_tenant_id_id_key`, created by the earlier
  `20260912000001_clinical` migration; it is not recreated here.
- `@newsaas/database` is consumed by `apps/api` through its built `dist`. The
  package was rebuilt locally so the API picks up the new permission catalog;
  `dist/` is gitignored and is not part of the WU1 diff.
- `seedDemoScheduling` must run after `seedDemoPatients`; the guarded entrypoint
  now chains it after `seedDemoClinical`.

## Remaining Tasks

- [ ] 2.1–2.6 Domain service (WU2)
- [ ] 3.1–3.3 API/controller/route contract (WU3)
- [ ] 4.1–4.3 Staff agenda UI + proxies + nav (WU4)
- [ ] 5.1–5.3 Live-PG race/isolation evidence, preflight, docs (WU5)

## Workload / PR Boundary — WU1

- Mode: **chained PR slice** (`feature-branch-chain`), WU1 = first child slice;
  eventual base is the EPIC-07 feature/tracker branch. No commit/push/PR.
- Boundary: starts from the current `main`-based planning artefacts and ends
  with the persistence foundation, `scheduling` settings namespace,
  registry-driven settings write auth, permissions seed and demo fixtures.
  Explicitly OUT: WU2 service, WU3 controllers/routes, WU4 agenda web, WU5
  live-PG/docs.
- Rollback boundary: data/seeds (schema + migration + seeds + settings
  namespace) — reversible by restoring the prior build and removing the additive
  migration; no destructive rollback.
- **Measured size: 1,009 changed lines** (516 additions + 14 deletions on
  tracked files, plus 479 new-file lines) — **implementation/migration/seed ≈
  477 lines, tests ≈ 532 lines**. This exceeds the 800-line review budget for a
  single slice; the tests are not minified and no coverage was dropped.
- **Recommendation: `size:exception` for the WU1 slice, or a further
  `WU1a (persistence+settings)` / `WU1b (seeds+tests)` split** if the reviewer
  prefers to stay within 800. The honest measure is reported rather than hidden.

## Risks

- WU1 exceeds the 800-line review budget (1,009 changed lines); needs an
  accepted `size:exception` or a WU1a/WU1b split before commit/PR.
- Live-PG migration behavior is now proven (corrective batch): the range CHECK,
  the DELETE trigger and the composite cross-tenant FK rejection passed on a
  real PostgreSQL 16 cluster. The concurrent-overlap race, the committed
  `live-pg-isolation.e2e-spec.ts` harness and preflight remain WU5-owned.
- The `Appointment` model carries a `(tenantId, id)` key only to keep a future
  `ClinicalEncounter.appointmentId` linkage additive; no linkage is added now.
- `scheduling` has no feature code in the twelve MVP codes, so its settings
  writes are intentionally gated by `scheduling.settings.manage` only.

## Corrective Batch — WU1 Fresh-Review Fixes

A fresh-context adversarial review of WU1 raised three findings. This batch
resolves the in-scope ones without broader redesign, touches no unrelated task,
and performs no commit, push, branch creation or PR. The maintainer-approved
`size:exception` for WU1 remains active.

### Findings and resolution

1. **Inverted availability windows and blocks were accepted**
   (`apps/api/src/settings/registry.ts` lines 73–99). The availability window
   and the one-off block were bounded only per-field, so
   `endMinute <= startMinute` and `endsAt <= startsAt` passed validation.
   - Fixed with cross-field `superRefine` on
     `schedulingAvailabilityWindowSchema` and `schedulingBlockSchema`; the issue
     is reported on `endMinute` / `endsAt`.
   - Focused rejection tests in `registry.test.ts` cover equal and inverted
     edges for both element schemas plus inverted ranges nested in a full
     settings patch (each bound is individually valid, so only the cross-field
     rule can reject).
   - `tenant-settings.service.test.ts` proves the real write path (which uses
     `schema.partial()` + merge) rejects both inverted payloads with
     `VALIDATION_FAILED` and persists nothing.

2. **No live-PostgreSQL migration proof.** The review correctly observed the
   migration was only asserted textually.
   - Resolved live. This environment has no Docker daemon and no running server,
     but it ships the PostgreSQL 16 server binaries under
     `/usr/lib/postgresql/16/bin`; a throwaway cluster was created under
     `/tmp/opencode` and every migration was applied with
     `prisma migrate deploy`.
   - Behavioral proof passed 7/7: a valid tenant/branch/patient/membership
     appointment commits; `end_at = start_at` and `end_at < start_at` are
     rejected by `appointment_time_range_check` (SQLSTATE 23514); `DELETE` is
     rejected by `appointment_no_delete_trigger` (SQLSTATE 23001); cross-tenant
     patient, branch and professional membership are rejected by the composite
     `(tenant_id, …)` FKs (SQLSTATE 23503); the valid row persisted.
   - WU5 retains ownership of the durable race/preflight/docs tasks (5.1–5.3):
     the concurrent-overlap race, `services:up && preflight`, and the committed
     `live-pg-isolation.e2e-spec.ts` harness were NOT exercised here.

3. **Demo-seed idempotency proof was weak**
   (`packages/database/src/scheduling.test.ts`). The fake `createMany` ignored
   `skipDuplicates` and always overwrote its Map, so the "converges on rerun"
   test could not fail even if the seed omitted the option.
   - The fake now mirrors Prisma primary-key semantics: with `skipDuplicates`
     existing rows are dropped and only the inserted count is returned; without
     it a duplicate id is a rejected unique-constraint violation. Delegates
     return promises (no synchronous throw) so the rejection matches the real
     client and `@typescript-eslint/require-await` stays satisfied.
   - Added focused proof: the second seed run returns zero counts
     (`{ branches: 0, memberships: 0, appointments: 0 }`), and a direct delegate
     test shows a duplicate without `skipDuplicates` rejects while
     `skipDuplicates: true` resolves to `{ count: 0 }`.

### Live-PG evidence (throwaway cluster)

| Step        | Command / check                                                                                       | Result                                                                                  |
| ----------- | ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Cluster     | `initdb -D /tmp/opencode/pgdata-newsaas -U newsaas --auth=trust`; `pg_ctl start` on `127.0.0.1:55432` | server started, `pg_isready` accepting                                                  |
| Migrations  | `DATABASE_URL=postgresql://newsaas@127.0.0.1:55432/newsaas ./node_modules/.bin/prisma migrate deploy` | all 14 migrations applied, incl. `20260915000001_scheduling`                            |
| DDL catalog | `pg_constraint` / `pg_trigger` on `appointment`                                                       | `appointment_time_range_check`, 4 RESTRICT FKs, `appointment_no_delete_trigger` present |
| Behavior    | PL/pgSQL harness, 7 cases                                                                             | 7/7 PASS; valid appointment persisted                                                   |

The only blocker was environmental to the project's default `services:up` path
(no Docker daemon, no listening server); it was bypassed with a user-owned local
cluster. A durable, committed proof stays WU5-owned.

### Corrective slice budget

| File                                                    | Action   | Net lines                                        |
| ------------------------------------------------------- | -------- | ------------------------------------------------ |
| `apps/api/src/settings/registry.ts`                     | Modified | +24 (cross-field `superRefine` ×2 + doc)         |
| `apps/api/src/settings/registry.test.ts`                | Modified | +73 (3 focused rejection tests + schema imports) |
| `apps/api/src/settings/tenant-settings.service.test.ts` | Modified | +63 (2 write-path rejection tests)               |
| `packages/database/src/scheduling.test.ts`              | Modified | +98 (`skipDuplicates`-faithful fake + 3 tests)   |

Corrective net ≈ **258 lines**, almost entirely additive validation and tests;
deletions are limited to the replaced fake body. This is separate from the
pre-existing WU1 dirtiness (1,009 lines) and remains inside the approved
`size:exception`. Net lines measured against the pre-corrective file lengths
captured when this batch started (registry.ts 158, registry.test.ts 128,
tenant-settings.service.test.ts 394, scheduling.test.ts 379).

### Corrective verification gates

| Command                                        | Result                                                         |
| ---------------------------------------------- | -------------------------------------------------------------- |
| `pnpm --filter @newsaas/database test`         | exit 0 — 11 files, **146 passed** (`scheduling.test.ts` 22/22) |
| `pnpm --filter @newsaas/database typecheck`    | exit 0                                                         |
| `pnpm --filter @newsaas/database lint`         | exit 0                                                         |
| `pnpm --filter @newsaas/api test`              | exit 0 — 52 passed / 1 skipped, **487 passed / 24 skipped**    |
| `pnpm --filter @newsaas/api typecheck`         | exit 0                                                         |
| `pnpm --filter @newsaas/api lint`              | exit 0                                                         |
| `pnpm exec prettier --check <4 changed files>` | exit 0                                                         |

### Corrective stop point

Active WU1 review slice complete. WU2–WU5 not started; WU5 retains live-PG
race/preflight/docs ownership. No commit/push/branch/PR was performed.

---

## WU2 — Domain Service (tasks 2.1–2.6)

**Recovery note**: this section was persisted during a traceability-recovery
pass because the original WU2 return was empty and no WU2 progress had been
saved. WU2 source was confirmed on disk and re-verified against tasks 2.1–2.6
using focused tests only; no product source was modified during recovery.

### WU2 Completed Tasks

- [x] 2.1 Illegal/terminal transition RED tests in
      `appointment.service.test.ts`: an illegal edge (`SCHEDULED`→`complete`)
      and every command from a terminal `COMPLETED` appointment return 409 with
      the state and version unchanged and zero audit rows.
- [x] 2.2 `AppointmentService` implements `createAppointment`,
      `rescheduleAppointment` and six named transitions
      (`confirm/arrive/start/complete/cancel/no-show`) via the frozen
      `APPOINTMENT_TRANSITIONS` table; reschedule uses the `version` predicate
      and status predicate, transitions use the status predicate.
- [x] 2.3 Input/response contract tests. `appointment.dto.test.ts` (8) covers
      the zod 400-class rejections (equal/inverted range on `endAt`, non-UUID
      anchors, non-UTC offset timestamps, unknown fields under `.strict()`,
      positive integer reschedule version) and the CONFIDENTIAL allowlist (exact
      key set, no `serviceId`/`catalogItemId`/`internalNotes`, ISO-8601 UTC
      rendering).
- [x] 2.4 Tenant lookup (`assertTenantAnchors` → byte-equivalent 404 for a
      foreign Branch/Patient/membership; 400 `VALIDATION_FAILED` for an
      in-tenant non-VETERINARIAN membership), timezone-aware UTC/DST math
      (`Intl` + `TENANT_TIMEZONE="America/Asuncion"`, `toZonedParts`,
      `isWithinAvailability`, `intersectsBlock`), allowlisted DTO mapping
      (`toAppointmentResponse`), and **no events** (no dispatcher/emit call).
- [x] 2.5 REJECT/ALLOW/audit tests in `appointment.service.test.ts` plus the
      concurrent-overlap race probe added to `live-pg-isolation.e2e-spec.ts`.
- [x] 2.6 `pg_advisory_xact_lock(hashtextextended(tenantId:membershipId))` wraps
      the overlap check and insert under REJECT; every mutation appends exactly
      one `AuditWriter.append(input, tx)` row co-committed in the same
      transaction.

### Files Changed — WU2

| File                                                  | Action   | What Was Done                                                                                                                                                                                                                  |
| ----------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `apps/api/src/scheduling/appointment.permissions.ts`  | Created  | `SCHEDULING_PERMISSIONS` read/manage/transition keys.                                                                                                                                                                          |
| `apps/api/src/scheduling/appointment.dto.ts`          | Created  | DTO schema version, 7-state `AppointmentStatusDto`, allowlisted `toAppointmentResponse`, strict zod create/reschedule schemas (UTC-only, ordered range), agenda options response type.                                         |
| `apps/api/src/scheduling/appointment.service.ts`      | Created  | Tenant/permission/audit boundary, create/reschedule/six named transitions, read/list/options, anchor 404 + VETERINARIAN 400, availability/DST + block math, REJECT/ALLOW policy, advisory lock, co-committed audit, no events. |
| `apps/api/src/scheduling/appointment.dto.test.ts`     | Created  | 8 tests: 400-class schema rejection + CONFIDENTIAL allowlist.                                                                                                                                                                  |
| `apps/api/src/scheduling/appointment.service.test.ts` | Created  | 27 tests: transitions, tenant 404, non-VET 400, REJECT/ALLOW, availability/block, advisory lock, reschedule version/terminal, reads, time math.                                                                                |
| `apps/api/test/live-pg-isolation.e2e-spec.ts`         | Modified | +182 lines: imports and `EPIC-07 scheduling application-path concurrency` describe (deterministic advisory-lock race at the service boundary; skipped without a PG URL).                                                       |

### Verification Evidence — WU2 (focused)

| Command                                                                                                                                                  | Result                                                                                                                                                                                                                                     |
| -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm --filter @newsaas/api exec vitest run --config vitest.config.ts src/scheduling/appointment.service.test.ts src/scheduling/appointment.dto.test.ts` | exit 0 — 2 files, **35 passed** (service 27, dto 8)                                                                                                                                                                                        |
| `pnpm --filter @newsaas/api typecheck`                                                                                                                   | exit 0 — no errors                                                                                                                                                                                                                         |
| `pnpm --filter @newsaas/api lint`                                                                                                                        | exit 0 — no errors                                                                                                                                                                                                                         |
| `pnpm --filter @newsaas/api test` (prior session, before recovery; not re-run)                                                                           | 54 passed / 1 skipped, **522 passed / 25 skipped** (+35 WU2 tests, +1 skipped live-pg probe vs WU1 baseline 487/24)                                                                                                                        |
| `pnpm exec prettier --check <6 WU2 files>`                                                                                                               | Initially **FAIL on 3 files**: `appointment.service.ts`, `appointment.dto.ts`, `appointment.service.test.ts` — mechanical line-wrapping only. **Resolved** by the WU2 Formatting Correction section below (`prettier --check` now exit 0). |

### Deviations from Design

- Task 2.3 names `appointment.dto.test.ts` for "400/404/CONFIDENTIAL". The 400
  (zod schema) and CONFIDENTIAL (allowlist) tests are there; the **404**
  tenant-lookup coverage was placed in `appointment.service.test.ts`
  (cross-tenant Branch/Patient/membership + cross-tenant `getAppointment` mask)
  because a 404 requires the service fake. The behavior is covered; only the
  file placement differs from the literal task text.
- Added supporting service surface not enumerated in 2.1–2.6 but required by the
  design's WU3 routes and by the assigned read/permission tests:
  `getAppointment`, `listAppointments`, `listAppointmentOptions`, and the
  `appointment.permissions.ts` constants file.
- Availability windows are matched per `(membershipId, branchId)`; blocks are
  matched per `(membershipId, branchId)` too (registry block schema carries
  `branchId`). A `(professional, branch)` with no windows is unrestricted, per
  design.

### Issues Found

- ~~**`prettier --check` is red on 3 WU2 files.**~~ **Resolved** by the WU2
  Formatting Correction section below: `prettier --write` was applied to the 3
  files, the delta is mechanical (collapsing unions/argument lists that fit the
  print width), and `prettier --check` is now exit 0. No semantic change
  occurred. This unblocks the project `format-check` gate at verify.
- **Live-PG was not executed** (no `DATABASE_URL_TEST`/`DATABASE_URL`, no Docker
  daemon). The new race probe is `describe.skipIf`-guarded and shows as skipped.
  Durable execution remains WU5 task 5.1.
- The service is not yet registered in `AppModule` (no `SchedulingModule`); WU3
  owns module registration and the HTTP controller.

### Remaining Tasks

- [ ] 3.1–3.3 API/controller/route contract (WU3)
- [ ] 4.1–4.3 Staff agenda UI + proxies + nav (WU4)
- [ ] 5.1–5.3 Live-PG race/isolation evidence, preflight, docs (WU5)

### Workload / PR Boundary — WU2

- Mode: **chained PR slice** (`feature-branch-chain`), WU2 = second child; base
  is the EPIC-07 feature/tracker branch. No commit/push/PR.
- Boundary: starts after WU1's persistence/settings/seeds and ends with the
  scheduling domain service, its DTO/zod contract, permissions constants,
  focused unit tests, and the live-pg race probe. Explicitly OUT: WU3
  controllers/routes, WU4 agenda web, WU5 live-PG execution/docs.
- Rollback boundary: the `apps/api/src/scheduling/**` module plus the live-pg
  probe block (module boundary), independent of WU1 data/seeds.
- **Measured size: 1,903 changed lines** (1,721 new module lines + 182 live-pg
  additions) — approx. **882 implementation lines** (service + dto +
  permissions) and **1,021 test lines**. This exceeds the 400-line guideline and
  the 800-line slice budget; the tests are not minified and no coverage was
  dropped.
- **Recommendation: `size:exception` for the WU2 slice, or a
  `WU2a (service+dto)` / `WU2b (tests+probe)` split** if the reviewer wants to
  stay within budget. The honest measure is reported rather than hidden.

### WU2 Formatting Correction (mechanical)

A dedicated corrective pass applied **only** the exact Prettier corrections
needed to make the three WU2 files pass the project formatter. No
product/behavior change, no other file touched, and no commit/push/branch/PR.

| File                                                  | Change                                                | Hunks |
| ----------------------------------------------------- | ----------------------------------------------------- | ----- |
| `apps/api/src/scheduling/appointment.service.ts`      | Reflowed a union type and 2 call/throw argument lists | 3     |
| `apps/api/src/scheduling/appointment.dto.ts`          | Reflowed a union type and 1 function signature        | 2     |
| `apps/api/src/scheduling/appointment.service.test.ts` | Reflowed 5 call expressions                           | 5     |

**Semantic-safety evidence**: pristine before-copies were diffed byte-for-byte
against the formatted files. Every hunk is line-wrapping/whitespace only — union
members joined onto one line, argument lists collapsed to fit the print width,
call arguments re-wrapped. No identifier, literal, operator, import or statement
changed; no lines were added or removed. Prettier is AST-preserving and the diff
confirms it.

| Command                                                                                                                                                                    | Result                                                  |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `pnpm exec prettier --check apps/api/src/scheduling/appointment.service.ts apps/api/src/scheduling/appointment.dto.ts apps/api/src/scheduling/appointment.service.test.ts` | exit 0 — **All matched files use Prettier code style!** |

Per the corrective scope, only the focused formatter check was run afterward; no
broader test suite was re-executed (the three files were green in the WU2 batch
above, and this pass changes no tokens).

### WU2 stop point

Tasks 2.1–2.6 complete at the tested-behavior level. The Prettier formatting
item is now resolved (see the WU2 Formatting Correction section); the only
remaining WU2 open item is live-PG execution, which is WU5-owned (task 5.1).
WU3–WU5 not started. No commit/push/branch/PR was performed.

---

## WU2 Corrective Batch — Fresh-Review Fixes

A fresh-context adversarial review of WU2 raised two warnings, both in
`apps/api/src/scheduling/appointment.service.test.ts`. This batch resolves both.
It is **test-only**: no production source was modified, no contract changed, and
no commit, push, branch or PR was performed. The maintainer-approved
`size:exception` for WU2 remains active.

### Findings and resolution

1. **Audit co-commit was asserted structurally, not behaviorally.** The prior
   tests proved `AuditWriter.append(input, tx)` received the transaction handle,
   but never forced the append to fail, so "audit or nothing" was unproven.
   - Added three fail-closed rollback tests that make the co-commit auditable by
     rejecting the append _inside_ the transaction fake
     (`appendMock.mockRejectedValue`): `createAppointment`,
     `transitionAppointment`, and `rescheduleAppointment`.
   - The create test additionally proves the insert actually executed — the
     rejected audit call carries the generated appointment id — while the row is
     absent from the post-abort state, i.e. the write genuinely rolled back
     rather than never happening.
   - The implementation is correct; no production change was needed.

2. **The timezone test could not catch a wrong offset.** The old assertion
   accepted `expect([180, 240]).toContain(offsetMinutes)`, so a frozen UTC-3 or
   UTC-4 implementation would pass.
   - Tightened the 2026 conversion test to an exact wall-clock assertion
     (`09:00` local = `minuteOfDay 540`), which fails for a frozen UTC-4 offset.
   - Added an `America/Asuncion DST-boundary behavior` block with exact
     assertions across Paraguay's last two transitions (stable historical
     tzdata): spring-forward `2024-10-06T04:00Z` (UTC-4 → UTC-3, local
     00:00–00:59 skipped) and fall-back `2024-03-24T03:00Z` (UTC-3 → UTC-4,
     local 23:00–23:59 repeated), plus two availability-behavior cases that
     straddle / follow the gap. The UTC/DST implementation contract (`Intl` +
     `TENANT_TIMEZONE`) is unchanged.

### Discriminating-power evidence (one-variable experiment)

The new DST assertions were run against frozen-offset reimplementations of
`toZonedParts`/`isWithinAvailability` (real zone vs `Etc/GMT+3` = UTC-3 vs
`Etc/GMT+4` = UTC-4):

| Formatter          | spring gap | fall back | gap-straddle rejected | post-gap accepted |
| ------------------ | ---------- | --------- | --------------------- | ----------------- |
| `America/Asuncion` | pass       | pass      | pass                  | pass              |
| fixed UTC-3        | **fail**   | **fail**  | **fail**              | pass              |
| fixed UTC-4        | **fail**   | **fail**  | pass                  | **fail**          |

Every frozen offset fails at least one new assertion, so the warning's blind
spot is closed.

### Corrective slice budget

| File                                                  | Action   | Net lines                                                       |
| ----------------------------------------------------- | -------- | --------------------------------------------------------------- |
| `apps/api/src/scheduling/appointment.service.test.ts` | Modified | +148 (669 → 817); 7 new tests, 1 tightened assertion, test-only |

No production file changed. This is separate from the pre-existing WU2 dirtiness
(1,903 lines) and stays inside the approved `size:exception`.

### Corrective verification gates

| Command                                                                                                           | Result                                                                                |
| ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `pnpm --filter @newsaas/api exec vitest run --config vitest.config.ts src/scheduling/appointment.service.test.ts` | exit 0 — **34 passed** (was 27; +3 audit +4 DST)                                      |
| `pnpm --filter @newsaas/api test`                                                                                 | exit 0 — 54 passed / 1 skipped, **529 passed / 25 skipped** (WU2 baseline 522/25; +7) |
| `pnpm --filter @newsaas/api typecheck`                                                                            | exit 0                                                                                |
| `pnpm --filter @newsaas/api lint`                                                                                 | exit 0                                                                                |
| `pnpm exec prettier --check apps/api/src/scheduling/appointment.service.test.ts`                                  | exit 0                                                                                |

### Corrective stop point

Active WU2 review slice complete. WU3–WU5 not started; WU5 retains live-PG
race/preflight/docs ownership (5.1–5.3). No commit/push/branch/PR was performed.

---

## WU2 Corrective Batch — Reschedule Rollback `endAt` Assertion

A follow-up fresh review found one remaining test-coverage gap in the WU2 audit
rollback slice: the "rolls back a reschedule when the co-committed audit append
fails" test asserted the unchanged `version` and `startAt` but omitted `endAt`,
so a partial rollback that left `endAt` mutated could pass. This pass adds the
missing assertion. Test-only, single line; no production source change, no other
file touched, no commit/push/branch/PR. The maintainer-approved `size:exception`
remains active.

| File                                                  | Action   | Change                                                                                                                              |
| ----------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `apps/api/src/scheduling/appointment.service.test.ts` | Modified | Added `expect(harness.rows.get(seeded.id)?.endAt.toISOString()).toBe(END);` to the reschedule audit-failure rollback test (+1 line) |

### Corrective verification gates

| Command                                                                                 | Result                                                  |
| --------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `pnpm --filter @newsaas/api exec vitest run src/scheduling/appointment.service.test.ts` | exit 0 — **34 passed**                                  |
| `pnpm exec prettier --check apps/api/src/scheduling/appointment.service.test.ts`        | exit 0 — **All matched files use Prettier code style!** |

### Corrective stop point

Active WU2 review slice complete; the fresh-review finding is resolved. WU3–WU5
not started. No commit/push/branch/PR was performed.

---

## WU3 — API/Controller/Route Contract (tasks 3.1–3.3)

Third child slice of `feature-branch-chain` (base remains the EPIC-07
feature/tracker branch). Standard mode (`strict_tdd: false`). No commit, push,
branch or PR was performed, and no WU1/WU2 exception is inherited — WU3 was
implemented as an autonomous slice with its own verification.

### WU3 Completed Tasks

- [x] 3.1 `apps/api/src/scheduling/appointments.integration.test.ts` — Supertest
      over the REAL guard chain and service: 401 anonymous on all route tiers;
      403 per granular permission (read/manage/transition); 400 for malformed
      id, non-ordered range, body `tenantId` and non-VETERINARIAN professional;
      409 overlap under default `REJECT`; byte-equivalent cross-tenant 404 for
      Branch/Patient/membership anchors and a foreign appointment read; success,
      allowlist, audit/transition and reschedule/version paths.
- [x] 3.2 `apps/api/src/scheduling/appointments.controller.ts` — 11 routes:
      `GET/POST /appointments`, `GET /appointments/options`,
      `GET/PUT     /appointments/:id`, and the six named lifecycle commands
      (`confirm|arrive|start|complete|cancel|no-show`). Zod-validated
      params/body (strict, unknown keys rejected), allowlisted DTO responses,
      granular `@RequirePermissions` per route, no generic status route.
- [x] 3.3 `apps/api/src/scheduling/scheduling.module.ts` registered in
      `apps/api/src/app.module.ts`; route inventory + a pinned granular
      permission-by-route map added to
      `apps/api/src/rbac/route-contract.probe.test.ts` (11 scheduling routes,
      pinned against `SCHEDULING_PERMISSIONS`).

### Files Changed — WU3

| File                                                       | Action   | What Was Done                                                                                                                                                                                                  |
| ---------------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/api/src/scheduling/appointments.controller.ts`       | Created  | `@Controller("appointments")` HTTP boundary: 11 routes, zod params/bodies, allowlisted responses, granular permissions, six named transitions.                                                                 |
| `apps/api/src/scheduling/scheduling.module.ts`             | Created  | Module wiring (Context/RBAC/Audit/Settings); no entitlements import (scheduling has no feature code).                                                                                                          |
| `apps/api/src/scheduling/appointments.integration.test.ts` | Created  | 13 Supertest cases: 401/403/400/409, byte-equivalent cross-tenant 404/no-persistence, allowlist, audit and version-guard behaviour.                                                                            |
| `apps/api/test/support/scheduling-http-fixture.ts`         | Created  | Reuses the EPIC-05 tenants; grants `scheduling.*` keys, seeds a Branch, a `VETERINARIAN` membership and an in-tenant Patient per probing tenant.                                                               |
| `apps/api/src/app.module.ts`                               | Modified | +`SchedulingModule` import and registration.                                                                                                                                                                   |
| `apps/api/src/rbac/route-contract.probe.test.ts`           | Modified | +11 pinned routes and a `SCHEDULING_PERMISSION_BY_ROUTE` map + test.                                                                                                                                           |
| `apps/api/test/support/in-memory-database.ts`              | Modified | Added `branch`/`appointment` row types, delegates, tables and matcher; extended `$queryRaw` to accept the scheduling advisory lock; membership lookups now honor `role: { code }` filtering and `select.role`. |

### Verification Evidence — WU3 (focused)

| Command                                                                                                                                                      | Result                                                                                                            |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| `pnpm --filter @newsaas/api exec vitest run --config vitest.config.ts src/scheduling/appointments.integration.test.ts src/rbac/route-contract.probe.test.ts` | exit 0 — 2 files, **21 passed** (integration 13, probe 8)                                                         |
| `pnpm --filter @newsaas/api test`                                                                                                                            | exit 0 — 55 passed / 1 skipped, **543 passed / 25 skipped** (WU2 baseline 529/25; +13 integration +1 route probe) |
| `pnpm --filter @newsaas/api typecheck`                                                                                                                       | exit 0 — no errors                                                                                                |
| `pnpm --filter @newsaas/api lint`                                                                                                                            | exit 0 — no errors                                                                                                |
| `pnpm exec prettier --check <7 WU3 files>`                                                                                                                   | exit 0 — after a mechanical `prettier --write` pass on 4 files (line-wrapping only; no semantic change)           |

### Deviations from Design

- The design lists the underlying routes; WU3 realizes them as six EXPLICIT
  command handlers (`@Post(":id/confirm")` …) rather than a `:command`
  parameter, so each named command is pinned by name in the route inventory.
- The list filter schema reuses a controller-local runtime status tuple pinned
  with `satisfies readonly AppointmentStatusDto[]`; the DTO module is unchanged.
- `GET /appointments/options` is declared before `GET /appointments/:id` for
  readability (Fastify prefers static over parametric routes regardless).

### Issues Found

- The shared in-memory Prisma boundary did not model the `branch`/`appointment`
  delegates, role-code membership filtering, `select.role`, or the scheduling
  advisory-lock `$queryRaw`. All were added as additive, faithfully-typed test
  support so the REAL controller + service + guard chain run over HTTP without a
  live PostgreSQL. Transactional rollback of the new appointment table is NOT
  modelled beyond the base snapshot (WU2 unit tests prove audit-or-nothing;
  live-PG ownership stays WU5).
- Live-PG execution was not run (no `DATABASE_URL`/Docker daemon); the race
  probe remains `describe.skipIf`-guarded and skipped. WU5 retains 5.1–5.3.
- `scheduling` has no feature code, so the routes are gated by granular
  permissions only (no `FEATURE_NOT_ENTITLED` path), matching the design.

### Remaining Tasks

- [ ] 4.1–4.3 Staff agenda UI + proxies + nav (WU4)
- [ ] 5.1–5.3 Live-PG race/isolation evidence, preflight, docs (WU5)

### Workload / PR Boundary — WU3

- Mode: **chained PR slice** (`feature-branch-chain`), WU3 = third child; base
  is the EPIC-07 feature/tracker branch. No commit/push/PR; child diffs must
  never target `main` directly.
- Boundary: starts after WU2's domain service and ends with the HTTP
  controller/routes, module registration, route-contract pinning, the scheduling
  HTTP fixture and the integration suite. Explicitly OUT: WU4 agenda web, WU5
  live-PG/docs.
- Rollback boundary: the `appointments.controller.ts` + `scheduling.module.ts`
  registration (routes) plus the additive in-memory test support; independent of
  WU1/WU2 data and service code.
- **Measured size: ≈ 974 changed lines** — new files 686 (controller 169, module
  26, integration test 372, fixture 119), modified 288 (`route-contract.probe`
  +61, `app.module` +2, in-memory boundary +217/−8). Split: production + wiring
  ≈ 197 lines, tests/test-support/probe ≈ 777 lines. No minification, no dropped
  coverage.
- **Recommendation: `size:exception` for the WU3 slice, or a
  `WU3a (controller + module + wiring)` / `WU3b (integration + fixture + probe)`
  split** if the reviewer wants the production review under budget. The honest
  measure is reported rather than hidden; no exception is claimed by
  inheritance.

### WU3 stop point

Tasks 3.1–3.3 complete and verified. WU4–WU5 not started; WU5 retains live-PG
race/preflight/docs ownership (5.1–5.3). No commit/push/branch/PR was performed.

---

## WU4 — Staff Agenda UI/Proxies/Nav (tasks 4.1–4.3)

Fourth child slice of `feature-branch-chain` (base remains the EPIC-07
feature/tracker branch). Standard mode (`strict_tdd: false`). No commit, push,
branch or PR was performed, and no WU1/WU2/WU3 exception is inherited — WU4 is
implemented and verified as an autonomous slice.

### WU4 Completed Tasks

- [x] 4.1 `apps/web/src/app/(app)/app/agenda/agenda.test.tsx` — 8 UI cases:
      loading, empty, error, permission-denied (no data), branch-filter refetch,
      day/week/month/list view switching, version-carrying reschedule, and a
      named lifecycle command. Proxy coverage lives beside each proxy in
      `route.test.ts` (repo convention), not inside `agenda.test.tsx`.
- [x] 4.2 Agenda views and semantic-token states in
      `apps/web/src/app/(app)/app/agenda/**`: day/week time grid (working-hours
      window, absolutely positioned blocks from persisted UTC instants converted
      to the tenant wall clock), month grid, and list view; view switcher,
      previous/today/next navigation, branch/professional/status filters,
      time-range creation, drag-to-move, pointer resize, and explicit lifecycle
      commands. Every status/state consumes semantic tokens only.
- [x] 4.3 `apps/web/src/app/api/scheduling/[[...path]]/route.ts` (allowlisted
      GET/POST/PUT passthrough to `/appointments...`) and
      `apps/web/src/app/api/settings/[[...path]]/route.ts` (allowlisted GET/PUT
      passthrough to `/settings/scheduling`); `nav-sidebar.tsx` gains the
      authenticated `Agenda` link.

### Files Changed — WU4

| File                                                        | Action   | What Was Done                                                                                                                                                  |
| ----------------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/src/app/(app)/app/agenda/agenda-api.ts`           | Created  | Allowlisted Appointment/Options DTOs, filter query, create/reschedule/transition clients, `ApiRequestError`, denied/conflict classification, UX error mapping. |
| `apps/web/src/app/(app)/app/agenda/agenda-time.ts`          | Created  | Pure tenant-wall-clock helpers: `Intl`-based offset/DST math, calendar keys, week/month grids, local input round-trip, range formatting.                       |
| `apps/web/src/app/(app)/app/agenda/agenda-views.tsx`        | Created  | Day/week grid (drag-move + pointer resize), month grid (drag-move), list view, `StatusBadge`, semantic-token status classes.                                   |
| `apps/web/src/app/(app)/app/agenda/agenda.tsx`              | Created  | Agenda orchestration: view/anchor/filter state, React Query reads/mutations, create + manage forms, loading/empty/error/denied/success states.                 |
| `apps/web/src/app/(app)/app/agenda/page.tsx`                | Created  | Staff agenda route wrapped in the authenticated shell.                                                                                                         |
| `apps/web/src/app/(app)/app/agenda/agenda.test.tsx`         | Created  | 8 UI state/workflow tests.                                                                                                                                     |
| `apps/web/src/app/(app)/app/agenda/agenda-api.test.ts`      | Created  | 7 client contract tests (paths, filters, PUT body/version, 409, malformed id, UX copy, lifecycle edges).                                                       |
| `apps/web/src/app/(app)/app/agenda/agenda-time.test.ts`     | Created  | 8 pure time/calendar tests including DST round-trips.                                                                                                          |
| `apps/web/src/app/api/scheduling/[[...path]]/route.ts`      | Created  | Appointment proxy with an allowlisted route-shape security boundary, cookie/`x-request-id` allowlist, raw-stream body, upstream status/envelope preservation.  |
| `apps/web/src/app/api/scheduling/[[...path]]/route.test.ts` | Created  | 10 proxy tests (mapping, header allowlist, streaming, 400/404 rejections, envelope preservation).                                                              |
| `apps/web/src/app/api/settings/[[...path]]/route.ts`        | Created  | Typed-settings proxy allowlisting the `scheduling` namespace (GET/PUT).                                                                                        |
| `apps/web/src/app/api/settings/[[...path]]/route.test.ts`   | Created  | 7 proxy tests (mapping, header allowlist, PUT stream, namespace/traversal rejections, envelope).                                                               |
| `apps/web/src/components/shell/nav-sidebar.tsx`             | Modified | Added the `Agenda` (`/app/agenda`) destination.                                                                                                                |
| `apps/web/src/components/shell/nav-sidebar.test.tsx`        | Modified | Extended to three business links and six entries.                                                                                                              |

### Verification Evidence — WU4 (focused)

| Command                                                                                                                                                                                                                                                                                                                                                        | Result                                                                                                                           |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm --filter @newsaas/web exec vitest run --config vitest.config.ts "src/app/(app)/app/agenda/agenda.test.tsx" "src/app/(app)/app/agenda/agenda-time.test.ts" "src/app/(app)/app/agenda/agenda-api.test.ts" "src/app/api/scheduling/[[...path]]/route.test.ts" "src/app/api/settings/[[...path]]/route.test.ts" "src/components/shell/nav-sidebar.test.tsx"` | exit 0 — 6 files, **42 passed** (agenda 8, agenda-api 7, agenda-time 8, scheduling proxy 10, settings proxy 7, nav 2)            |
| `pnpm --filter @newsaas/web test`                                                                                                                                                                                                                                                                                                                              | exit 0 — 31 files, **215 passed**                                                                                                |
| `pnpm --filter @newsaas/web typecheck`                                                                                                                                                                                                                                                                                                                         | exit 0 — no errors                                                                                                               |
| `pnpm --filter @newsaas/web lint`                                                                                                                                                                                                                                                                                                                              | exit 0 — no errors                                                                                                               |
| `pnpm exec prettier --check <14 WU4 files>`                                                                                                                                                                                                                                                                                                                    | exit 0 — after a mechanical `prettier --write` on 7 files (line-wrapping only; no semantic change)                               |
| `pnpm --filter @newsaas/web build`                                                                                                                                                                                                                                                                                                                             | exit 0 — `/app/agenda`, `/api/scheduling/[[...path]]` and `/api/settings/[[...path]]` compiled; `verify-build-output.mjs` passed |

### Deviations from Design

- **~~No third-party calendar dependency.~~** **Superseded by the WU4 Corrective
  Batch below.** The original WU4 batch implemented the day/week/month/list
  views natively with React + Tailwind + semantic tokens under an orchestrator
  instruction that forbade third-party calendar dependencies. The user has since
  confirmed FullCalendar is required, so the corrective batch replaces the
  native day/week/month interactions with the approved FullCalendar React
  component and `apps/web/package.json` now carries the official packages. The
  accessible list view + Manage form remain native. This is the single
  deliberate deviation from the literal task/design text and follows the
  explicit batch instruction.
- **Proxy tests placement.** Task 4.1 names `agenda.test.tsx` for "UI/proxy
  tests"; proxy behavior is instead covered in each proxy's `route.test.ts`,
  matching the existing patients/clinical proxy convention (a Next route handler
  needs its own module mock scope). UI tests remain in `agenda.test.tsx`.
- **Reschedule interaction.** Drag-to-move and pointer resize call the same
  version-guarded `PUT /appointments/:id` as the accessible "Manage" panel; the
  panel is the deterministic, test-covered reschedule path. The panel carries
  the legal lifecycle commands computed from the pinned transition table
  (UX-only; the API re-validates).
- **No availability editor.** The `scheduling` settings proxy is created per
  task 4.3, but no availability/block editor UI is added: it is not in tasks
  4.1–4.3 and would expand approved scope. The proxy is ready infrastructure for
  a later work unit.
- **No patient/catalog labels.** The allowlisted DTO exposes only IDs, so agenda
  blocks/rows show time, status, branch name and a truncated professional id —
  no patient name and no service/Catalog field (per the spec's confidentiality
  rule).

### Issues Found

- `Intl`-based `datetime-local` conversion must resolve the offset twice for DST
  gaps/folds; implemented in `agenda-time.ts` and covered by round-trip tests on
  both sides of the DST regime. Day/week grids render a fixed 07:00–21:00
  working-window; appointments outside it remain visible in the list view.
- The web suite's pre-existing `layout.test.tsx` hydration warning
  (`<html> cannot be a child of <div>`) is unrelated to WU4 and does not fail.

### Remaining Tasks

- [ ] 5.1–5.3 Live-PG race/isolation evidence, preflight, docs (WU5)

### Workload / PR Boundary — WU4

- Mode: **chained PR slice** (`feature-branch-chain`), WU4 = fourth child; base
  is the EPIC-07 feature/tracker branch. No commit/push/PR; child diffs must
  never target `main` directly.
- Boundary: starts after WU3's HTTP surface and ends with the authenticated
  staff agenda, its API client/time helpers, both authenticated proxies and the
  shell nav entry. Explicitly OUT: WU5 live-PG execution/docs.
- Rollback boundary: the `agenda/**` UI + `api/{scheduling,settings}` proxies +
  the `nav-sidebar.tsx` Agenda link (UI/proxy), independent of WU1–WU3 data,
  service and routes.
- **Measured size: ≈ 2,840 changed lines** — new files 2,813 (`agenda.tsx` 579,
  `agenda-views.tsx` 410, `agenda-api.ts` 295, `agenda-time.ts` 258, `page.tsx`
  16, `agenda.test.tsx` 219, `agenda-api.test.ts` 152, `agenda-time.test.ts` 80,
  scheduling proxy 188 + test 276, settings proxy 141 + test 199) plus modified
  `nav-sidebar.tsx` (+6/−4) and `nav-sidebar.test.tsx` (+11/−6). Split:
  production ≈ 1,893 lines, tests ≈ 937 lines. No minification, no dropped
  coverage.
- **Recommendation: `size:exception` for the WU4 slice, or a
  `WU4a (agenda UI + client/time)` / `WU4b (proxies + nav + tests)` split** if
  the reviewer wants each PR under budget. WU4 does NOT inherit the WU1/WU2
  exception; the honest measure is reported rather than hidden.

### WU4 stop point

Tasks 4.1–4.3 complete and verified. WU5 not started; WU5 retains live-PG
race/preflight/docs ownership (5.1–5.3). No commit/push/branch/PR was performed.

---

## WU4 Corrective Batch — Reviewed Fixes (FullCalendar + boundary hardening)

A dedicated retry of the WU4 corrective batch. The prior corrective attempt had
left the reviewed fixes on disk but never persisted progress or completed the
verification gates; this pass re-verified every fix against the reviewed list,
ran the focused gates, applied only a mechanical Prettier pass to two test
files, and merged this section into the cumulative progress (no overwrite).
Standard mode (`strict_tdd: false`); no commit, push, branch or PR.

### Reviewed fixes and resolution

1. **Allowlisted scheduling query params were dropped by the proxy.**
   `apps/web/src/app/api/scheduling/[[...path]]/route.ts` resolves the upstream
   query through `resolveUpstreamQuery`, forwarding only `branchId`,
   `patientId`, `professionalMembershipId`, `status` and dropping everything
   else; values are re-emitted through `URLSearchParams` (percent-encoded) and
   the first value of a repeated key wins. Covered by `route.test.ts` ("forwards
   only the allowlisted query parameters and drops the rest", "percent-encodes a
   forwarded query value so it cannot reshape the upstream URL").
2. **Invalid / DST-gap local times could be silently coerced.** `agenda-time.ts`
   converts `YYYY-MM-DD` + local minutes through `Intl` (`zonedLocalToIso`): a
   nonexistent spring-forward gap throws (`Nonexistent local time …`), a
   fall-back fold resolves deterministically to the earlier instant, and
   `tryLocalInputToIso` maps either failure to `null` so the create and Manage
   forms reject with an accessible `role="alert"` instead of writing a wrong
   instant. Covered by `agenda-time.test.ts` (America/Asuncion spring-forward
   2024-10-06 and fall-back 2024-03-24 cases).
3. **Native calendar interactions replaced with FullCalendar React.**
   `apps/web/package.json` adds the official `@fullcalendar/react` with
   `@fullcalendar/core`, `@fullcalendar/daygrid`, `@fullcalendar/timegrid` and
   `@fullcalendar/interaction` (6.1.21, pinned) and `pnpm-lock.yaml` is updated.
   `agenda-views.tsx` renders `<FullCalendar>` (editable + selectable, tenant
   `timeZone`, 07:00–21:00 slot window) and `agenda-calendar.ts` holds the pure
   view/event/reschedule mapping. FullCalendar theming flows through its CSS
   variables resolved from the app's semantic tokens (no literal brand color).
   Covered by `agenda-calendar.test.ts` plus the `agenda.test.tsx` FullCalendar
   stub integration tests; `/app/agenda` compiles in `next build`.
4. **Optimistic-version 409 was not distinguished from an overlap 409.**
   `agenda.tsx` re-reads the appointment on any `CONFLICT`
   (`refreshOnVersionConflict` via `getAppointment`); when the stored `version`
   advanced it shows the `stale-version-alert` ("changed by another staff
   member") and refreshes the Manage form to the current values, otherwise the
   generic overlap/availability message stands. Covered by two `agenda.test.tsx`
   cases (stale-version distinct alert + unchanged-version overlap message).
5. **Only the staff session cookie crosses the proxy.** Both proxies read
   `cookies().get(STAFF_SESSION_COOKIE)` server-side and emit a single
   `cookie: ns_staff_session=<value>` header; the browser cookie jar and
   `authorization` are never serialized. The cookie name is centralized in
   `apps/web/src/lib/session-cookie.ts`. Multi-cookie coverage: each proxy test
   seeds a jar whose `toString()` contains `analytics`/`theme`, passes a browser
   `cookie` header, and asserts the forwarded headers are exactly
   `["cookie", "x-request-id"]`.
6. **Semantic tokens and the accessible Manage form retained.**
   `STATUS_CLASSES`, `CALENDAR_STYLE` and the shell components consume semantic
   CSS variables only; the List view (real `<button>` "Manage"), the
   version-carrying Manage form (labels + `role="alert"` validation) and the
   named lifecycle command buttons remain, and are exercised by
   `agenda.test.tsx`.

### Corrective slice budget (against the pre-corrective WU4 baselines)

| File                             | Pre-corrective → now | Net  |
| -------------------------------- | -------------------- | ---- |
| `agenda.tsx`                     | 579 → 652            | +73  |
| `agenda-views.tsx`               | 410 → 264            | −146 |
| `agenda-api.ts`                  | 295 → 300            | +5   |
| `agenda-time.ts`                 | 258 → 296            | +38  |
| `agenda.test.tsx`                | 219 → 423            | +204 |
| `agenda-time.test.ts`            | 80 → 112             | +32  |
| `agenda-calendar.ts`             | new                  | +63  |
| `agenda-calendar.test.ts`        | new                  | +78  |
| `session-cookie.ts`              | new                  | +10  |
| scheduling `route.ts`            | 188 → 231            | +43  |
| scheduling `route.test.ts`       | 276 → 318            | +42  |
| settings `route.ts`              | 141 → 147            | +6   |
| settings `route.test.ts`         | 199 → 206            | +7   |
| `apps/web/package.json`          | +5                   | +5   |
| `pnpm-lock.yaml`                 | +78 / −1             | +79  |
| `page.tsx`, `agenda-api.test.ts` | unchanged            | 0    |

Gross **≈ 831 changed lines** (684 additions + 147 deletions; production ≈ 384,
tests ≈ 363, deps/config ≈ 84). Pre-corrective WU4 dirtiness (≈ 2,840 lines) is
excluded. The corrective slice alone is over the 400-line guideline and over the
800-line slice budget; nothing was minified and no coverage was dropped —
**recommend `size:exception` for the WU4 corrective slice** (as WU4 itself also
recommends).

### Verification gates (focused)

| Command                                                    | Result                                                                                                                        |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `pnpm --filter @newsaas/web exec vitest run <7 WU4 files>` | exit 0 — 7 files, **59 passed**                                                                                               |
| `pnpm --filter @newsaas/web test`                          | exit 0 — 32 files, **232 passed**                                                                                             |
| `pnpm --filter @newsaas/web typecheck`                     | exit 0                                                                                                                        |
| `pnpm --filter @newsaas/web lint`                          | exit 0                                                                                                                        |
| `pnpm exec prettier --check <18 WU4 files>`                | 2 test files warned → mechanical `prettier --write` (AST-preserving) → exit 0                                                 |
| `pnpm --filter @newsaas/web build`                         | exit 0 — `/app/agenda`, `/api/scheduling/[[...path]]`, `/api/settings/[[...path]]` compiled; `verify-build-output.mjs` passed |

### Corrective stop point

Active WU4 review slice complete. WU5 not started; WU5 retains live-PG
race/preflight/docs ownership (5.1–5.3). No commit/push/branch/PR was performed.

---

## WU4 Corrective Batch — Clock-Component Validation (`localInputToIso`)

A focused review correction, executed as the sole corrective slice. Standard
mode (`strict_tdd: false`). No other functionality or file was modified, and no
commit, push, branch or PR was performed.

### Finding and resolution

- **Finding:** `localInputToIso` accepted clock components outside the valid
  `datetime-local` range. Its regex `^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$`
  captured any two digits, then delegated to `zonedLocalToIso`, whose `Date.UTC`
  construction silently rolls impossible components forward — `T24:00` became
  the next day at `00:00` and `T09:60` became `10:00`. Staff entering a
  malformed time would have a different instant persisted than the one typed.
- **Fix:** `apps/web/src/app/(app)/app/agenda/agenda-time.ts` now parses the
  hour and minute as numbers and throws `Invalid local datetime: <value>` when
  `hour > 23 || minute > 59`, before any `Date` arithmetic. The plain
  `zonedLocalToIso` contract is unchanged because its `minutes` bound
  (`0..1440`) is used internally for wall-clock arithmetic.
- **Caller impact:** both create and Manage forms consume the helper through
  `tryLocalInputToIso`, which maps the throw to `null`; the forms already reject
  `null` with an accessible `role="alert"`, so the fix surfaces the error
  instead of writing a normalized time. No UI change was required.

### Files Changed — corrective slice

| File                                                    | Action   | Change                                                                                          |
| ------------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------- |
| `apps/web/src/app/(app)/app/agenda/agenda-time.ts`      | Modified | Range guard (`hour > 23 \|\| minute > 59`) + explanatory comment (296 → 303, +7 net).           |
| `apps/web/src/app/(app)/app/agenda/agenda-time.test.ts` | Modified | 2 focused tests: out-of-range rejection (RED→GREEN) and inclusive 00:00/23:59 boundaries (+17). |

### Corrective slice budget

Gross **≈ 27 additions + 3 deletions = 30 changed lines** (source: +10/−3;
tests: +17/−0). Well inside the 400-line guideline; no minification and no
dropped coverage. Pre-existing WU4 dirtiness (≈ 2,840 lines) is excluded.

### Corrective verification gates

| Command                                                                                             | Result                                                            |
| --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `pnpm --filter @newsaas/web exec vitest run "src/app/(app)/app/agenda/agenda-time.test.ts"` (RED)   | exit 1 — new test failed (`T24:00` did not throw); bug reproduced |
| `pnpm --filter @newsaas/web exec vitest run "src/app/(app)/app/agenda/agenda-time.test.ts"` (GREEN) | exit 0 — 1 file, **14 passed**                                    |
| `pnpm exec prettier --check agenda-time.ts agenda-time.test.ts`                                     | exit 0 — All matched files use Prettier code style!               |

### Discriminating power

The new test fails against the pre-fix implementation
(`expected [Function] to throw an error` at `2026-09-14T24:00`) and passes after
the guard, proving it catches the normalization bug. The inclusive-boundary test
(`00:00`, `23:59`) guards against over-rejection; both round-trip through the
tenant wall clock.

### Corrective stop point

Active corrective slice complete. Only `agenda-time.ts` and
`agenda-time.test.ts` changed, plus this progress artifact and its Engram twin.
WU5 not started; WU5 retains live-PG race/preflight/docs ownership (5.1–5.3). No
commit/push/branch/PR was performed.

---

## WU5 — Live-PG Evidence, Preflight, Docs (tasks 5.1–5.3)

Final child slice of `feature-branch-chain` (base remains the EPIC-07
feature/tracker branch). Standard mode (`strict_tdd: false`). No commit, push,
branch or PR was performed, and no WU1–WU4 exception is inherited — WU5 was
implemented and verified as an autonomous slice. Loaded skills: `sdd-apply`,
`work-unit-commits`, `cognitive-doc-design`.

### WU5 Completed Tasks

- [x] 5.1 Ran `apps/api/test/live-pg-isolation.e2e-spec.ts` against real
      PostgreSQL 16: the EPIC-07 concurrent-overlap probe proved one REJECT
      overlap persists and the other returns `409 CONFLICT` (full suite 26/26
      after the key-scoped barrier correction below).
- [ ] 5.2 Run `pnpm services:up && pnpm preflight`; record evidence in
      `tasks.md`. **Open — Docker prerequisite unmet.** The preflight half
      passed (`pnpm preflight` → PostgreSQL/Redis reachable against
      locally-provisioned equivalents on the project `.env` ports), but the
      required `pnpm services:up` (`docker compose up -d`) half could **not**
      run: there is no Docker daemon in this environment. The compound task
      stays open until the Docker bring-up is verified; the truthful partial
      evidence is preserved in `tasks.md`.
- [x] 5.3 Updated `docs/01-roadmap/EPIC-07-Scheduling.md` (created) and
      `docs/05-modules/Scheduling.md` (created) with confidentiality, scope,
      routes and verification; plus ROADMAP/modules index consistency.

### Files Changed — WU5

| File                                             | Action   | What Was Done                                                                                                                                                    |
| ------------------------------------------------ | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/api/src/scheduling/appointment.service.ts` | Modified | Advisory-lock query casts `pg_advisory_xact_lock(...)` to `text` (+3 net) so Prisma `$queryRaw` can deserialize it (P2010 fix).                                  |
| `apps/api/test/live-pg-isolation.e2e-spec.ts`    | Modified | EPIC-07 race fixture creates the anchor Patient `isActive: false` (+6 net) to satisfy the deferred exactly-one-primary-guardian trigger; barrier query `::text`. |
| `docs/01-roadmap/EPIC-07-Scheduling.md`          | Created  | Epic doc: objective, scope/out-of-scope, acceptance criteria, dependencies, exit criteria, decisions, tech debt; status `review`.                                |
| `docs/05-modules/Scheduling.md`                  | Created  | Module doc: responsibility, entities, transitions, permissions, routes, invariants, confidentiality/tenant rules, verification.                                  |
| `docs/01-roadmap/ROADMAP.md`                     | Modified | EPIC-07 row `planned` → `review` plus an evidence-based status note.                                                                                             |
| `docs/05-modules/README.md`                      | Modified | Moved `Scheduling.md` from "Recommended" to "Implemented (EPIC-07)".                                                                                             |
| `openspec/changes/epic-07/tasks.md`              | Modified | 5.1 and 5.3 marked `[x]` (5.2 left open — Docker prerequisite unmet); WU5 verification evidence table + twin progress block added.                               |
| `openspec/changes/epic-07/apply-progress.md`     | Modified | This cumulative WU5 section (merged, not overwritten).                                                                                                           |

### Verification Evidence — WU5

| Command                                                                                                                                                                 | Result                                                                                                                                              |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL_TEST=postgresql://newsaas@127.0.0.1:5433/newsaas pnpm --filter @newsaas/api exec vitest run --config vitest.config.ts test/live-pg-isolation.e2e-spec.ts` | exit 0 — **26 passed / 26**; EPIC-07 probe: one persists, other `409 CONFLICT`, exactly one co-committed audit row; key-scoped barrier proof passes |
| `pnpm services:up` (`docker compose up -d`)                                                                                                                             | exit 1 — **gate unmet**, no Docker daemon in this environment; task 5.2 stays **open**                                                              |
| `pnpm preflight`                                                                                                                                                        | exit 0 — **PostgreSQL: reachable; Redis: reachable** (127.0.0.1, ports 5433/6380 from `.env`)                                                       |
| `pnpm --filter @newsaas/api test`                                                                                                                                       | exit 0 — 55 files passed / 1 skipped, **543 passed / 25 skipped** (baseline preserved)                                                              |
| `pnpm --filter @newsaas/api exec vitest run --config vitest.config.ts src/scheduling/appointment.service.test.ts`                                                       | exit 0 — **34 passed** (production lock fix regression)                                                                                             |
| `pnpm --filter @newsaas/api typecheck`                                                                                                                                  | exit 0 — no errors                                                                                                                                  |
| `pnpm --filter @newsaas/api lint`                                                                                                                                       | exit 0 — no errors                                                                                                                                  |
| `pnpm exec prettier --check <2 WU5 source/test files + 4 doc files>`                                                                                                    | exit 0 — `appointment.service.ts`, the e2e spec, both new docs, ROADMAP and modules README                                                          |

Environment note: the local PostgreSQL was provisioned as a throwaway cluster
(`/usr/lib/postgresql/16/bin/initdb` + `pg_ctl` on `127.0.0.1:5433`, trust auth)
and Redis on `6380`, matching the project `.env` tuple exactly. No project
service configuration was changed.

### Defects found and fixed by the durable run (the point of 5.1)

WU2's race probe had always been `describe.skipIf`-skipped, so neither of these
was ever exercised. Both are live-only and invisible to the in-memory harness.

1. **Fixture violated a real database invariant.** The EPIC-07 `beforeAll`
   created the anchor Patient as active with zero active primary guardians; the
   deferred `patient_exactly_one_primary_guardian` trigger (Decision #2210)
   rejected it with SQLSTATE 23514. Fixed by creating the fixture
   `isActive: false` — `assertTenantAnchors` only checks tenant existence, not
   activity, so this is the minimal faithful fixture.
2. **Production REJECT lock path failed on real PostgreSQL.** `lockProfessional`
   ran `SELECT pg_advisory_xact_lock(...)`, which returns `void`; Prisma
   `$queryRaw` cannot deserialize a `void` column (`P2010`). The in-memory fake
   never deserializes, so all prior suites were green while the concurrency
   serialization would have thrown at runtime. Fixed in the production service
   by casting the result to `text`; the test barrier was updated identically.
   This is required for the spec requirement "conflict detection SHALL hold
   under concurrent requests" to be true outside the fake.

Discriminating evidence: the live suite failed at the fixture (23514) before fix
#1 and at the barrier (P2010) before fix #2, then passed 25/25 after both; the
`@newsaas/api` suite stayed 543/25 green.

### Deviations from Design

- The design's live-PG row named `pnpm services:up && pnpm preflight`. Docker is
  unavailable in this environment, so the Docker bring-up gate could not run;
  the preflight gate ran against locally-provisioned services on the identical
  `.env` hosts/ports. Recorded honestly rather than skipped.
- WU5 modified two WU2-owned files (the service lock query and the race
  fixture). Both are defect fixes required to execute task 5.1; no behavior,
  contract or route changed beyond making the existing concurrency path work on
  real PostgreSQL. No WU1/WU3/WU4 file was touched.
- The EPIC-07 epic doc is created with `status: review` (not `done`) and
  ROADMAP's EPIC-07 row moves `planned` → `review`: implementation is complete
  but epic closure requires `sdd-verify` + archive, which this apply slice does
  not claim.
- `docs/05-modules/README.md` index updated as part of 5.3's documentation
  consistency (the repo keeps implemented module docs indexed).

### Issues Found

- **Unmet gate**: `pnpm services:up` (Docker daemon absent) — task 5.2 stays
  open; the preflight half passed against local equivalent services. Everything
  else ran.
- The live suite logs one expected non-failing line: the EPIC-05
  primary-promotion P2002 race maps to `500 INTERNAL` (pre-existing [[TD-011]]),
  unrelated to EPIC-07.
- [[TD-006]]/[[TD-007]] remain open; EPIC-07's own concurrency evidence now runs
  durably in the shared live-PG suite.

### Workload / PR Boundary — WU5

- Mode: **chained PR slice** (`feature-branch-chain`), WU5 = fifth/final child;
  base is the EPIC-07 feature/tracker branch. No commit/push/PR; child diffs
  must never target `main` directly.
- Boundary: starts after WU4's agenda and ends with the durable live-PG race,
  preflight evidence and the epic/module documentation. Explicitly OUT: any new
  product feature, portal/recurrence/Catalog scope, and WU1–WU4 refactors.
- Rollback boundary: the two harness/production lock fixes are independent of
  the docs; the docs are independent of the code. Reverting WU5 restores the
  prior (skip-only) probe state without touching WU1–WU4 behavior.
- **Measured size: ≈ 465 changed lines** — product/test delta ≈ **9 lines**
  (service +3, live-pg spec +6); documentation ≈ **277 lines** (new
  `EPIC-07-Scheduling.md` 128 + `Scheduling.md` 141, ROADMAP +3, modules README
  +5); SDD artifacts ≈ **179 lines** (`tasks.md` +43, this artifact +136). No
  minification and no dropped coverage.
- **No `size:exception` required.** WU5's ≈465 changed lines are inside the
  800-line slice budget, and the reviewable product/test delta is only ≈9 lines
  (the rest is documentation and SDD bookkeeping). The earlier recommendation of
  a `size:exception` or a `WU5a`/`WU5b` split was stale and is **withdrawn**.
  (The separate WU5 corrective batch below is measured on its own.)

### WU5 stop point

Tasks 5.1 and 5.3 complete and verified; **task 5.2 remains open** because its
required Docker `pnpm services:up` gate could not run in this environment (the
preflight half passed). EPIC-07 apply status is **20/21 tasks complete**
(1.1–4.3, 5.1, 5.3 `[x]`; 5.2 `[ ]`), consistent across both hybrid task
authorities. The durable live-PG race passes; documentation is current; two
live-only defects are fixed. Epic closure (`sdd-verify` + archive) is not
claimed. No commit/push/branch/PR was performed.

---

## WU5 Corrective Batch — Fresh-Review Fixes

A fresh-context adversarial review of WU5 raised five findings. This corrective
batch resolves all five without broadening scope: one test-only code fix, one
hybrid status reconciliation, one chain-metadata reconciliation, one roadmap
date, and one withdrawn stale recommendation. Standard mode
(`strict_tdd: false`); no production source was modified; no commit, push,
branch or PR was performed. WU1–WU4 files were not touched.

### Findings and resolution

1. **The live-PG race barrier counted arbitrary database lock waiters.**
   `apps/api/test/live-pg-isolation.e2e-spec.ts` used the generic
   `waitForLockWaiters` (`wait_event_type = 'Lock'`) for the EPIC-07 scheduling
   race, so an unrelated row lock or a different advisory lock could have
   satisfied it and released the probe prematurely.
   - Added `countAdvisoryLockWaiters(prisma, lockKey)` and
     `waitForAdvisoryLockWaiters(prisma, lockKey, expected, timeoutMs)`, which
     count only backends blocked on the exact 64-bit scheduling advisory lock
     key. `pg_locks` exposes a 64-bit advisory lock as `classid` = high 32 bits,
     `objid` = low 32 bits, `objsubid` = 1; the query reconstructs
     `hashtextextended(key, 0)` and requires `granted = false`, so only waiters
     on that key are counted.
   - The EPIC-07 race test now uses the key-scoped barrier. The two
     EPIC-05/EPIC-06 barriers still use the generic helper because they
     genuinely contend on row locks (`FOR UPDATE`), not advisory locks.
   - **Focused proof added** (discriminating test inside the EPIC-07 describe):
     it holds an UNRELATED advisory key, proves a waiter is blocked on it via
     the generic helper, then asserts `countAdvisoryLockWaiters` reports `0` for
     the scheduling key and the key-scoped barrier times out. The pre-correction
     generic count would have been `1` and released the race early.

2. **Compound task 5.2 was marked complete while `pnpm services:up` failed.**
   `tasks.md` marked `[x] 5.2 Run pnpm services:up && pnpm preflight`. Only the
   preflight half ran; the Docker bring-up half could not.
   - `tasks.md` now leaves `- [ ] 5.2` **open** with the precise unmet Docker
     prerequisite, and preserves the truthful partial evidence (`pnpm preflight`
     reachable). The evidence-table row is relabelled "gate unmet".
   - `apply-progress.md` records 5.2 as open and reconciles total status to
     **20/21** tasks complete (5.1, 5.3 `[x]`; 5.2 `[ ]`).

3. **Chain-strategy metadata was stale.** `tasks.md` still said
   `Chain strategy: pending` and "Decision needed before apply: Yes" while
   `apply-progress.md` records the resolved `feature-branch-chain`.
   - `tasks.md` forecast now reads
     `Delivery strategy: auto-chain (resolved: feature-branch-chain)` and
     `Chain strategy: feature-branch-chain`; the prose line records the decision
     as resolved (WU1 → WU5 child slices on the EPIC-07 feature/tracker branch).

4. **ROADMAP frontmatter date was stale.** `docs/01-roadmap/ROADMAP.md` had
   `updated: 2026-09-13` although its body records the EPIC-07 `review` update
   on 2026-09-14.
   - Frontmatter `updated` is now `2026-09-14`, matching the EPIC-07 status
     note.

5. **The WU5 PR-size recommendation was stale.** WU5 recommended
   `size:exception`/`WU5a`–`WU5b` even though its ≈465 changed lines are inside
   the 800-line slice budget.
   - The recommendation is **withdrawn**: WU5 requires no `size:exception`.

### Corrective slice budget

| File                                          | Action   | Net                                                            |
| --------------------------------------------- | -------- | -------------------------------------------------------------- |
| `apps/api/test/live-pg-isolation.e2e-spec.ts` | Modified | +117 (1,805 → 1,922); key-scoped helpers + discriminating test |
| `docs/01-roadmap/ROADMAP.md`                  | Modified | +1/−1 (frontmatter `updated` date)                             |
| `openspec/changes/epic-07/tasks.md`           | Modified | status/chain metadata reconciliation (5.2 open; count 26/26)   |
| `openspec/changes/epic-07/apply-progress.md`  | Modified | this section (merged, not overwritten)                         |

The only code delta is **test-only** (+117 lines, no deletions, no minification,
no coverage dropped); the rest is documentation/status. Pre-existing WU1–WU5
dirtiness is excluded, and no WU5 `size:exception` is claimed.

### Corrective verification gates

| Command                                                                                                                                                                 | Result                                                   |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `DATABASE_URL_TEST=postgresql://newsaas@127.0.0.1:5433/newsaas pnpm --filter @newsaas/api exec vitest run --config vitest.config.ts test/live-pg-isolation.e2e-spec.ts` | exit 0 — **26 passed / 26** (new barrier proof 1,061 ms) |
| `pnpm --filter @newsaas/api typecheck`                                                                                                                                  | exit 0 — no errors                                       |
| `pnpm exec prettier --check apps/api/test/live-pg-isolation.e2e-spec.ts`                                                                                                | exit 0 — All matched files use Prettier code style!      |

Environment note: the key-scoped `pg_locks` predicate was first validated
directly against the local PostgreSQL 16 cluster on `127.0.0.1:5433` (a holder
plus a waiter on a contended key yielded count 1, while the scheduling key
yielded 0) before being committed to the suite. No Docker service was used, and
no claim of Docker success is made.

### Corrective stop point

Active WU5 review slice complete; all five findings are resolved. Task 5.2
remained **open** at that point by design (Docker prerequisite unmet) and was
not papered over; it is now closed by the WU5 Closure section below. Epic
closure (`sdd-verify` + archive) is not claimed. No commit, push, branch or PR
was performed.

---

## WU5 Closure — Task 5.2 Docker Retry

The Docker daemon is now available, so task 5.2's required gate was retried and
**passes**. Standard mode (`strict_tdd: false`); no product source was modified;
no commit, push, branch or PR was performed.

### Commands and results

| Command                                     | Result                                                                                                                                                                                                 |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `docker version` / `docker compose version` | Docker **28.5.1** / Compose **v2.40.0-desktop.1** (daemon available)                                                                                                                                   |
| `pnpm services:up` (`docker compose up -d`) | exit 0 — `newsaas-postgres` and `newsaas-redis` started                                                                                                                                                |
| Container identity / health                 | `newsaas-postgres` healthy — PostgreSQL 16.13-alpine, `data_directory=/var/lib/postgresql/data`, `0.0.0.0:5433->5432`; `newsaas-redis` healthy — `executable=/data/redis-server`, `0.0.0.0:6380->6379` |
| `pnpm preflight`                            | exit 0 — **PostgreSQL: reachable; Redis: reachable**                                                                                                                                                   |

### Environment correction (why the retry needed it)

The earlier WU5 attempt was open because no Docker daemon existed; it had
provisioned throwaway host services on the same `.env` ports — a PostgreSQL 16
cluster at `/tmp/opencode/pg-wu5` (bound `127.0.0.1:5433`) and a host
`redis-server` on `6380`. Those shadowed Docker on loopback, so `pnpm preflight`
would have measured the workaround rather than the project path. They were
stopped (`pg_ctl -D /tmp/opencode/pg-wu5 stop -m fast`;
`redis-cli -p 6380 shutdown nosave`), the compose services were recreated so
Docker owns ports 5433/6380, and identity was confirmed before running
preflight. No project service configuration was changed.

### Result

Task 5.2 is **complete**; EPIC-07 apply status is now **21/21 tasks complete**
(1.1–4.3, 5.1–5.3 `[x]`) in both hybrid authorities. Epic closure
(`sdd-verify` + archive) is not claimed. No commit, push, branch or PR was
performed.

---

## EPIC-07 Corrective Batch — Verify Failure Remediation (format-check + agenda filters)

Sole dedicated corrective executor pass for the `fail` verdict recorded in
`openspec/changes/epic-07/verify-report.md`
(`evidence_revision: sha256:778d51d6fd2309254c5d5c7565ceac9f2548450685ddbcfbc5db0cc0c0fb32f8`).
Standard mode (`strict_tdd: false`). This batch resolves exactly the two
CRITICAL verification findings. No other behavior, dependency, doc beyond
mechanical format, or task scope was changed. No commit, push, branch or PR was
performed. This section is **appended** to (merged with) all prior WU1–WU5
progress — nothing was overwritten.

### Finding 1 — `pnpm format-check` exits 1 (CRITICAL)

**Resolution.** Applied the project Prettier (`printWidth: 80`,
`proseWrap: always` for `*.md`) to the Markdown files named by the verify
report:

| File                                                     | Change class                                                             |
| -------------------------------------------------------- | ------------------------------------------------------------------------ |
| `.atl/skill-registry.md`                                 | prose re-wrap + table separator padding                                  |
| `openspec/changes/epic-07/design.md`                     | prose re-wrap + list/blank-line + table padding                          |
| `openspec/changes/epic-07/exploration.md`                | prose re-wrap + table padding + `*out*` → `_out_` emphasis normalization |
| `openspec/changes/epic-07/proposal.md`                   | prose re-wrap + list/blank-line + table padding                          |
| `openspec/changes/epic-07/specs/scheduling/spec.md`      | prose re-wrap + list/blank-line                                          |
| `openspec/changes/epic-07/specs/tenant-settings/spec.md` | prose re-wrap + list indent                                              |

**Minimal scope expansion (disclosed):**
`openspec/changes/epic-07/verify-report.md` was authored at verify time (21:59)
_after_ that run's `format-check` executed (21:53), so it was not among the six
names in the report — but it is a genuine Prettier violation and it was the only
remaining blocker to the declared outcome. It was formatted mechanically as
well. This is the sole added file; no product, config or unrelated doc was
touched.

**Semantic-safety evidence (mechanical-only).** Pristine pre-format copies were
snapshotted under `/tmp/opencode/epic-07-corrective-format-snapshot/` and
compared to the formatted files:

- Every changed file, after removing **all whitespace and all ASCII hyphens**,
  is character-identical to its pristine copy. The only content characters that
  moved are whitespace and Markdown table-separator dash padding.
- `exploration.md` additionally changed `*out*` → `_out_` (Prettier emphasis
  normalization); both forms render the same `<em>out</em>`, so meaning is
  unchanged. This is the only non-whitespace/hyphen delta in the whole set.
- No identifier, word, literal, link target, requirement, scenario, number or
  frontmatter value changed.

| Command             | Exit | Duration  | Summary                                                   | SHA-256                                                            | Log                                                               |
| ------------------- | ---- | --------- | --------------------------------------------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------- |
| `pnpm format-check` | 0    | 12,073 ms | `All matched files use Prettier code style!` (whole repo) | `1d66faad74f5e8709353f7288592866bd3a9095da1174a916e7aa632949971e2` | `/tmp/opencode/epic-07-corrective-20260914/root-format-check.log` |

### Finding 2 — rendered professional/status filter interactions uncovered (CRITICAL)

**Resolution (test-only).** Added two rendered Agenda tests to
`apps/web/src/app/(app)/app/agenda/agenda.test.tsx` that satisfy the spec's
"Authorized staff workflow" scenario ("branch/professional/status filters work
with their UI states"):

- **Professional filter**: seeds two appointments for two different
  `professionalMembershipId`s, renders them in the accessible List view, drives
  the rendered `Professional filter` `<select>` via `fireEvent.change`, then
  proves both (a) the agenda API request carries `professionalMembershipId=<id>`
  and (b) the rendered list drops the other professional's row.
- **Status filter**: seeds a `SCHEDULED` and a `CONFIRMED` appointment on
  distinct branches, drives the rendered `Status filter` `<select>` to
  `CONFIRMED`, then proves both (a) the request carries `status=CONFIRMED` and
  (b) only the `CONFIRMED` row remains rendered.

The only helper change is widening the local test mock's `appointments` handler
to receive the request URL (backward-compatible; existing zero-arg handlers
unchanged) so the mock can return filter-specific data. **No component or
production source changed** — the filter controls already worked; only their
rendered interaction is now exercised.

| File                                                | Action   | Change                                                                                     |
| --------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------ |
| `apps/web/src/app/(app)/app/agenda/agenda.test.tsx` | Modified | +2 rendered filter tests, 2 constants, URL-aware mock handler (423 → 512 lines, test-only) |

**Discriminating power (one-variable experiment).** With the `agenda.tsx`
`filters` memo temporarily reduced to `branchId` only (professional and status
spread removed), the focused run failed **2/15** at exactly the two new tests
(`professionalMembershipId=` request assertion and `status=CONFIRMED` request
assertion) while the pre-existing 13 passed. The pristine `agenda.tsx` was then
restored byte-for-byte
(`sha256:ce157ce54096fe67b622a61fc2f0ed2f06228955d826655f30128219ec51258a`,
matching the pre-experiment hash). The tests are therefore non-vacuous: they
fail precisely when a filter stops affecting the agenda query.

### Corrective slice budget

Gross **≈ 90 test additions + 2 deletions** in `agenda.test.tsx` (+89 net;
existing lines otherwise reformatted identically). Formatting touched exactly 7
Markdown files (the 6 named + the verify report) with whitespace/padding/
emphasis-marker-only deltas. Pre-existing EPIC-07 dirtiness (WU1–WU5) is
excluded. Well inside the 400-line guideline; nothing was minified and no
coverage was dropped.

### Corrective verification gates

| File                                                                                                              | Exit | Duration  | Summary                                         | SHA-256                                                            | Log                                                                  |
| ----------------------------------------------------------------------------------------------------------------- | ---- | --------- | ----------------------------------------------- | ------------------------------------------------------------------ | -------------------------------------------------------------------- |
| `pnpm --filter @newsaas/web exec vitest run --config vitest.config.ts "src/app/(app)/app/agenda/agenda.test.tsx"` | 0    | 5,160 ms  | 1 file, **15 passed** (was 13; +2 filter tests) | `2c535550f7826a890862972cc3d5f8d561bf51b75690e23821470599bd17bd7b` | `/tmp/opencode/epic-07-corrective-20260914/focused-agenda-tests.log` |
| `pnpm --filter @newsaas/web typecheck`                                                                            | 0    | 3,406 ms  | no errors                                       | `38ac890c60e7f38d59ddfb410325cdfb5fca83c9411765c5481754e01c021630` | `/tmp/opencode/epic-07-corrective-20260914/web-typecheck.log`        |
| `pnpm --filter @newsaas/web lint`                                                                                 | 0    | 10,433 ms | no errors                                       | `050c69da23536758722729aeda55a8d0fb9d557495ef6d33d70873a3b64a71c1` | `/tmp/opencode/epic-07-corrective-20260914/web-lint.log`             |
| `pnpm format-check`                                                                                               | 0    | 12,073 ms | Prettier green across the repo                  | `1d66faad74f5e8709353f7288592866bd3a9095da1174a916e7aa632949971e2` | `/tmp/opencode/epic-07-corrective-20260914/root-format-check.log`    |

### Scope expansions

`openspec/changes/epic-07/verify-report.md` (mechanical formatting only —
required to reach the declared `format-check` outcome; the report was authored
after the verify gate measured the formatter). No other expansion.

### Corrective stop point

Both CRITICAL verify findings are resolved: the root Prettier gate passes and
the rendered professional/status filter interactions are now driven and proven.
Only the two agenda test files' surface (test-only) and the mechanical Markdown
formatting changed. No task checkbox is affected (all 21 tasks remain `[x]`).
Epic closure (`sdd-verify` + archive) is not claimed. No commit, push, branch or
PR was performed.
