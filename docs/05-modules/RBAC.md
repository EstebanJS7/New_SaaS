---
type: module
module: rbac
status: implemented
updated: 2026-08-26
---

# Module — RBAC

## Responsibility

Deny-by-default route authorization, effective-permission resolution, and
audited administration of role→permission mappings and membership roles for one
tenant.

## Does Not Own

- Authentication or session management (see [[Identity-Sessions]]).
- Tenant membership activation (see [[Tenancy]]).
- Entitlement/feature grants (consumes `EntitlementsService.has()` only for
  settings gating; see [[Audit-Entitlements]]).
- Custom role or permission-catalog CRUD — roles remain seed-owned global
  reference data.

## Public Capabilities

- `GET /memberships/me/permissions` — sorted effective permission keys of the
  active membership (authenticated-only).
- `GET /memberships` and `GET /memberships/:id` — now gated by
  `users.membership.manage`.
- `POST /memberships/:id/role` `{roleCode}` — replaces the membership's single
  role (requires `users.membership.manage`).
- `GET /rbac/roles` — six seeded roles with TENANT-EFFECTIVE key sets (requires
  `users.membership.manage`).
- `GET /rbac/permissions` — immutable permission catalog (requires
  `users.membership.manage`).
- `PUT /rbac/roles/:code/permissions` — full REPLACE of the CALLER'S TENANT
  override set for one seeded role (requires `users.membership.manage`).

## Main Entities

```text
Role                              (global reference data, 6 seeded codes)
Permission                        (global reference data, seed-owned catalog)
RolePermission                    (global BASELINE mapping)
TenantRolePermissionOverride      (tenant-local deltas: granted=true/false)
TenantMembership                  (status ACTIVE|SUSPENDED; single roleId)
```

## Guard Chain

Wire order is contract:

```text
AuthGuard → TenantActiveGuard → PermissionGuard → handler
```

- `PermissionGuard` is registered globally via `APP_GUARD` after
  `TenantActiveGuard` (`apps/api/src/app.module.ts`).
- Every private route falls in exactly one bucket:
  1. **public-exempt** — `@Public` or `/auth/*` — skipped;
  2. **declared** — `@RequirePermissions(...keys)` present (empty array =
     authenticated-only);
  3. **violation** — private route without metadata ⇒ `403 FORBIDDEN` before the
     handler runs.
- Multiple declared keys mean logical AND: the active role's effective set must
  contain ALL of them.
- No roleCode/profile bypass branches exist; OWNER/ADMIN authority is DATA (its
  seeded `RolePermission` and tenant-override rows), never code.

The route-contract probe (`apps/api/src/rbac/route-contract.probe.test.ts`)
boots the real application and fails the build for any VIOLATION, naming the
route. Route enumeration uses DI-container traversal
(`apps/api/src/rbac/route-enumeration.ts`) because it returns structured data
that exactly mirrors what `Reflector.getAllAndOverride` reads at request time.

## Permission Resolution

`PermissionResolver` computes the effective key set once per request:

```text
effective(tenant, role) =
  (RolePermission baseline ∪ overrides granted=true)
  − overrides granted=false
```

- Baseline rows are GLOBAL platform data.
- Overrides are scoped to `tenantId` + `roleId`.
- The two indexed lookups run together and are memoized on the request's ALS
  store identity.
- No cross-request cache in v1.

## Administration Endpoints

Roles are global reference data addressed by CODE.
`PUT /rbac/roles/:code/permissions` re-targets the CALLER'S TENANT override
layer only — scope comes from server-resolved `ctx.tenantId`, so a cross-tenant
write is structurally inexpressible (DEC-003). The payload is a full replacement
set; unknown catalog keys return `VALIDATION_FAILED` and leave stored state
byte-identical.

Removing `users.membership.manage` from a role is rejected with `409 CONFLICT`
when the post-write state would leave zero ACTIVE members in the tenant whose
role EFFECTIVELY holds that key. The retention predicate is evaluated INSIDE a
database `$transaction` that first acquires `SELECT ... FOR UPDATE` over ALL
ACTIVE membership rows for the current tenant in deterministic order.

## Membership Role Assignment

`POST /memberships/:id/role` replaces the target membership's single role. The
same effective-holder retention invariant and locking protocol apply inside the
transaction. Cross-tenant UUID access degrades to `404 NOT_FOUND`.

## Audit Actions

All RBAC mutations are fail-closed audited inside their transaction:

| Action                             | Trigger                               | Metadata                                                    |
| ---------------------------------- | ------------------------------------- | ----------------------------------------------------------- |
| `rbac.role_permissions_overridden` | Successful override replace           | `{before: string[], after: string[]}` sorted effective sets |
| `rbac.membership_role_assigned`    | Successful membership role assignment | `{before: "ROLE_CODE", after: "ROLE_CODE"}`                 |

Reads emit zero audit rows. Audit failures abort the enclosing transaction.

## Data Classification

- `RolePermission` and `TenantRolePermissionOverride` rows are **INTERNAL**:
  product configuration, not personal data.
- Audit metadata is **INTERNAL**; it contains role codes and permission keys,
  never passwords, credentials, or clinical data.
- Tenant-scoped override rows are isolated by `tenantId`; cross-tenant UUID
  access returns `404`.

## Invariants

- Deny-by-default: a private route without `@RequirePermissions` is unreachable.
- AND semantics: missing any declared key ⇒ `403 FORBIDDEN`.
- ADMIN authority is data: mutating `RolePermission` or override rows changes
  enforcement without code changes.
- Last effective manager holder protected: a mutation that would strand the
  tenant with zero `users.membership.manage` holders is rejected `409 CONFLICT`.
- Catalog and roles are seed-owned: no HTTP surface creates, edits, or deletes
  `Role` or `Permission` records (proven by the route-contract probe).

## Known Limitations

- [[TD-006]] — tenant-isolation and RBAC concurrency suites run over an
  in-memory Prisma boundary. The `SELECT ... FOR UPDATE` serialization and
  transactional rollback/audit atomicity are exercised structurally but not
  proven against live PostgreSQL interleaving.

## Related Stories

- [[EPIC-02]] RBAC Enforcement / Entitlements / Tenant Settings.
- [[DEC-003]] — per-tenant override architecture over an immutable platform
  baseline.
