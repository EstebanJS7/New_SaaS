# Archive Report: EPIC-07 — Staff Scheduling

**Archived**: 2026-09-15
**Mode**: hybrid (OpenSpec filesystem + Engram)
**Change**: epic-07
**Verdict**: PASS WITH WARNINGS (0 CRITICAL, 0 blockers)
**Requirements**: 11/11 | **Scenarios**: 26/26
**Tasks**: 21/21 complete

## Summary

EPIC-07 delivered a tenant- and branch-scoped staff scheduling capability for
the Veterinary vertical. The change added an `Appointment` aggregate with a
7-state lifecycle, advisory-lock concurrency, typed scheduling settings
(availability, blocks, conflict policy), granular permissions, a FullCalendar
agenda with day/week/month/list views, authenticated proxies, and full audit
trail. No Portal, recurrence, Catalog, practitioner entity, clinical linkage, or
internal events were introduced.

## Specs Synced

| Domain | Action | Details |
|--------|--------|---------|
| scheduling | Created | 11 requirements, 26 scenarios — new full spec (no prior main spec) |
| tenant-settings | Updated | 2 requirements MODIFIED: "Typed code registry" (added `scheduling` namespace), "Authenticated reads, permission-gated writes" (added `scheduling.settings.manage`). 3 requirements preserved unchanged. |

## Archive Contents

- `proposal.md` ✅
- `specs/` ✅ (scheduling, tenant-settings)
- `design.md` ✅
- `tasks.md` ✅ (21/21 tasks complete, 0 unchecked)
- `verify-report.md` ✅
- `apply-progress.md` ✅
- `exploration.md` ✅
- `archive-report.md` ✅ (this file)

## Source of Truth Updated

The following main specs now reflect the new behavior:
- `openspec/specs/scheduling/spec.md` — created (full spec)
- `openspec/specs/tenant-settings/spec.md` — merged 2 modified requirements

## Engram Observation IDs (traceability)

| Artifact | Engram ID | Status |
|----------|-----------|--------|
| sdd/epic-07/explore | #2431 | Found |
| sdd/epic-07/proposal | — | MISSING (original never persisted; filesystem proposal.md used throughout) |
| sdd/epic-07/spec | #2435 | Found |
| sdd/epic-07/design | #2441 | Found |
| sdd/epic-07/tasks | #2450 | Found |
| sdd/epic-07/apply-progress | #2470 | Found |
| sdd/epic-07/verify-report | #2528 | Found |
| sdd/epic-07/archive-report | — | Created by this step |

**Missing twin**: The original Engram proposal twin `sdd/epic-07/proposal` was
never created. Discovery #2436 (`EPIC-07 spec: Engram proposal artifact missing`)
recorded this during the spec phase. The authoritative filesystem
`openspec/changes/epic-07/proposal.md` was used throughout planning, design,
implementation, and verification. This is an intentional partial-Engram archive:
the user authorized archive knowing the proposal Engram twin was absent.

## Warnings (from verify-report, final state)

1. **Playwright unavailable**: No browser E2E was run; required Agenda behavior
   is covered by Testing Library, route-handler tests, and a successful
   production build.
2. **TD-011 log noise**: The live-PG suite emits a known EPIC-05
   primary-guardian P2002 error log unrelated to EPIC-07; all 26 tests pass.
3. **Hybrid parity gap**: Engram counterparts were available for exploration,
   spec, design, tasks, apply-progress, and verify report, but the proposal
   had no prior Engram twin. OpenSpec remains authoritative.

## Verification Summary

| Gate | Command | Result |
|------|---------|--------|
| Format check | `pnpm format-check` | exit 0 |
| Lint | `pnpm lint` | exit 0 (14/14 Turbo tasks) |
| Typecheck | `pnpm typecheck` | exit 0 (14/14 Turbo tasks) |
| Unit/integration tests | `pnpm test` | exit 0 (15/15 Turbo tasks; database 146, API 543, web 236 passed) |
| Build | `pnpm build` | exit 0 (9/9 Turbo tasks) |
| Live-PG race/isolation | `DATABASE_URL_TEST=... vitest run test/live-pg-isolation.e2e-spec.ts` | exit 0 (26/26 passed) |
| Service boot | `pnpm services:up && pnpm preflight` | exit 0 (PostgreSQL/Redis reachable) |
| Agenda focused | `vitest run agenda.test.tsx` | exit 0 (15/15 passed) |

## Next Recommendation

none — SDD cycle complete. Ready for the next change.
