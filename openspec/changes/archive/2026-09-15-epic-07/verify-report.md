```yaml
schema: gentle-ai.verify-result/v1
evidence_revision: sha256:b12dfc80ed6c5e46ea148012cf3057a633e652dda9fb0ee3a3944bdd823dfea4
verdict: pass_with_warnings
blockers: 0
critical_findings: 0
requirements: 11/11
scenarios: 26/26
test_command: "pnpm test"
test_exit_code: 0
test_output_hash: sha256:8890341f3b8cf4f55c2a75e884bde3b87122c57443e08134d9b8719a86ec7c1d
build_command: "pnpm build"
build_exit_code: 0
build_output_hash: sha256:197e207f05221f66f8a38d5febadf1865e145a95d5723e92e274eaa5722505d3
```

## Verification Report

**Change**: epic-07
**Version**: N/A
**Mode**: Standard

### Command Evidence

| Command | Exit | Duration | Summary | SHA-256 | External log |
|---|---:|---:|---|---|---|
| `node --version; pnpm --version; docker version; docker compose version; docker compose ps; pnpm preflight; gentle-ai sdd-verify-validate --help` | 0 | 3,727 ms | Node 24.14.0, pnpm 11.1.2, Docker 28.5.1; Compose PostgreSQL/Redis healthy; preflight reachable; validator available. | `9cf3d80295293816a27e898b35c107251682c1fe43eac176a049d65d6488d2c0` | `/tmp/opencode/epic-07-reverify-20260914/capability-preflight.log` |
| `pnpm format-check` | 0 | 12,847 ms | Corrective formatter failure resolved; all matched files use Prettier style. | `1d66faad74f5e8709353f7288592866bd3a9095da1174a916e7aa632949971e2` | `/tmp/opencode/epic-07-reverify-20260914/root-format-check.log` |
| `pnpm --filter @newsaas/web exec vitest run --config vitest.config.ts "src/app/(app)/app/agenda/agenda.test.tsx"` | 0 | 5,496 ms | Corrective coverage verified first: 15/15 rendered Agenda tests passed, including professional/status filters. | `e33b0c14d061dee48f5424e366a8e8f9c4663ea9ff480b5788b3451c5a77ea77` | `/tmp/opencode/epic-07-reverify-20260914/focused-agenda-filters.log` |
| `pnpm lint` | 0 | 12,145 ms | 14/14 Turbo tasks succeeded. | `8daefd7623349a180550e8de8cd8cdcdeccc1a796e10af6cefaad2cd1eae52fa` | `/tmp/opencode/epic-07-reverify-20260914/root-lint.log` |
| `pnpm typecheck` | 0 | 5,411 ms | 14/14 Turbo tasks succeeded. | `8c7919d32cc468c77c5d0e344b400aaa3bb4318f33bf115511453b1ee67cb5c0` | `/tmp/opencode/epic-07-reverify-20260914/root-typecheck.log` |
| `pnpm test` | 0 | 12,967 ms | 15/15 Turbo tasks succeeded; database 146, API 543, web 236 tests passed; live-PG suite intentionally skipped in root run and executed separately. | `8890341f3b8cf4f55c2a75e884bde3b87122c57443e08134d9b8719a86ec7c1d` | `/tmp/opencode/epic-07-reverify-20260914/root-test.log` |
| `pnpm build` | 0 | 33,997 ms | 9/9 Turbo tasks succeeded; Next.js Agenda and both proxies compiled; build-output verification passed. | `197e207f05221f66f8a38d5febadf1865e145a95d5723e92e274eaa5722505d3` | `/tmp/opencode/epic-07-reverify-20260914/root-build.log` |
| `DATABASE_URL_TEST="$DATABASE_URL" pnpm --filter @newsaas/api exec vitest run --config vitest.config.ts test/live-pg-isolation.e2e-spec.ts` | 1 | 4,035 ms | Setup-only evidence command retained: repository URL contained `?schema=public`, which `psql` rejects; 26 tests skipped. | `0529d0672a8ee7974f9bf0c60c23811a88df1ebffd231e0f2e52c401db6e86fc` | `/tmp/opencode/epic-07-reverify-20260914/focused-live-pg.log` |
| `DATABASE_URL_TEST=<query-free repository Docker URL> pnpm --filter @newsaas/api exec vitest run --config vitest.config.ts test/live-pg-isolation.e2e-spec.ts` | 0 | 13,670 ms | Corrected evidence command; 26/26 live-PG tests passed, including EPIC-07 overlap serialization and exact-key waiter proof. | `3bd6dbadceba98f2b8a18b7c02ab0ecf77bd820b1d37f5b19b9cf63a7c7f17ec` | `/tmp/opencode/epic-07-reverify-20260914/focused-live-pg-configured.log` |

