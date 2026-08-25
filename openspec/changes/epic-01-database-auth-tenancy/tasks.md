# Tasks: EPIC-01 Database / Auth / Tenancy

## Review Workload Forecast

| Field                               | Value                                                        |
| ----------------------------------- | ------------------------------------------------------------ |
| Estimated changed lines (aggregate) | ~5100                                                        |
| 400-line budget risk (aggregate)    | High                                                         |
| Chained PRs recommended             | Yes                                                          |
| Suggested split                     | 18 work units U1–U18 → chained PRs PR1…PR18, each ≤400 lines |
| Delivery strategy                   | ask-always (session)                                         |
| Chain strategy                      | pending                                                      |

Decision needed before apply: Yes Chained PRs recommended: Yes Chain strategy:
pending 400-line budget risk: High

Aggregate exceeds 400 lines. **Units are sized so EACH stays ≤400 estimated
changed lines**; two units (2.4, 4.3) sit near the ceiling and carry an explicit
mid-apply split contingency. Ask the user for chain strategy before `sdd-apply`
starts.

### Suggested Work Units

| Unit          | Goal (slice)                                  | Likely PR | Focused test command                           | Runtime harness                                       | Rollback boundary                |
| ------------- | --------------------------------------------- | --------- | ---------------------------------------------- | ----------------------------------------------------- | -------------------------------- |
| U1 (1.1–1.3)  | Governance docs + TD record                   | PR 1      | `pnpm format-check`                            | N/A — docs only                                       | Revert commit                    |
| U2 (2.1)      | DB package, PrismaService, CI gate (S1)       | PR 2      | `pnpm test --filter @newsaas/database`         | `DATABASE_URL_TEST` fresh PG, `prisma migrate deploy` | Revert; drop dev volume          |
| U3 (2.2)      | Identity tables migration (S1)                | PR 3      | conventions vitest in database pkg             | migrate deploy on empty test DB                       | Revert; reset DB                 |
| U4 (2.3)      | Tenancy + inert scaffolding tables (S1)       | PR 4      | schema-inventory tests                         | migrate deploy                                        | Revert; reset DB                 |
| U5 (2.4)      | RBAC/entitlement/audit tables (S1)            | PR 5      | conventions re-run                             | migrate deploy                                        | Revert; reset DB                 |
| U6 (3.1)      | Error registry (S2)                           | PR 6      | `pnpm test --filter @newsaas/shared`           | N/A — pure contract pkg                               | Revert                           |
| U7 (3.2)      | Exception filter + request-id (S2)            | PR 7      | `pnpm test --filter @newsaas/api`              | supertest against bootstrapped app                    | Revert                           |
| U8 (3.3)      | pino structured logging (S2)                  | PR 8      | `pnpm lint && pnpm test --filter @newsaas/api` | log-line assertions via app logs                      | Revert                           |
| U9 (3.4)      | `/health/ready` (S2)                          | PR 9      | `pnpm test --filter @newsaas/api`              | compose PG+Redis up/down toggle                       | Revert                           |
| U10 (4.1)     | RequestContext ALS (S3)                       | PR 10     | context service unit tests                     | async propagation tests                               | Revert                           |
| U11 (4.2)     | Credentials + sessions core (S3)              | PR 11     | `pnpm test --filter @newsaas/api`              | test DB via harness-lite                              | Revert; drop sessions table data |
| U12 (4.3)     | Auth routes/guards/cookie (S3)                | PR 12     | auth integration suite                         | supertest + test DB                                   | Revert                           |
| U13 (4.4)     | Login rate limiter (S3)                       | PR 13     | rate-limit suite                               | in-process window tests                               | Revert                           |
| U14 (5.1)     | TenantActiveGuard + membership repo (S4)      | PR 14     | tenancy repo tests                             | test DB                                               | Revert                           |
| U15 (5.2)     | Isolation harness (S4)                        | PR 15     | harness self-test                              | dedicated `DATABASE_URL_TEST` boot                    | Revert                           |
| U16 (5.3)     | Cross-tenant 404 suite + fences (S4)          | PR 16     | full isolation suite in CI                     | harness from U15                                      | Revert                           |
| U17 (6.1)     | Reference seed + CI probe (S5)                | PR 17     | seed idempotency probe                         | CI double-run count equality                          | Revert                           |
| U18 (6.2–7.1) | Demo seed; audit writer; entitlements (S5+S6) | PR 18     | demo-guard + writer + truth-table suites       | guarded CLI runs                                      | Revert                           |

