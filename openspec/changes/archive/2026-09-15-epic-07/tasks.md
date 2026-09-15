# Tasks: EPIC-07 — Staff Scheduling

## Review Workload Forecast

| Field                   | Value                                       |
| ----------------------- | ------------------------------------------- |
| Estimated lines         | 1,600–2,200                                 |
| 400-line budget risk    | High                                        |
| Chained PRs recommended | Yes                                         |
| Split                   | WU1 → WU2 → WU3 → WU4 → WU5                 |
| Delivery strategy       | auto-chain (resolved: feature-branch-chain) |
| Chain strategy          | feature-branch-chain                        |

Decision needed before apply: No — resolved by the orchestrator to a
`feature-branch-chain` (WU1 → WU5 child slices on the EPIC-07 feature/tracker
branch). Chained PRs recommended: Yes. Chain strategy: `feature-branch-chain`.
400-line budget risk: High.

### Suggested Work Units

| Unit | Goal          | Likely PR | Focused test command                   | Runtime harness    | Rollback boundary |
| ---- | ------------- | --------- | -------------------------------------- | ------------------ | ----------------- |
| 1    | Data/settings | WU1       | `pnpm test --filter @newsaas/database` | migration          | data/seeds        |
| 2    | Service       | WU2       | `pnpm test --filter @newsaas/api`      | services/preflight | module            |
| 3    | HTTP          | WU3       | `pnpm test --filter @newsaas/api`      | Supertest          | routes            |
| 4    | Agenda        | WU4       | `pnpm test --filter @newsaas/web`      | staff workflow     | UI/proxy          |
| 5    | Race/docs     | WU5       | `pnpm test && pnpm typecheck`          | race               | probes/docs       |

## Phase 1: Foundation

- [x] 1.1 Add `AppointmentStatus`/`Appointment` tenant FKs, indexes, version,
      relations in `packages/database/prisma/schema.prisma`.
- [x] 1.2 Create
      `packages/database/prisma/migrations/20260915000001_scheduling/migration.sql`
      with UTC CHECK and DELETE-rejecting trigger.
- [x] 1.3 Add RED schema/seed tests in
      `packages/database/src/scheduling.test.ts` for FKs, deletion, roles, and
      demo appointment.
- [x] 1.4 Register `scheduling` defaults, availability, blocks, policy,
      permission in `apps/api/src/settings/registry.ts`; green 1.3.
- [x] 1.5 Make `apps/api/src/settings/tenant-settings.service.ts` and
      `apps/api/src/settings/settings.controller.ts` enforce registry
      authorization and audit.
- [x] 1.6 Seed roles in `packages/database/src/reference-seed.ts` and synthetic
      appointments in `packages/database/src/demo-seed.ts`.

## Phase 2: Domain Service

- [x] 2.1 Add RED unit tests in
      `apps/api/src/scheduling/appointment.service.test.ts`: illegal/terminal
      transition is 409 unchanged.
- [x] 2.2 Implement create/reschedule/named-transition predicates and version
      checks in `apps/api/src/scheduling/appointment.service.ts`; green 2.1.
- [x] 2.3 Add RED 400/404/CONFIDENTIAL DTO tests in
      `apps/api/src/scheduling/appointment.dto.test.ts`.
- [x] 2.4 Implement tenant lookup, UTC/DST checks, DTO mapping, no events in
      `apps/api/src/scheduling/appointment.service.ts`; green 2.3.
- [x] 2.5 Add RED REJECT/ALLOW/audit tests in
      `apps/api/src/scheduling/appointment.service.test.ts` and race probe in
      `apps/api/test/live-pg-isolation.e2e-spec.ts`.
- [x] 2.6 Add advisory-lock conflict validation and
      `AuditWriter.append(..., tx)` co-commit in
      `apps/api/src/scheduling/appointment.service.ts`; green 2.5.

## Phase 3: API

