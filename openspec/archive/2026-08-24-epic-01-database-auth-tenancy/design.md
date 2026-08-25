# Design: EPIC-01 Database / Auth / Tenancy

Server-authoritative tenancy over first-party staff sessions: Prisma foundation
→ API contract baseline → auth → tenant enforcement → seeds →
audit/entitlements. Bound by maintainer decisions (2026-08-24), DEC-001, stack
freeze. Traces cite spec requirement slugs.

## D1 — Prisma Bootstrap

Traces: [lifecycle] [ci-gate] [conventions]

| Aspect         | Decision                                                                                                                                                                                             |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Layout         | New `packages/database`: `prisma/schema.prisma`, `prisma/migrations/`, `prisma/seed.ts`, `src/index.ts` (public exports), `src/generated/` (gitignored)                                              |
| Version        | Prisma 6.x pinned; `prisma-client-js`; client output `src/generated`                                                                                                                                 |
| Lifecycle      | `PrismaService extends PrismaClient`: `$connect` on `onModuleInit`, `$disconnect` on `onApplicationShutdown`; `@Global` provider in AppModule; modules inject, never construct [lifecycle]           |
| Local workflow | Scripts `db:generate` / `db:migrate` (dev) / `db:deploy` / `db:seed`; shadow DB auto-created (compose user holds CREATEDB) — no extra config                                                         |
| CI gate        | New `migrations` job: PG16 service container → `migrate deploy` on empty DB → reference seed ×2 with count-equality probe; red gate blocks merge [ci-gate]. `migrate deploy` never needs a shadow DB |

## D2 — Schema Shape

Traces: [inventory] [conventions] [rbac-fence] [entitlements]

Conventions: snake_case tables/columns via `@@map`/`@map`; PascalCase singular
models; `id` uuid default `gen_random_uuid()`; `created_at`/`updated_at`
timestamptz UTC; no float money columns (none needed this epic).

| Table                                                      | Keys / indexes                                                                                           | Notes                                                                                        |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| user_profile                                               | `email` UNIQUE (app-lowercased), display_name, status                                                    | global person; email uniqueness is GLOBAL (login resolves profile, memberships bind tenants) |
| user_credential                                            | PK = user_profile_id (1:1 FK RESTRICT), password_hash                                                    | RESTRICTED; never selected by app reads                                                      |
| staff_session                                              | `token_hash` UNIQUE, last_seen_at, idle_expires_at, absolute_expires_at, revoked_at; idx user_profile_id | FK CASCADE from profile                                                                      |
| tenant                                                     | `slug` UNIQUE, name                                                                                      | ops/seed created only                                                                        |
| branch                                                     | tenant_id FK RESTRICT, name                                                                              | schema-only, inert                                                                           |
| tenant_membership                                          | UNIQUE(tenant_id, user_profile_id), role_id FK RESTRICT, status ACTIVE\|SUSPENDED                        | demonstrates repo pattern                                                                    |
| role / permission / role_permission                        | role.code UNIQUE (6), permission.key UNIQUE `domain.resource.action`, pair UNIQUE                        | inert seed records [rbac-fence]                                                              |
| feature_code / plan / plan_capability / tenant_entitlement | feature_code.code UNIQUE (12), plan.code UNIQUE, pair UNIQUEs, grant UNIQUE(tenant_id, feature_code_id)  | [entitlements]                                                                               |
| customer_portal_access                                     | tenant_id FK, contact_email (INTERNAL), status                                                           | inert scaffold; FKs finalized when customers domain lands                                    |
| audit_log                                                  | see D9                                                                                                   | append-only                                                                                  |

Delete semantics: no delete endpoints exist; FKs RESTRICT everywhere except
sessions (CASCADE). Hard deletes unsupported in MVP.

## D3 — RequestContext Plumbing

Traces: [guard] [tenant-resolve] [repo-pattern]