Note: U18 merges design S5-demo-seed remainder with S6 (audit + `has()`) to keep
both under budget; slice order and verification content unchanged.

## Phase 1: Governance & Docs (before any code)

- [x] 1.1 Create `docs/01-roadmap/EPIC-01-Database-Auth-Tenancy.md` —
      frontmatter per DOCUMENTATION-RULES (`id: EPIC-01`, `type: epic`,
      `status: in-progress`, `priority: critical`, `depends_on: [EPIC-00]`,
      `prd_sections: ["5","7","8","9","10","28","29","30","36","41","42"]`,
      dates 2026-08-24); sections per `_templates/EPIC.md`; Stories mapped to
      slices: DAT-001 persistence (S1), DAT-002 API contract (S2), DAT-003
      identity (S3), DAT-004 tenancy (S4), DAT-005 seeds (S5), DAT-006
      audit+entitlements (S6). Verify: `pnpm format-check`. Deps: none.
- [x] 1.2 Flip EPIC-01 row `planned→in-progress` in
      `docs/01-roadmap/ROADMAP.md`. Verify: grep row + `pnpm format-check`.
      Deps: 1.1.
- [x] 1.3 Create `docs/08-tech-debt/TD-004-password-reset-deferred.md` per
      `_templates/TECH-DEBT.md`: password reset/forgot-password absent, blocked
      on EPIC-17 email delivery; ops workaround (direct DB hash update by ops);
      linked from epic Technical Debt section; satisfies identity-staff-auth
      "Password recovery explicitly deferred". Verify: `pnpm format-check`.
      Deps: 1.1.

## Phase 2: Slice S1 — Persistence Foundation

- [x] 2.1 Create `packages/database` (`package.json` as `@newsaas/database`,
      `tsconfig.json`, `.gitignore` for `src/generated/`);
      `prisma/schema.prisma` (Prisma 6.x pinned, `prisma-client-js`, output
      `src/generated`); `src/prisma.service.ts` (`extends PrismaClient`,
      `$connect` onModuleInit, `$disconnect` onApplicationShutdown),
      `src/index.ts`; global provider wired in `apps/api/src/app.module.ts`;
      scripts `db:generate/db:migrate/db:deploy/db:seed`; CI job `migrations` in
      `.github/workflows/ci.yml` (PG16 service container, `migrate deploy` on
      empty DB, required gate). Tests: single shared instance; graceful-shutdown
      disconnect. Verify:
      `pnpm test --filter @newsaas/database && pnpm typecheck`. Est ≤340 lines.
      Deps: none.
- [x] 2.2 Migration 001 — identity tables `user_profile` (email UNIQUE
      app-lowercased, global), `user_credential` (PK=profile_id FK RESTRICT,
      password_hash RESTRICTED), `staff_session` (token_hash UNIQUE,
      idle/absolute expires, revoked_at, idx profile_id, FK CASCADE); snake_case
      via `@@map`/`@map`, uuid `gen_random_uuid()`, timestamptz UTC. Add
      conventions check test (UUID PKs, UTC timestamps, float-money rejection
      guard). Verify: `prisma migrate deploy` on fresh `DATABASE_URL_TEST` +
      conventions vitest. Est ≤260. Deps: 2.1.
