# Tasks: EPIC-00 Foundation

## Review Workload Forecast

| Field                   | Value                                                                 |
| ----------------------- | --------------------------------------------------------------------- |
| Estimated changed lines | 1,200–1,800                                                           |
| 400-line budget risk    | High                                                                  |
| Chained PRs recommended | Yes                                                                   |
| Suggested split         | FOUND-001 → FOUND-002 → FOUND-003 → FOUND-004 → FOUND-005 → FOUND-006 |
| Delivery strategy       | ask-always                                                            |
| Chain strategy          | pending                                                               |

Decision needed before apply: Yes Chained PRs recommended: Yes Chain strategy:
pending 400-line budget risk: High

### Suggested Work Units

| Unit | Goal                         | Likely PR | Focused test command                                     | Runtime harness                       | Rollback boundary               |
| ---- | ---------------------------- | --------- | -------------------------------------------------------- | ------------------------------------- | ------------------------------- |
| 1    | Vault and workspace skeleton | FOUND-001 | `pnpm -r list`                                           | N/A: no app runtime                   | Root workspace, vault settings  |
| 2    | Quality baseline and CI      | FOUND-002 | `pnpm lint && pnpm typecheck && pnpm test && pnpm build` | GitHub PR workflow                    | Config, scripts, CI only        |
| 3    | Local services and probe     | FOUND-003 | `pnpm test --filter preflight`                           | `docker compose up -d` then preflight | Compose, env, scripts, docs     |
| 4    | API liveness                 | FOUND-004 | `pnpm test --filter api`                                 | `curl /health/live`                   | `apps/api` only                 |
| 5    | Web health UI                | FOUND-005 | `pnpm test --filter web`                                 | API up/down indicator                 | `apps/web`, UI package          |
| 6    | Worker/events/seed           | FOUND-006 | `pnpm test --filter worker`                              | Redis ping; seed disabled             | Worker, shared events, seed CLI |

## Phase 1: Workspace and Quality Foundation

- [x] 1.1 **FOUND-001** Create `.obsidian/app.json`, `.gitignore`,
      `docs/README.md`, root `package.json`, `pnpm-workspace.yaml`,
      `turbo.json`, and empty `apps/{web,api,worker}`; verify `pnpm -r list`
      reports all apps.
- [x] 1.2 **FOUND-001** Record the authorized no-push Git baseline and
      `docs/_templates` vault scope in `docs/09-releases/CHANGELOG.md`; verify
      no product code or remote is introduced.
- [x] 1.3 **FOUND-002** Create shared TypeScript/ESLint/Prettier/Vitest configs
      and root lint, format-check, typecheck, test, build scripts; verify an
      implicit-`any` fixture fails typecheck.
- [x] 1.4 **FOUND-002** Add `.github/workflows/ci.yml` and update
      `openspec/config.yaml` testing commands; verify CI invokes all four root
      quality gates on PRs.

## Phase 2: Local Runtime Services

- [x] 2.1 **FOUND-003** Add `docker-compose.yml` and `.env.example` for
      configurable PostgreSQL 16 named-volume persistence and Redis 7; verify
      both ports are reachable after restart.
- [x] 2.2 **FOUND-003** Add `infra/scripts/preflight.{sh,ps1}` and lifecycle
      prerequisites to `docs/README.md`; test both-up success and each
      unavailable service’s named non-zero failure.

## Phase 3: Deployable Health Surfaces

- [x] 3.1 **FOUND-004** Add API Zod environment validation and NestJS/Fastify
      `/health/live`; test missing named variable exits non-zero before testing
      200 healthy response via Supertest.
- [x] 3.2 **FOUND-005** Add neutral semantic-token UI branding stubs and
      `HealthIndicator` polling `NEXT_PUBLIC_API_URL/health/live`; test
      available and unavailable render states without Veterinary literals.
- [x] 3.3 **FOUND-006** Add worker Zod bootstrap, Redis ping, shared typed event
      envelope/dispatcher, and guarded `.opencode/commands/demo-seed.ts`; test
      Redis-start success, event delivery, and default seed disabled/no changes.

## Phase 4: Documentation and Slice Verification

- [x] 4.1 **FOUND-005** Add `docs/05-modules/branding.md` documenting neutral
      `CoreDesignDefaults` and deferred `Clinical Precision` preset; verify no
      tenant resolution or arbitrary CSS/JS path exists.
- [x] 4.2 **FOUND-006** Run each completed slice’s focused command plus
      `pnpm lint && pnpm format-check && pnpm typecheck && pnpm test && pnpm build`;
      document results and rollback boundary in work-unit commit `b63d29c`.
