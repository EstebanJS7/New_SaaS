# Proposal: EPIC-01 Database / Auth / Tenancy

## Intent

Make NewSaaS persistently multi-tenant: Prisma+PostgreSQL bootstrap,
server-authoritative tenant context on every private route, first-party staff
auth with revocable sessions, and proven cross-tenant 404 isolation. Unblocks
EPIC-02 (RBAC/Entitlements) and EPIC-03 Phase B.

## Scope

### In Scope

- `packages/database`: schema+migrations — `Tenant`, `Branch` (schema-only),
  `UserProfile`, `UserCredentials`, `StaffSession`, `TenantMembership`, `Role`,
  `Permission`, `FeatureCode`, `TenantEntitlement`, `AuditLog`,
  `CustomerPortalAccess` (scaffolding).
- First-party email+password staff auth; PostgreSQL sessions;
  httpOnly/secure/sameSite cookies; login rate limits (PRD §29).
- Server-side tenant resolution from session membership (PRD §7); RequestContext
  plumbing; tenant-safe repositories returning 404 cross-tenant.
- Seeds: 6 PRD §9 roles; `domain.resource.action` permission records; 12 §10
  feature codes; flat tenant grants; `EntitlementsService.has()` boundary.
- Error envelope `{error:{code,message,requestId}}`; request-id logs;
  `/health/ready`; CORS/security-header baseline (PRD §§28–30).
- Guarded synthetic demo seed (PRD §42); ops-created tenants only.
- Epic roadmap file authored during apply.

### Out of Scope

- Password-reset flows — deferred with an explicit Tech Debt record created
  during apply (blocked on EPIC-17 email delivery).
- Self-service tenant registration; portal auth flows; full RBAC policy
  engine/UI (EPIC-02); branding Phase B coupling; branch business logic.

## Capabilities

### New Capabilities

- `persistence-foundation` — Prisma package, migrations applied in CI, client
  lifecycle, readiness health.
- `identity-staff-auth` — credential login, PG-backed revocable sessions,
  cookie/rate-limit baseline.
- `tenancy-core` — tenant authority, membership binding, tenant-safe access,
  isolation tests.
- `rbac-entitlements-seed` — role/permission/feature-code records plus typed
  `has()` boundary; no policy engine.
- `api-contract-security-baseline` — error envelope, request-id observability,
  header defaults, append-only audit scaffolding.

### Modified Capabilities

None — no existing OpenSpec capability covers these areas.

## Approach

Ordered slices, each independently verifiable:

1. **Prisma bootstrap** — `packages/database`, PrismaService, CI migration step.
2. **API contract baseline** — exception filter with stable error codes; Fastify
   `genReqId` → header + structured logs; `/health/ready`.
3. **Staff identity** — argon2id hashing (RESTRICTED-classified, never logged);
   PG sessions; login/logout/me; RequestContext guard.
4. **Tenancy core** — Tenant/Branch/TenantMembership + portal scaffolding;
   session→membership tenant authority; repository conventions; cross-tenant 404
   integration tests.
5. **Seeds** — idempotent reference seed vs `ENABLE_DEMO_SEED`-guarded demo.
6. **Audit + entitlements** — append-only `AuditLog` writer;
   `EntitlementsService.has(tenantId, code)`.

Decisions 1–6 are baked in: first-party auth needs no ADR inside the frozen
stack; no registration endpoint; branches/portal stay schema-only; sessions in
PostgreSQL; recovery deferral tracked via Tech Debt, never silent.

## Proposal question round

Resolved by maintainer (2026-08-24, authoritative):

| #   | Explore question             | Resolution                                                                    |
| --- | ---------------------------- | ----------------------------------------------------------------------------- |
| 1   | Auth mechanism within freeze | First-party email+password, server-side sessions; no managed provider, no ADR |
| 2   | Tenant provisioning          | Ops/seed-created tenants only                                                 |
| 3   | Branch timing                | Schema-only now; business logic later                                         |
| 4   | Session store                | PostgreSQL-persisted, revocable                                               |
| 5   | Account recovery             | Deferred; Tech Debt record during apply                                       |
| 6   | Portal identity              | Schema scaffolding only                                                       |

## Affected Areas

| Area                                     | Impact      | Description                                            |
| ---------------------------------------- | ----------- | ------------------------------------------------------ |
| `packages/database`                      | New         | Prisma schema, migrations, client export.              |
| `apps/api/src/**` filters/guards/modules | New         | Envelope, RequestContext, auth endpoints, seed wiring. |
| `packages/shared`                        | Modified    | Error codes, RequestContext type, feature codes.       |
| `.github/workflows/*`                    | Modified    | CI migration-application step.                         |
| `docs/01-roadmap`, `docs/02-stories`     | New (apply) | Epic/story records per PRD §§5,7–10,28–30,36,41–42.    |

## Risks

| Risk                            | Likelihood | Mitigation                                        |
| ------------------------------- | ---------- | ------------------------------------------------- |
| RBAC creep into EPIC-02         | Med        | Seed records only; engine out of scope.           |
| Broken migration passes gates   | Med        | CI applies migrations to fresh PostgreSQL.        |
| No account recovery path        | Med        | Tracked Tech Debt + ops workaround.               |
| Credential log leakage          | Med        | Classification, sanitized logging, tests.         |
| Cookie/session misconfiguration | Low        | Secure-flag integration tests; rotation on login. |

## Rollback Plan

All work is additive pre-production. Revert the epic commit(s); docs move
atomically per governance. Drop the dev database volume or run
`prisma migrate reset`; remove `packages/database`. No live tenants or business
data exist; no compensating migration needed.

## Dependencies

- EPIC-00 runtime: compose PostgreSQL/Redis, validated `DATABASE_URL`.
- One new dependency: argon2 hashing library (concrete credential-storage
  requirement unmet by current stack).

## Success Criteria

- [ ] Cross-tenant UUID access returns `404`, covered by automated isolation
      tests per shipped private aggregate (PRD §7).
- [ ] Private routes reject unauthenticated requests; tenant authority derives
      solely from authenticated server-side context (PRD §§7/29).
- [ ] Every API error matches `{error:{code,message,requestId}}` (PRD §28).
- [ ] Structured logs carry request ID; credentials never logged (§§30/41).
- [ ] Migrations apply cleanly in CI against fresh PostgreSQL.
- [ ] Reference seed idempotent; demo seed explicitly gated and
      production-guarded (PRD §42).