- [x] 2.3 Migration 002 — `tenant` (slug UNIQUE), `branch` (tenant_id FK
      RESTRICT, schema-only), `tenant_membership`
      (UNIQUE(tenant_id,user_profile_id), role FK, status ACTIVE|SUSPENDED),
      `customer_portal_access` (inert scaffold). Tests: inventory presence, FK
      semantics, inert-surface note (route-enumeration proof lands in 5.3).
      Verify: migrate deploy + vitest. Est ≤300. Deps: 2.2.
- [x] 2.4 Migration 003 — `role`(code UNIQUE ×6), `permission`(key UNIQUE),
      `role_permission`, `feature_code`(code UNIQUE ×12), `plan`,
      `plan_capability`, `tenant_entitlement`
      (UNIQUE(tenant_id,feature_code_id)), `audit_log` (per D9 shape,
      INDEX(tenant_id, created_at DESC)). Conventions re-run. **Contingency:**
      if diff >400 at PR time, split migration 003 into 003 RBAC + 004
      entitlements/audit before opening PR. Verify: migrate deploy + conventions
      vitest. Est ~430 → Medium. Deps: 2.3.

## Phase 3: Slice S2 — API Contract Baseline

- [x] 3.1 Create `packages/shared/src/errors/{registry.ts,domain-error.ts}`:
      frozen `ERROR_CODES` map (VALIDATION_FAILED·400, UNAUTHENTICATED·401,
      FORBIDDEN·403, NOT_FOUND·404, CONFLICT·409, RATE_LIMITED·429,
      INTERNAL·500), framework-free `DomainError`; export via
      `packages/shared/src/index.ts`. Snapshot contract test pinning
      codes↔statuses. Verify: `pnpm test --filter @newsaas/shared`. Est ≤150.
      Deps: none (parallelizable with Phase 2).
- [x] 3.2 Global exception filter
      `apps/api/src/common/filters/global-exception.filter.ts` emitting
      `{error:{code,message,requestId}}`; zod failures→VALIDATION_FAILED
      (flattened issue message); DomainError→registry status; unknown→INTERNAL,
      stacks suppressed outside development. Fastify `genReqId`: honor valid
      inbound `X-Request-Id` (trimmed ≤128 printable ASCII) else
      `crypto.randomUUID()`; always echo response header. Wire in
      `apps/api/src/main.ts`. Tests: validation shape, unhandled-exception shape
      (prod mode), inbound-ID end-to-end, deterministic DomainError mapping.
      Verify: `pnpm test --filter @newsaas/api`. Est ≤290. Deps: 3.1.
- [x] 3.3 Pin `pino` direct dep; `FastifyAdapter({ loggerInstance })` in
      main.ts; redact `req.headers.cookie`, `*.password`, `*.passwordHash`;
      child logger binds `req.id`; replace `console.*` in API bootstrap. Test:
      every log line for a sample request carries request ID. Verify:
      `pnpm lint && pnpm test --filter @newsaas/api`. Est ≤150. Deps: 3.2.
- [x] 3.4 Extend `apps/api/src/health/` with `/health/ready`: aggregate Prisma
      `$queryRaw` ping + Redis ping (add `ioredis` dep — approved stack client);
      503 while any dependency unreachable; `/health/live` stays 200. Tests:
      healthy 200; Redis-down ⇒ ready 503/live 200. Verify:
      `pnpm services:up && pnpm preflight && pnpm test --filter @newsaas/api`.
      Est ≤190. Deps: 2.1.

## Phase 4: Slice S3 — Staff Auth

- [x] 4.1 RequestContext plumbing: `RequestContext` type in
      `packages/shared/src/context.ts`; AsyncLocalStorage-backed
      `RequestContextService`
      (`apps/api/src/context/request-context.service.ts`) carrying
      requestId/userProfileId/tenantId?/membershipId?/roleCode?; ALS-entering
      middleware registered for all routes after genReqId. Unit tests incl.
      async-boundary propagation. Verify: `pnpm test --filter @newsaas/api`. Est
      ≤170. Deps: 3.2.
