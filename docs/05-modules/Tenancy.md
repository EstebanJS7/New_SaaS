---
type: module
module: tenancy
status: implemented
updated: 2026-09-11
---

# Module — Tenancy

## Responsibility

Server-authoritative tenant context for every private route: membership
resolution, tenant-scoped data access and cross-tenant isolation guarantees.

## Does Not Own

- Authentication itself (see [[Identity-Sessions]]).
- Role/permission policy checks (EPIC-02).
- Tenant creation workflow (no self-service registration; ops/seed creation
  only).
- Suspension/reactivation commands, authorization, audit and status-transition
  UX (explicitly deferred — see DEC-005 / ADR-004 below).

## Public Capabilities

- `GET /memberships` — lists memberships of the caller's ACTIVE tenant.
- `GET /memberships/:id` — one membership; foreign and nonexistent UUIDs are
  indistinguishable (`404` envelope, byte-equivalent bodies).

## Main Entities

```text
Tenant              (slug UNIQUE; status ACTIVE|SUSPENDED default ACTIVE)
TenantMembership    (UNIQUE(tenant_id, user_profile_id); ACTIVE|SUSPENDED)
Branch              (schema-only, inert)
CustomerPortalAccess (schema-only, inert scaffold)
```

## Lifecycle (DEC-005 + ADR-004)

`Tenant` carries an additive `TenantStatus` enum (`ACTIVE` default,
`SUSPENDED`), delivered by migration `20260911000001_tenant_lifecycle`. It
represents tenant lifecycle without coupling to memberships or entitlements.

- The public branding lookup (`GET /api/v1/public/tenants/:slug/branding`)
  resolves `status = ACTIVE` only, so a SUSPENDED slug returns the identical
  `404 NOT_FOUND` envelope as an unknown slug. See [[Branding]].
- No suspension/reactivation command, authorization, audit action or UI ships in
  this scope: `SUSPENDED` is set only by an explicit operator SQL change until a
  future Story owns those invariants.
- `TenantActiveGuard` checks `TenantMembership.status`, not `Tenant.status`; the
  two lifecycles are independent.

## Guard Chain

Wire order is contract (design D3):

```text
Fastify genReqId → ALS middleware → AuthGuard → TenantActiveGuard → handler
```

- `AuthGuard` validates the session and populates RequestContext.
- `TenantActiveGuard` skips `@Public` routes and `/auth/*`; requires an ACTIVE
  membership else `403 FORBIDDEN`; zero or suspended memberships never gain
  tenant authority. Registered globally via APP_GUARD AFTER AuthGuard.

## Tenant Resolution Rules

- Tenant identity comes exclusively from the session's server-side membership;
  body/query/header hints are ignored (proven by isolation tests).
- Cross-tenant UUID access returns `404` with the standard envelope, masked as a
  nonexistent resource.

## Repository Pattern

Convention (not a generic base class): tenant-scoped repositories take the
`RequestContextService` and apply `where: { tenantId: ctx.requiredTenantId() }`
implicitly on reads AND writes (`updateMany`, never unique-WHERE updates). Zero
rows ⇒ `DomainError("NOT_FOUND")`. Demonstrated on `TenantMembershipRepository`.

## Invariants

- Private aggregates without shipped business logic stay route-less (Branch,
  CustomerPortalAccess, Role, Permission CRUD absent).
- No tenant-creation route exists.
- Every private aggregate carries automated cross-tenant isolation coverage; the
  suite runs over the in-memory Prisma boundary ([[TD-006]]) while real-PG
  schema behavior stays covered by the CI migrations job.

## Security / Tenant Rules

- Authorization requires authentication + ACTIVE membership; per-permission
  enforcement intentionally does not exist yet (RBAC records seed inertly).
- Membership mutation is not exposed over HTTP in this epic.

## Related Stories

- [[EPIC-01]] DAT-004 (Slice S4).
