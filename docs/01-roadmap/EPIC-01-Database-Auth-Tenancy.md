---
id: EPIC-01
type: epic
title: Database, Auth and Tenancy
status: in-progress
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
updated: 2026-08-24
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

- [ ] Cross-tenant UUID access returns `404`, covered by automated isolation
      tests per shipped private aggregate (PRD §7).
- [ ] Private routes reject unauthenticated requests; tenant authority derives
      solely from authenticated server-side context (PRD §§7/29).
- [ ] Every API error matches `{error:{code,message,requestId}}` (PRD §28).
- [ ] Structured logs carry the request ID; credentials are never logged (PRD
      §§30/41).
- [ ] Migrations apply cleanly in CI against fresh PostgreSQL.
- [ ] Reference seed is idempotent; demo seed is explicitly gated and
      production-guarded (PRD §42).

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

## Decisions / ADRs

Decisions are recorded in the change design
(`openspec/changes/epic-01-database-auth-tenancy/design.md`): first-party
email+password auth needs no ADR inside the frozen stack; no self-registration
endpoint; branches and portal identity stay schema-only; sessions persist in
PostgreSQL; account-recovery deferral is tracked as Tech Debt, never silent.

## Technical Debt

- [[TD-004]] — password reset/forgot-password deferred until email delivery
  (EPIC-17).
- [[TD-005]] — login rate limiter is single-replica by design; shared-store
  revision required before any horizontal scaling.

## Related

- [[ENGINEERING RULES]]
- [[PRD]] — sections §§5, 7–10, 28–30, 36, 41–42.