- [x] 4.2 Credential+session core (no HTTP): argon2id hashing service (m=19456
      KiB,t=2,p=1, env-tunable; add `argon2` dep); credentials store never
      selected by app reads except login verification; session service —
      `randomBytes(32)` base64url token, SHA-256 at rest, insert-per-login
      rotation, idle 2h rolling (refresh when >60s stale), absolute 12h, env
      TTLs, hard-delete revoke. Tests: hashed at rest (no plaintext), token
      stored hashed, rotation inserts fresh row, TTL computation. Verify:
      `pnpm test --filter @newsaas/api`. Est ≤330. Deps: 2.2.
- [x] 4.3 Auth surface + guards: `POST /api/v1/auth/login`,
      `POST /api/v1/auth/logout`, `GET /api/v1/auth/me`; cookie
      `ns_staff_session` HttpOnly, Path=/, Secure unless development,
      SameSite=Lax; logout hard-deletes row. Global `AuthGuard` validating
      session→populates RequestContext; `@Public` opts out `/health*`,
      `/auth/login`; private routes reject 401 envelope pre-handler. Context
      probe assertion: `/auth/me` reflects server-derived session/membership,
      ignores client-sent identity fields. Uniform 401 invalid-credentials
      without email-existence leak. Password-reset absence case (any recovery
      route ⇒ 404 envelope). Log/response scan: no password or hash material.
      Cookie-flag assertions on Set-Cookie. **Contingency:** if diff >400, split
      into 4.3a routes/cookie + 4.3b guards/probe. Verify:
      `pnpm test --filter @newsaas/api`. Est ~430 → Medium. Deps: 4.1, 4.2, 3.3.
      **OUTCOME NOTE:** Shipped routes are UNPREFIXED `/auth/login`,
      `/auth/logout`, `/auth/me` — not the `/api/v1/auth/*` paths written above:
      design D3 wire order (`@Public` opt-outs name `/health*`, `/auth/login`)
      and both delta specs pin the unprefixed paths. The PRD §28 `/api/v1` base
      is consciously deferred to the API-versioning slice; recorded in
      `docs/07-decisions/DEC-002-api-route-prefix-convention.md` ([[DEC-002]],
      proposed — maintainer gate pending). Checkbox stays ticked: acceptance
      criteria were verified against the shipped paths.
- [x] 4.4 Login rate limiter: in-process sliding window ≥10 failed logins/15min
      per (email, IP-hash) ⇒ 429 envelope RATE_LIMITED; success resets counter.
      Tests: threshold trip, reset-on-success, envelope shape. Verify:
      `pnpm test --filter @newsaas/api`. Est ≤150. Deps: 4.3.

## Phase 5: Slice S4 — Tenancy Core

- [x] 5.1 `TenantActiveGuard` (skips `@Public` + `/auth/*`; requires ACTIVE
      membership else 403 FORBIDDEN envelope) wired after AuthGuard; tenant-safe
      `TenantMembershipRepository` taking `RequestContextService`, implicit
      `where:{tenantId: ctx.requiredTenantId()}`, zero rows ⇒
      `DomainError("NOT_FOUND")`; write path fails not-found cross-tenant.
      Repo-level tests: implicit scoping observable rows; cross-tenant write
      prevented. Verify: `pnpm test --filter @newsaas/api`. Est ≤310. Deps: 2.3,
      4.1.