**DECIDE AsyncLocalStorage**, wrapped in an injectable `RequestContextService`
(ALS-managed store object, enriched by guards). Pure-DI parameter passing
rejected: [repo-pattern] requires implicit tenant predicates without threading
context through every signature; raw module-global ALS rejected
(untestable/unswappable).

Carries server-derived data only: requestId, userProfileId, tenantId?,
membershipId?, roleCode?.

```ts
interface RequestContext {
  requestId: string;
  userProfileId: string;
  tenantId?: string; // from session membership only
  membershipId?: string;
  roleCode?: string;
}
```

Global wire order: Fastify `genReqId` → ALS-entering middleware (all routes) →
`AuthGuard` (validates session, populates context; `@Public` opts out
`/health*`, `/auth/login`) → `TenantActiveGuard` (skips `@Public` + `/auth/*`;
requires ACTIVE membership else 403) → handler → `ExceptionFilter`. Queue/worker
contexts out of epic scope.

## D4 — Auth Mechanics

Traces: [argon2] [login] [cookie] [transport]

| Aspect     | Decision                                                                                                                                                                                                                                   |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Hashing    | `argon2` lib (justified category), argon2id m=19456 KiB, t=2, p=1 (OWASP floor, env-tunable); hash never leaves the credentials store                                                                                                      |
| Token      | `randomBytes(32)` base64url opaque token; SHA-256 stored; lookup by hash                                                                                                                                                                   |
| Cookie     | `ns_staff_session`; HttpOnly, Path=/, Secure unless development; **SameSite=Lax**: Strict buys nothing (API is same-site fetch/XHR; ports don't affect SameSite) and breaks top-level-link arrivals; JSON-only bodies neutralize form CSRF |
| TTLs       | idle 2h rolling (last_seen_at refreshed when >60s stale), absolute 12h; `SESSION_IDLE_TTL`/`SESSION_ABSOLUTE_TTL` env; each login inserts a fresh row (rotation)                                                                           |
| Logout     | hard-delete session row; replay ⇒ 401 [cookie]                                                                                                                                                                                             |
| Rate limit | in-process sliding window: ≥10 failed logins/15min per (email, IP-hash) ⇒ 429 `RATE_LIMITED`; success resets. Valid for single-replica MVP; multi-instance revision tracked as Tech Debt                                                   |

## D5 — Tenancy Enforcement

Traces: [tenant-resolve] [404] [repo-pattern] [isolation-tests]

| Aspect              | Decision                                                                                                                                                                                                                                                               |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Guard chain         | AuthGuard → TenantActiveGuard (no ACTIVE membership ⇒ 403 `FORBIDDEN`) → permission checks deferred to EPIC-02 [rbac-fence]                                                                                                                                            |
| Repository contract | Convention, not a generic base class (engineering rules): tenant-scoped repositories take `RequestContextService`, apply `where: { tenantId: ctx.requiredTenantId() }` implicitly; demonstrated on `TenantMembership`; zero rows ⇒ `DomainError("NOT_FOUND")`          |
| 404 masking         | Foreign and nonexistent resources produce byte-equivalent 404 envelopes [404]                                                                                                                                                                                          |
| Isolation harness   | Reusable support in `apps/api/test/support`: `bootTestApp()` (dedicated `DATABASE_URL_TEST`, migrate deploy), `seedTwoTenants()` (two tenants, profiles, memberships, sessions → cookies), `expectCrossTenant404()`; one case per shipped private aggregate, run in CI |

## D6 — Error Envelope & Codes

Traces: [envelope] [registry]

Registry location: **packages/shared**, `src/errors/registry.ts` — frozen
`ERROR_CODES: Record<Code, { status }>` plus framework-free `DomainError` class,
so web consumes identical contracts. Initial codes: VALIDATION_FAILED·400,
UNAUTHENTICATED·401, FORBIDDEN·403, NOT_FOUND·404, CONFLICT·409,
RATE_LIMITED·429, INTERNAL·500. Naming: SCREAMING_SNAKE; additive-only evolution
[registry]. Global catch-all exception filter emits
`{error:{code,message,requestId}}`; zod failures map to `VALIDATION_FAILED`
(flattened issue message); unknown errors ⇒ generic INTERNAL, stacks suppressed
outside development. Snapshot contract test pins codes↔statuses.

## D7 — Logging & Request-ID

Traces: [req-id] [transport]

Reality (verified): **no logger exists today** — `console.*` only across
apps/packages (EPIC-00 shipped none). DECIDE pino: it is already Fastify's
embedded logger, pinned as a direct dependency, wired via
`FastifyAdapter({ loggerInstance })`; redact `req.headers.cookie`, `*.password`,
`*.passwordHash`; Fastify child loggers bind `req.id` to every request log
automatically. Header policy: accept inbound `X-Request-Id` when valid (trimmed,
≤128 printable-ASCII chars) else `crypto.randomUUID()`; always echo response
header `X-Request-Id` and embed in envelopes.

## D8 — Seeds & Entitlement Model

Traces: [seed-idem] [demo-guard] [entitlements] [rbac-fence]

| Aspect            | Decision                                                                                                                                                                                                                                                                 |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Reference seed    | `db:seed` upserts by natural keys (role.code, permission.key, feature_code.code, plan.code, role_permission pairs) ⇒ rerun is a no-op [seed-idem]                                                                                                                        |
| Demo seed         | Reuses existing `ENABLE_DEMO_SEED` flag + production refusal from the EPIC-00 guarded CLI pattern [demo-guard]                                                                                                                                                           |
| Entitlement model | One inert `starter` plan mapped to all 12 codes via plan_capability; no automatic grants — access stays explicit `tenant_entitlement` rows; `EntitlementsService.has(tenantId, code)` = direct query, unknown code ⇒ false without throwing; no UI, no caching this epic |

## D9 — Audit Scaffolding

Traces: [audit]

`audit_log(id, tenant_id?, actor_user_profile_id?, actor_type STAFF\|SYSTEM, action "domain.event", target_type?, target_id?, metadata jsonb (sanitized), request_id?, created_at)`;
INDEX (tenant_id, created_at DESC). Boundary: `AuditWriter` exposes `append()`
only — no update/delete methods exist to call; test proves append-then-read
integrity and absence of mutation paths. No business events wired in this epic.

## D10 — Slice Execution Order

| #   | Slice                                                                                         | Verification                                                                 | Rollback boundary                 |
| --- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | --------------------------------- |
| S1  | D1+D2 schema, PrismaService, CI migrations job                                                | CI fresh-apply + conventions green                                           | revert commit; drop dev volume    |
| S2  | D6 filter, D7 logging, `/health/ready` (PG+Redis ping)                                        | envelope contract tests; ready 503 when dependency down                      | revert commit                     |
| S3  | Credentials, sessions, login/logout/me, guards, rate limit                                    | auth integration suite; Set-Cookie flag assertions; credential-leak log scan | revert commit; sessions droppable |
| S4  | Tenant/membership/branch/portal tables, TenantActiveGuard, membership repo, isolation harness | cross-tenant 404 suite per aggregate in CI                                   | revert commit                     |
| S5  | D8 seeds + entitlement boundary                                                               | CI idempotency probe; demo-guard tests                                       | revert commit                     |
| S6  | D9 audit writer + `EntitlementsService.has()`                                                 | writer immutability test; `has()` truth-table                                | revert commit                     |

Note: S4 test fixtures insert Role rows directly (independent of S5's production
seed). All slices are additive pre-production; global rollback = revert epic
commits + `services:reset` (per proposal).

## Threat Matrix

N/A — no custom routing/shell execution, subprocess spawning, VCS/PR automation,
executable-file classification, or process-integration boundary is introduced;
seed entrypoints follow the existing guarded CLI convention and Prisma CLI is
standard tooling.

## Open Questions

None blocking.
