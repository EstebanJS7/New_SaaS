---
id: EPIC-01
type: epic
title: Database, Auth and Tenancy
status: done
priority: critical
depends_on:
  - EPIC-00
prd_sections:
  - "5"
  - "7"
  - "8"
  - "9"
  - "10"
  - "28"
  - "29"
  - "30"
  - "36"
  - "41"
  - "42"
created: 2026-08-24
updated: 2026-08-25
---

# EPIC-01 — Database, Auth and Tenancy

## Objective

Make NewSaaS persistently multi-tenant: Prisma/PostgreSQL persistence bootstrap,
server-authoritative tenant context on every private route, first-party staff
auth with revocable PostgreSQL sessions, and proven cross-tenant `404`
isolation. Unblocks [[EPIC-02]] (RBAC/Entitlements) and EPIC-03 Phase B.

## Scope

- `packages/database`: Prisma schema and migrations for `Tenant`, `Branch`
  (schema-only), `UserProfile`, `UserCredentials`, `StaffSession`,
  `TenantMembership`, `Role`, `Permission`, `FeatureCode`, `TenantEntitlement`,
  `AuditLog`, and `CustomerPortalAccess` (scaffolding);
- first-party email+password staff auth with argon2id hashing;
- PostgreSQL-backed revocable sessions, httpOnly/secure/sameSite cookies, login
  rate limits (PRD §29);
- server-side tenant resolution from session membership (PRD §7), RequestContext
  plumbing, tenant-safe repositories returning `404` on cross-tenant access;
- idempotent reference seeds: 6 PRD §9 roles, `domain.resource.action`
  permission records, 12 §10 feature codes, flat tenant grants, typed
  `EntitlementsService.has()` boundary;
- API contract/security baseline: `{error:{code,message,requestId}}` envelope,
  request-id structured logs, `/health/ready`, CORS/security-header defaults
  (PRD §§28–30);
- guarded synthetic demo seed (PRD §42); ops-created tenants only.

## Out of Scope

- password-reset flows — deferred with an explicit Tech Debt record ([[TD-004]];
  blocked on EPIC-17 email delivery);
- self-service tenant registration;
- portal auth flows;
- full RBAC policy engine/UI (EPIC-02);
- branding Phase B coupling;
- branch business logic beyond schema.

## Acceptance Criteria

- [x] Cross-tenant UUID access returns `404`, covered by automated isolation
      tests per shipped private aggregate (PRD §7). — Evidence:
      `apps/api/test/cross-tenant-isolation.e2e-spec.ts` (10 cases over real
      HTTP) + `apps/api/test/support/` isolation harness.
- [x] Private routes reject unauthenticated requests; tenant authority derives
      solely from authenticated server-side context (PRD §§7/29). — Evidence:
      guard chain in `apps/api/src/auth/auth.guard.ts` +
      `apps/api/src/tenancy/tenant-active.guard.ts`; hint-fencing cases in the
      isolation suite.
- [x] Every API error matches `{error:{code,message,requestId}}` (PRD §28). —
      Evidence: `apps/api/src/common/filters/global-exception.filter.ts` +
      error-envelope integration tests; frozen registry in
      `packages/shared/src/errors/registry.ts`.
- [x] Structured logs carry the request ID; credentials are never logged (PRD
      §§30/41). — Evidence: pino wiring `apps/api/src/common/http/` + leak-scan
      cases in `auth.integration.test.ts`.
- [x] Migrations apply cleanly in CI against fresh PostgreSQL. — Evidence:
      `.github/workflows/ci.yml` `migrations` job (`migrate deploy` on empty
      PG16 + seed double-run count probe); migrations under
      `packages/database/prisma/migrations/`.
- [x] Reference seed is idempotent; demo seed is explicitly gated and
      production-guarded (PRD §42). — Evidence:
      `packages/database/src/reference-seed.ts` (+ idempotency tests); guarded
      CLI `.opencode/commands/demo-seed.ts` delegating to
      `packages/database/src/demo-seed.ts`; opt-in/refusal contract tests in
      `packages/shared/src/demo-seed.test.ts`.

## Stories

- DAT-001 Persistence foundation (Slice S1) — database package, PrismaService
  lifecycle, CI migration gate.
- DAT-002 API contract baseline (Slice S2) — error registry/envelope, request-id
  logging, `/health/ready`.
- DAT-003 Staff identity (Slice S3) — argon2id credentials, PG sessions,
  login/logout/me, RequestContext guard.
- DAT-004 Tenancy core (Slice S4) — tenant/membership binding, tenant-safe
  repositories, cross-tenant `404` isolation suite.
- DAT-005 Seeds (Slice S5) — idempotent reference seed, guarded demo seed.
- DAT-006 Audit + entitlements (Slice S6) — append-only `AuditLog` writer,
  `EntitlementsService.has()` boundary.

## Dependencies

- [[EPIC-00 Foundation]] runtime: Compose PostgreSQL/Redis with a validated
  `DATABASE_URL`.
- One new dependency approved in the change proposal: an argon2 hashing library
  (credential-storage requirement unmet by the current stack).

## Exit Criteria

- [ ] Lint/typecheck/tests/build required for the Epic are green.
- [ ] Cross-tenant isolation suite executes in a CI run.
- [ ] Documentation is current.

## Known Limitations

- [[TD-004]] — password reset/forgot-password deferred until email delivery
  (EPIC-17); any recovery route returns a `404` envelope meanwhile.
- [[TD-005]] — login rate limiter is single-replica by design (in-process
  sliding window); a shared-store revision is required before horizontal scaling
  because per-replica counters allow a distributed spray across replicas to
  bypass the threshold.
- [[TD-006]] — tenant-isolation suites run over an in-memory Prisma boundary;
  live-PostgreSQL execution lands in the CI migrations job before further
  tenant-scoped aggregates.
- [[DEC-002]] — shipped auth routes are UNPREFIXED (`/auth/*`), deferring the
  PRD §28 `/api/v1` base to the API-versioning slice; decision proposed,
  maintainer acceptance pending.

## Decisions / ADRs

Decisions are recorded in the change design
(`openspec/changes/epic-01-database-auth-tenancy/design.md`): first-party
email+password auth needs no ADR inside the frozen stack; no self-registration
endpoint; branches and portal identity stay schema-only; sessions persist in
PostgreSQL; account-recovery deferral is tracked as Tech Debt, never silent.

## Technical Debt

Tracked in the Known Limitations section above: [[TD-004]], [[TD-005]],
[[TD-006]].

## Related

- [[ENGINEERING RULES]]
- [[PRD]] — sections §§5, 7–10, 28–30, 36, 41–42.