- [x] 5.2 Isolation harness (first-class):
      `apps/api/test/support/{boot-test-app.ts,seed-two-tenants.ts,expect-cross-tenant-404.ts}`
      — dedicated `DATABASE_URL_TEST` with migrate deploy; seeds two
      tenants/profiles/memberships/sessions→cookies; helper asserts
      byte-equivalent 404 bodies (nonexistent vs foreign). Harness self-test
      spec proving boot + dual-context isolation. Verify:
      `pnpm test --filter @newsaas/api` (support specs included). Est ≤260.
      Deps: 4.3, 2.3. **OUTCOME NOTE:** The harness boots the REAL AppModule
      over the REAL Fastify adapter factory (production guard chain) but binds
      `PrismaService` to a structural in-memory boundary fake
      (`test/support/in-memory-database.ts`) instead of a live
      `DATABASE_URL_TEST` PostgreSQL — matching the seam proven by the Batch 4
      auth integration suite (PrismaClient is a Proxy; structural stub is
      indistinguishable to consumers). Real-PG schema behavior stays covered by
      the CI `migrations` job (`migrate deploy` on fresh PG16); the quality job
      runs the isolation suites without a PG service dependency. Byte-equivalent
      404 assertion pins one inbound `X-Request-Id` across probes so envelope
      texts are truly byte-equal (D7 adoption proof included).
- [x] 5.3 Cross-tenant integration suite using harness — one case per shipped
      private aggregate (TenantMembership): foreign UUID⇒404 envelope;
      nonexistent-vs-foreign byte-equivalence; body/query/header Tenant-B hint
      ignored (scoping stays Tenant A); no tenant-creation route exists
      (registration attempt ⇒ 404 envelope); no Role/Permission CRUD route
      exists; authorization relies only on authentication+membership (records
      inert); Branch/CustomerPortalAccess touched by no route/service. Suite
      runs in CI quality job. Verify: `pnpm test --filter @newsaas/api` + CI run
      green. Est ≤220. Deps: 5.1, 5.2.

## Phase 6: Slice S5 — Seeds

- [x] 6.1 Reference seed `packages/database/prisma/seed.ts` + `db:seed`: upserts
      by natural keys — 6 roles, PRD §9 `domain.resource.action` permission set,
      12 §10 feature codes, one inert `starter` plan mapped to all codes via
      plan_capability; no automatic grants. Key-format validation test
      (permission keys match pattern). CI probe: run seed twice, assert count
      equality. Verify: `pnpm --filter @newsaas/database db:seed` twice + CI
      migrations job green. Est ≤320. Deps: 2.4.
- [x] 6.2 Guarded demo tenant seed extending `.opencode/commands/demo-seed.ts`
      (reuse `ENABLE_DEMO_SEED` opt-in + production refusal): creates demo
      tenant, owner profile/credential/membership, explicit grants. Extend
      `packages/shared/src/demo-seed.test.ts`: flag unset ⇒ nothing created;
      production+flag ⇒ explicit refusal, nothing created. Verify:
      `pnpm test --filter @newsaas/shared`. Est ≤190. Deps: 6.1, 5.1 (membership
      shape). **OUTCOME NOTE:** Guard + data logic live in
      `packages/database/src/demo-seed.ts` (lint/typecheck/unit-tested); the
      `.opencode` CLI resolves the guard inline via import and delegates the
      real data path to `prisma/demo-seed.ts` (PrismaClient + argon2,
      devDependency) — single source of truth, instant disabled/refused exits.
      Refusal is fail-safe: unset/exotic NODE_ENV counts as production. Shared
      suite extended to 5 cases incl. production-refusal and enabled-
      without-DATABASE_URL failsafe; the old "enabled exits 0" case is
      superseded by the real data path (documented here per scope control). Demo
      grants derive from `FEATURE_CODE_SEEDS`; credential hashed with the same
      OWASP-floor argon2id parameters as design D4.

## Phase 7: Slice S6 — Audit & Entitlements Boundary