The live-PG command was rerun only because the first invocation passed Prisma's
`schema` query parameter to `psql` and failed before tests executed. The corrected
invocation derived the same repository-configured Docker URL without query
parameters. The candidate diff was unchanged.

### Capability Preflight

| Check | Result | Reason | Retried? |
|---|---|---|---|
| Node / pnpm | AVAILABLE | Versions 24.14.0 / 11.1.2 executed. | No |
| Docker / Compose | AVAILABLE | Daemon reachable; project PostgreSQL and Redis containers healthy. | No |
| PostgreSQL / Redis | AVAILABLE | Project preflight reached both services. | No |
| Vitest / TypeScript / ESLint / Prettier / build | AVAILABLE | All tools executed through project scripts. | No |
| SDD report validator | AVAILABLE | Help/preflight exited 0 and declared the v1 schema. | No |
| Strict TDD | SKIPPED | `openspec/config.yaml` sets `strict_tdd: false`; no Strict TDD material was loaded. | No |
| Playwright E2E | SKIPPED | Project testing capability marks E2E unavailable; required UI/proxy behavior has passing Testing Library and route-handler evidence. | No |

### Evidence Map

| Requirement / Scenario | Bounded source or test evidence | Runtime evidence | Result |
|---|---|---|---|
| Appointment scope — valid create | `appointment.service.test.ts`; `appointments.integration.test.ts`; `scheduling.test.ts` | Root test | COMPLIANT |
| Appointment scope — non-VETERINARIAN rejected | `appointment.service.test.ts`; `appointments.integration.test.ts` | Root test | COMPLIANT |
| Appointment scope — cross-tenant references rejected | `appointments.integration.test.ts`; composite-FK cases in `scheduling.test.ts` | Root test | COMPLIANT |
| Appointment scope — invalid time range rejected | `appointment.dto.test.ts`; `appointments.integration.test.ts` | Root test | COMPLIANT |
| Lifecycle — confirm and audit | `appointment.service.test.ts`; `appointments.integration.test.ts` | Root test | COMPLIANT |
| Lifecycle — illegal terminal transition unchanged | `appointment.service.test.ts` | Root test | COMPLIANT |
| Overlap — REJECT default | `appointment.service.test.ts`; `appointments.integration.test.ts` | Root test | COMPLIANT |
| Overlap — ALLOW policy | `appointment.service.test.ts` | Root test | COMPLIANT |
| Overlap — concurrent race | `live-pg-isolation.e2e-spec.ts`; advisory lock in `appointment.service.ts` | Focused live-PG 26/26 | COMPLIANT |
| Availability — outside window rejected | `appointment.service.test.ts`; `appointment.service.ts` | Root test | COMPLIANT |
| Availability — one-off block rejected | `appointment.service.test.ts`; `appointment.service.ts` | Root test | COMPLIANT |
| Authorization — missing granular permission | `appointments.integration.test.ts`; `appointment.service.test.ts` | Root HTTP/service tests | COMPLIANT |
| Authorization — anonymous scheduling request | `appointments.integration.test.ts` | Root HTTP tests | COMPLIANT |
| Tenant isolation — foreign appointment access | `appointments.integration.test.ts`; `appointment.service.test.ts` | Root HTTP/service tests | COMPLIANT |
| Confidential response — no internals/service field | `appointment.dto.test.ts`; `appointments.integration.test.ts` | Root test | COMPLIANT |
| Transactional audit — exactly one row and rollback | `appointments.integration.test.ts`; rollback cases in `appointment.service.test.ts` | Root integration/unit tests | COMPLIANT |
| Staff agenda — authorized workflow | `agenda.test.tsx:155-318` covers states, branch/professional/status controls and rendered list effects; remaining interactions are covered later in the same file | Focused Agenda 15/15 and root web 236/236 | COMPLIANT |
| Staff agenda — permission denied without data | `agenda.test.tsx:184-194`; scheduling proxy denial case | Root web test | COMPLIANT |
| Synthetic demo — populated | `scheduling.test.ts`; `demo-seed.ts` | Root database 146/146 | COMPLIANT |
| Settings registry — unknown namespace rejected | `registry.test.ts`; `tenant-settings.service.test.ts` | Root API test | COMPLIANT |
| Settings registry — written version persisted | `tenant-settings.service.test.ts`; `tenant-settings.service.ts` | Root API test | COMPLIANT |
| Settings registry — scheduling defaults | `registry.test.ts`; `tenant-settings.service.test.ts` | Root API test | COMPLIANT |
| Settings registry — invalid scheduling value unchanged | `registry.test.ts`; write-path cases in `tenant-settings.service.test.ts` | Root API test | COMPLIANT |
| Settings auth — read allowed/write denied without key | `tenant-settings.service.test.ts`; `settings.integration.test.ts` | Root HTTP/service tests | COMPLIANT |
| Settings auth — anonymous read rejected | `settings.integration.test.ts`; authenticated controller boundary | Root HTTP tests | COMPLIANT |
| Settings auth — scheduling write requires own key | `tenant-settings.service.test.ts`; registry permission key | Root service/integration tests | COMPLIANT |