- [x] 3.1 Add RED Supertest cases in
      `apps/api/src/scheduling/appointments.integration.test.ts` for
      401/403/400/409 and byte-equivalent cross-tenant 404/no persistence.
- [x] 3.2 Create `apps/api/src/scheduling/appointments.controller.ts` with
      routes/options; green 3.1.
- [x] 3.3 Register the module and route permissions in
      `apps/api/src/app.module.ts` and
      `apps/api/src/rbac/route-contract.probe.test.ts`.

## Phase 4: Agenda

- [x] 4.1 Add RED UI/proxy tests in
      `apps/web/src/app/(app)/app/agenda/agenda.test.tsx` for loading, empty,
      error, denied, filters, and reschedule.
- [x] 4.2 Create agenda views and semantic-token states in
      `apps/web/src/app/(app)/app/agenda/**`; green 4.1. Day/week/month render
      the approved FullCalendar React component (`@fullcalendar/react` plus the
      official `core`, `daygrid`, `timegrid` and `interaction` 6.1.21 packages)
      for drag-move, pointer resize and time-range selection; the accessible
      list view, tested Manage form and status styling stay native React +
      semantic tokens. See `apply-progress.md` → "WU4 — Staff Agenda
      UI/Proxies/Nav" and "WU4 Corrective Batch — Reviewed Fixes".
- [x] 4.3 Create proxies in
      `apps/web/src/app/api/scheduling/[[...path]]/route.ts` and
      `apps/web/src/app/api/settings/[[...path]]/route.ts`; add nav.

## Phase 5: Evidence and Docs

- [x] 5.1 Run `apps/api/test/live-pg-isolation.e2e-spec.ts`: one REJECT overlap
      persists; other is 409.
- [x] 5.2 Run `pnpm services:up && pnpm preflight`; record evidence in
      `openspec/changes/epic-07/tasks.md`. **Complete (2026-09-14)**: with the
      Docker daemon available (Docker 28.5.1 / Compose v2.40.0),
      `pnpm services:up` (`docker compose up -d`) started `newsaas-postgres`
      (PostgreSQL 16.13-alpine, `0.0.0.0:5433->5432`) and `newsaas-redis`
      (`0.0.0.0:6380->6379`), both healthy, and `pnpm preflight` reported
      `PostgreSQL: reachable; Redis: reachable`. The earlier attempt was open
      only because no Docker daemon existed; the retry re-ran the real compose
      path after stopping the throwaway host PostgreSQL/Redis left by that
      earlier attempt so the Docker services are authoritative.
- [x] 5.3 Update `docs/01-roadmap/EPIC-07-Scheduling.md` and
      `docs/05-modules/Scheduling.md` with confidentiality, scope, routes,
      verification.

### WU5 verification evidence (recorded 2026-09-14)

| Gate                          | Command / observation                                                                                                                                                   | Result                                                                                                                            |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Live-PG race/isolation (5.1)  | `DATABASE_URL_TEST=postgresql://newsaas@127.0.0.1:5433/newsaas pnpm --filter @newsaas/api exec vitest run --config vitest.config.ts test/live-pg-isolation.e2e-spec.ts` | exit 0 — **26 passed / 26**; EPIC-07 probe **one persists, other `409 CONFLICT`, one audit row**; key-scoped barrier proof passes |
| Local service boot (5.2)      | `pnpm services:up` (`docker compose up -d`) — Docker 28.5.1 / Compose v2.40.0                                                                                           | exit 0 — `newsaas-postgres` (PG 16.13-alpine, `0.0.0.0:5433->5432`) and `newsaas-redis` (`0.0.0.0:6380->6379`) both healthy       |
| Project preflight (5.2)       | `pnpm preflight` → Docker PostgreSQL/Redis on the project `.env` ports (5433/6380)                                                                                      | exit 0 — **PostgreSQL: reachable; Redis: reachable**                                                                              |
| API regression (WU5 prod fix) | `pnpm --filter @newsaas/api test`                                                                                                                                       | exit 0 — 55 files passed / 1 skipped, **543 passed / 25 skipped**                                                                 |
| API typecheck / lint          | `pnpm --filter @newsaas/api typecheck`; `pnpm --filter @newsaas/api lint`                                                                                               | exit 0 / exit 0                                                                                                                   |
| Docs (5.3)                    | `prettier --check docs/01-roadmap/EPIC-07-Scheduling.md docs/05-modules/Scheduling.md`                                                                                  | exit 0                                                                                                                            |