- [x] 7.1 `AuditWriter` (`apps/api/src/audit/audit-writer.service.ts`) exposing
      `append()` ONLY — no update/delete methods exist; fills actor_type
      STAFF|SYSTEM, action "domain.event", targets, sanitized metadata jsonb,
      requestId from context. `EntitlementsService.has(tenantId, featureCode)`
      (`apps/api/src/entitlements/entitlements.service.ts`): direct query over
      `tenant_entitlement`+`feature_code`; unknown code ⇒ false without
      throwing; no UI/caching. Tests: append-then-read integrity; absence of
      mutation paths (type-level + runtime enumeration); truth-table — granted
      known true, ungranted known false, unknown false. Verify:
      `pnpm test --filter @newsaas/api`. Est ≤330. Deps: 2.4, 6.1. **OUTCOME
      NOTE:** DI uses explicit `@Inject(PrismaService)` tokens with narrow
      structural param types — the append-only/read-only contracts are
      unreachable-beyond by construction and fakes plug in without casts.
      Metadata is JSON-safe validated (cycles/non-JSON rejected pre-write).
      AuthService emits `auth.login_succeeded` / `auth.login_failed`
      audit-or-nothing (append failure fails the operation); failed attempts
      attributed STAFF when the email exists, SYSTEM otherwise; rate-limited
      attempts append NOTHING (flood defense). Wiring proven over real HTTP in
      `src/audit/audit.integration.test.ts`; container wiring + plan≠grant
      precedence proven against the REAL AppModule via bootTestApp in
      `src/audit/audit-entitlements.integration.test.ts`.

## Phase 8: Final Verification & Docs Sync

- [x] 8.1 Full gates:
      `pnpm lint && pnpm format-check && pnpm typecheck && pnpm test && pnpm build`;
      services preflight `pnpm services:up && pnpm preflight`; confirm isolation
      suite executed in CI run; tick epic acceptance criteria + `updated` dates
      in EPIC-01 file; docs atomicity sweep (module docs for new domains if any
      behavior documented). Deps: all prior. **OUTCOME NOTE:** All five root
      gates executed green in the final apply batch (exit 0 each; per-package
      suites: shared 5 CLI-contract + database 11 demo-seed cases, api 165).
      Docker/preflight and the CI-run confirmation are deferred to the
      maintainer push flow (apply batch is forbidden from docker/push); EPIC-01
      Exit Criteria stay open accordingly and epic status remains `in-progress`.
      Acceptance criteria ticked with evidence pointers; Known Limitations
      section records [[TD-004]]/[[TD-005]]/[[TD-006]], rate-limiter
      distributed-spray note and [[DEC-002]] pending acceptance. Docs atomicity
      sweep shipped module docs:
      `docs/05-modules/{Identity-Sessions,Tenancy,Audit-Entitlements,Api-Contract-Baseline}.md`.
      Transport-security orphan closure (CORS allowlist deny-by-default +
      security headers incl. gated HSTS) landed natively in
      `fastify-adapter.factory.ts` with wiring-proof tests — no new runtime
      dependency.

## Scenario Traceability (46 scenarios — zero orphans)