### Design and Task Coherence

- All 11 requirements and 26 scenarios have passing runtime coverage.
- All 21/21 authoritative tasks are checked.
- Composite tenant ownership, typed scheduling settings, transaction-scoped
  advisory locking, UTC/timezone handling, granular permissions, named lifecycle
  commands, allowlisted DTOs, authenticated proxies, semantic tokens, and the
  FullCalendar agenda match the design.
- No Portal, recurrence, Catalog/service-label, practitioner entity, clinical
  linkage, generic status endpoint, or appointment event scope was introduced.

### Issues Found

**CRITICAL**: None.
**WARNING**:

1. Playwright remains unavailable by project configuration; no browser E2E was
   run. Required Agenda behavior is covered by Testing Library, route-handler
   tests, and a successful production build.
2. The successful live-PG suite emits the known EPIC-05 primary-guardian P2002
   error log tracked as TD-011; all 26 tests pass and the message is unrelated to
   EPIC-07.
3. Legacy hybrid parity is incomplete: Engram counterparts were available for
   the specs, design, and original verify report, but the proposal twin was never
   persisted. OpenSpec remains authoritative.

**SUGGESTION**: None.

### Execution Efficiency

| Candidate diff SHA-256 | Root gate runs | Focused runs | Duplicate runs avoided | Bounded reads | Speculative probes |
|---|---:|---:|---:|---:|---:|
| `sha256:3f87253effb08222e5dcc41a568a99940835c1210b5b597fa312a9ef52e0c8a4` | 5 | 3 | 4 | 20 | 0 |

Each root gate ran once against the unchanged candidate. The Agenda focus was
required to verify the declared corrective interaction coverage before the full
root suite. Live PostgreSQL was the only environment-specific focused
capability; its setup-only URL correction is retained as a run. Separate focused
API, web, database, and worker suites were avoided because the root suite already
covered them.