Two durable-run defects were found and fixed (both were invisible to the
in-memory harness and had left WU2's probe `skipIf`-skipped):

1. `apps/api/test/live-pg-isolation.e2e-spec.ts` — the EPIC-07 race fixture
   created an **active** Patient with zero active primary guardians, rejected by
   the deferred `patient_exactly_one_primary_guardian` trigger (SQLSTATE 23514).
   Fixed by creating the anchor Patient `isActive: false` (scheduling checks
   existence, not activity).
2. `apps/api/src/scheduling/appointment.service.ts` — `pg_advisory_xact_lock`
   returns `void`, which Prisma `$queryRaw` cannot deserialize (P2010), so the
   `REJECT` lock path failed on real PostgreSQL. Fixed by casting the result to
   `text` (test barrier updated identically). This is a production-path fix
   required for 5.1 to produce honest evidence.

At the time of the WU5 batch the Docker-based `pnpm services:up` gate could not
run (no Docker daemon), so compound task 5.2 was left **open** and only
`pnpm preflight` was proven against locally-provisioned equivalent services on
the same `.env` ports. Task 5.2 was subsequently **closed** on 2026-09-14
through the Docker retry recorded above: `pnpm services:up` brought up the
healthy `newsaas-postgres`/`newsaas-redis` containers and `pnpm preflight`
passed against them. No commit, push, branch or PR was performed.

---

## Apply Progress (hybrid twin)

WU1 — Data/settings complete (tasks 1.1–1.6) plus the WU1 corrective batch (see
`openspec/changes/epic-07/apply-progress.md` and Engram
`sdd/epic-07/apply-progress`). WU1 = 1,009 changed lines + ≈258 corrective
lines.

WU2 — Domain service complete (tasks 2.1–2.6). Files:
`apps/api/src/scheduling/{appointment.service.ts,appointment.dto.ts,appointment.permissions.ts}`
and their `*.test.ts`; race probe added to
`apps/api/test/live-pg-isolation.e2e-spec.ts`. Focused evidence:
`src/scheduling/appointment.service.test.ts` 27/27 and `appointment.dto.test.ts`
8/8 (35/35); `@newsaas/api` typecheck + lint green. OUTSTANDING (RESOLVED):
`prettier --check` on the 3 WU2 files now exits 0 (mechanical line-wrapping
applied via `prettier --write`; no semantic change). Only live-PG execution
remains (WU5-owned). No commit/push/PR.

WU2 Corrective Batch (fresh-review fixes, test-only): audit co-commit is now
proven behaviorally (forced `AuditWriter.append` failure rolls back
create/transition/reschedule), and a concrete `America/Asuncion` DST-boundary
suite replaces the offset-agnostic assertion. `appointment.service.test.ts` 27 →
34 tests; API suite 529 passed / 25 skipped. See `apply-progress.md` → "WU2
Corrective Batch — Fresh-Review Fixes". No new task checkbox completes (2.1–2.6
already `[x]`).