| #   | Spec / Requirement                         | Scenario                                     | Owner task(s)       |
| --- | ------------------------------------------ | -------------------------------------------- | ------------------- |
| 1   | api-contract / Uniform error envelope      | Validation failure shape                     | 3.2                 |
| 2   | api-contract / Uniform error envelope      | Unhandled exception shape                    | 3.2                 |
| 3   | api-contract / Stable error code registry  | Known domain error maps deterministically    | 3.2                 |
| 4   | api-contract / Stable error code registry  | Registry snapshot stability                  | 3.1                 |
| 5   | api-contract / Request ID + sanitized logs | Inbound request ID honored end to end        | 3.2                 |
| 6   | api-contract / Request ID + sanitized logs | Credentials never logged                     | 4.3 (config: 3.3)   |
| 7   | api-contract / Health probes               | Dependencies healthy                         | 3.4                 |
| 8   | api-contract / Health probes               | Dependency down                              | 3.4                 |
| 9   | api-contract / Transport security          | Login rate limited                           | 4.4                 |
| 10  | api-contract / Transport security          | Cookie flags enforced                        | 4.3                 |
| 11  | persistence / Client lifecycle             | Single shared instance                       | 2.1                 |
| 12  | persistence / Client lifecycle             | Graceful shutdown disconnects                | 2.1                 |
| 13  | persistence / Migrations gate in CI        | Clean apply on fresh database                | 2.1 (+2.2–2.4)      |
| 14  | persistence / Migrations gate in CI        | Broken migration fails the gate              | 2.1                 |
| 15  | persistence / Schema conventions           | Conventions hold on new tables               | 2.2 (+2.4)          |
| 16  | persistence / Schema conventions           | Floating point money rejected                | 2.2                 |
| 17  | persistence / Schema inventory             | Schema-only surfaces stay inert              | 2.3 (proof: 5.3)    |
| 18  | persistence / Schema inventory             | Staff identity tables are tenant-scoped      | 2.3, 5.3            |
| 19  | persistence / Audit scaffolding            | Audit record written and readable            | 7.1                 |
| 20  | persistence / Audit scaffolding            | No mutation path                             | 7.1                 |
| 21  | identity / Argon2id storage                | Hashed at rest                               | 4.2                 |
| 22  | identity / Argon2id storage                | No credential material in responses          | 4.3                 |
| 23  | identity / Login + PG sessions             | Successful login establishes a session       | 4.3 (core: 4.2)     |
| 24  | identity / Login + PG sessions             | Invalid credentials rejected uniformly       | 4.3                 |
| 25  | identity / Cookie semantics + logout       | Logout revokes server-side session           | 4.3                 |
| 26  | identity / Cookie semantics + logout       | Cookie hardening on session issue            | 4.3                 |
| 27  | identity / Guard + RequestContext          | Unauthenticated access blocked               | 4.3                 |
| 28  | identity / Guard + RequestContext          | Context derived server-side only             | 4.3 (plumbing: 4.1) |
| 29  | identity / Recovery deferred               | Recovery endpoints absent                    | 4.3 (record: 1.3)   |
| 30  | tenancy / Server-authoritative resolution  | Client-supplied tenant hint ignored          | 5.3                 |
| 31  | tenancy / Server-authoritative resolution  | No membership, no tenant authority           | 5.1                 |
| 32  | tenancy / Cross-tenant 404                 | Foreign resource masked as missing           | 5.3                 |
| 33  | tenancy / Cross-tenant 404                 | Nonexistent versus foreign indistinguishable | 5.3 (helper: 5.2)   |
| 34  | tenancy / Repository pattern               | Implicit tenant scoping                      | 5.1                 |
| 35  | tenancy / Repository pattern               | Cross-tenant write prevented                 | 5.1 (API: 5.3)      |
| 36  | tenancy / Mandatory isolation tests        | Isolation suite per aggregate                | 5.3 (harness: 5.2)  |
| 37  | tenancy / Mandatory isolation tests        | Regression caught                            | 5.3                 |
| 38  | tenancy / No self-service creation         | Registration endpoint absent                 | 5.3                 |
| 39  | rbac-seed / Idempotent reference seed      | Seed rerun safe                              | 6.1                 |
| 40  | rbac-seed / Idempotent reference seed      | Permission key convention                    | 6.1                 |
| 41  | rbac-seed / Entitlements boundary          | Grant checked through boundary               | 7.1                 |
| 42  | rbac-seed / Entitlements boundary          | Unknown feature code                         | 7.1                 |
| 43  | rbac-seed / Guarded demo seed              | Demo seed opt-in only                        | 6.2                 |
| 44  | rbac-seed / Guarded demo seed              | Production refused                           | 6.2                 |
| 45  | rbac-seed / RBAC scope fence               | No role administration surface               | 5.3                 |
| 46  | rbac-seed / RBAC scope fence               | Records exist inertly                        | 5.3                 |