WU3 — API/controller/route contract complete (tasks 3.1–3.3). Files:
`apps/api/src/scheduling/{appointments.controller.ts,scheduling.module.ts}`,
`apps/api/src/scheduling/appointments.integration.test.ts`,
`apps/api/test/support/scheduling-http-fixture.ts`, plus edits to
`apps/api/src/app.module.ts`, `apps/api/src/rbac/route-contract.probe.test.ts`
and the in-memory boundary (`apps/api/test/support/in-memory-database.ts`).
Focused evidence: 21/21 (appointments integration 13, route-contract probe 8);
full `@newsaas/api` suite 543 passed / 25 skipped; typecheck + lint + prettier
green. Measured WU3 size ≈ **974 changed lines** (production/wiring ≈ 197; test
support + integration + probe ≈ 777); no `size:exception` is claimed — see
`apply-progress.md` → "WU3 — API/Controller/Route Contract" for the honest split
recommendation. No commit/push/branch/PR.

WU4 — Staff agenda UI/proxies/nav complete (tasks 4.1–4.3). Files:
`apps/web/src/app/(app)/app/agenda/{page.tsx,agenda.tsx,agenda-views.tsx,agenda-api.ts,agenda-time.ts,agenda-calendar.ts}`
and their `*.test.ts(x)`, plus
`apps/web/src/app/api/scheduling/[[...path]]/route.ts` and
`apps/web/src/app/api/settings/[[...path]]/route.ts` (+ each `route.test.ts`),
`apps/web/src/lib/session-cookie.ts`, and
`apps/web/src/components/shell/nav-sidebar.tsx` (+ test). The **WU4 corrective
batch** replaced the native calendar interactions with the approved FullCalendar
React component (`@fullcalendar/react` + official `core`/`daygrid`/`timegrid`/
`interaction` 6.1.21), preserved allowlisted scheduling query params, rejects
invalid/DST-gap local times (fold → earlier instant), distinguishes a stale
optimistic-version 409 by refetching with user feedback, forwards only the staff
session cookie, and retains semantic tokens plus the tested accessible Manage
form. Focused evidence: 7 files / **59 passed** (agenda 13, agenda-api 7,
agenda-time 12, agenda-calendar 6, scheduling proxy 12, settings proxy 7, nav
2); full `@newsaas/web` suite **32 files / 232 passed**; typecheck + lint +
prettier + `next build` green. Measured WU4 size ≈ **2,840 changed lines**
(pre-corrective production ≈ 1,893; tests ≈ 937) plus the corrective slice (see
`apply-progress.md` → "WU4 — Staff Agenda UI/Proxies/Nav" and "WU4 Corrective
Batch — Reviewed Fixes"). No commit/push/branch/PR.

WU5 — Live-PG race/isolation evidence, preflight and docs complete (tasks
5.1–5.3). Task 5.2 is **complete**: its Docker
`pnpm services:up && pnpm preflight` gate ran successfully on 2026-09-14 once
the Docker daemon was available (see the closure note above and
`apply-progress.md` → "WU5 Closure"). Files:
`apps/api/test/live-pg-isolation.e2e-spec.ts` (race fixture fix + key-scoped
advisory-lock barrier), `apps/api/src/scheduling/appointment.service.ts`
(advisory-lock `::text`), `docs/01-roadmap/EPIC-07-Scheduling.md` (created),
`docs/05-modules/Scheduling.md` (created), plus `docs/01-roadmap/ROADMAP.md` and
`docs/05-modules/README.md` index/status consistency. Focused evidence: full
live-PG suite **26/26 passed** (EPIC-07 probe one persists + one `409 CONFLICT`,
plus the discriminating proof that the barrier counts only waiters on the
scheduling advisory lock key); `@newsaas/api` suite **543 passed / 25 skipped**;
typecheck + lint + prettier green; `pnpm preflight` reachable against Docker
PostgreSQL/Redis. `pnpm services:up` brought up the healthy
`newsaas-postgres`/`newsaas-redis` containers, closing task 5.2. EPIC-07 apply
status is now **21/21 tasks complete**. See the WU5 verification table above and
`apply-progress.md` → "WU5 — Live-PG Evidence, Preflight, Docs" and "WU5
Closure". No commit/push/branch/PR.

Session: epic-07-wu5-20260914
