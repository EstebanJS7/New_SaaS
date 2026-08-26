# Design: EPIC-02 — RBAC Enforcement / Entitlements / Tenant Settings

## Technical Approach

Extend the proven guard chain with a third Reflector-based link enforcing
deny-by-default route authorization backed by seeded `RolePermission` data; ship
audited administration + effective-permissions APIs; add typed tenant-settings
infrastructure whose write path hosts the first `EntitlementsService.has()`
production call site. No new runtime dependencies. Traces: all four delta specs.

## Architecture Decisions

### D1 — PermissionGuard & route contract (spec: rbac-enforcement)

| Aspect          | Decision                                                                                                                                           |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Metadata        | `SetMetadata("ns:require-permissions", readonly string[])`; factory `RequirePermissions(...keys)`; **empty call = authenticated-only declaration** |
| Semantics       | Multiple keys = AND (declared ⊆ resolved); no OR variant — split routes instead                                                                    |
| Skip rules      | Identical to TenantActiveGuard: `@Public` + `/auth/*` prefix (auth surface stays reachable membership-less)                                        |
| Deny-by-default | Private route with absent metadata ⇒ `DomainError("FORBIDDEN")` pre-handler                                                                        |
| Fail-closed     | Requires ALS tenant/role context present; absent upstream context ⇒ `UNAUTHENTICATED`/`FORBIDDEN`, never allow                                     |
| Chain position  | Third link: AppModule imports `RbacModule` after `TenancyModule`; wiring test extends tenancy precedent pinning Auth < Tenancy < Rbac source order |
| No bypass       | Zero roleCode/profile branches; ADMIN power = matrix rows only                                                                                     |
| Existing routes | `MembershipsController` GETs annotated `users.membership.manage`; `/memberships/me/permissions` empty-declared                                     |

**Probe test**: boots real AppModule via `bootTestApp`, enumerates the Fastify
route table (`getInstance().printRoutes()` parsed; container traversal
fallback), buckets every route public-exempt / declared / VIOLATION — violations
fail the suite naming the route. Runtime twin: integration 403 on undeclared
route.

### D2 — Permission resolution (spec: rbac-enforcement)

Resolve ONCE per request inside the guard: ALS `roleId` + `tenantId` → EFFECTIVE
key set = (`rolePermission.findMany({ where: { roleId } })` ∪ tenant overrides
granted=true) − tenant overrides granted=false (DEC-003 per-tenant layer; both
lookups indexed, issued together, memoized on the ALS store identity).
TenantActiveGuard's resolver adds `role.id` to its include; shared
`RequestContext` (`packages/shared/src/context.ts`) gains additive optional
`roleId`. No cache in v1 — one resolution/request. Documented escape hatch:
Redis cache keyed by (tenantId, roleId) invalidated on override PUT; deferred
per complexity budget. Extracted `PermissionResolver` serves guard + D4
endpoint.

### D3 — Administration endpoints (spec: rbac-administration)

| Route                                     | Contract                                                                                                                                                                                                                                                                                                                                      |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /rbac/roles`                         | Six roles + TENANT-EFFECTIVE key sets (baseline ⊕ caller's tenant overrides), DTOs; `@RequirePermissions("users.membership.manage")`                                                                                                                                                                                                          |
| `GET /rbac/permissions`                   | Catalog listing; same key                                                                                                                                                                                                                                                                                                                     |
| `PUT /rbac/roles/:code/permissions`       | Replaces the CALLER'S TENANT override set for the role — scope from server-resolved ctx.tenantId ONLY (cross-tenant write structurally impossible, DEC-003); keys validated ⊆ catalog else 400 unchanged; diff-vs-baseline materialized as granted=true/false verdicts inside `$transaction`; roles addressed by CODE (global reference data) |
| `POST /memberships/:id/role` `{roleCode}` | Batch-5 repo style: scoped `updateMany`, foreign UUID ⇒ 404; replaces membership's single role                                                                                                                                                                                                                                                |

Effective-manager serialization: inside BOTH mutation `$transaction`s, SELECT
... FOR UPDATE all ACTIVE membership rows for the current tenant, ordered by
membership id, before effective-holdership evaluation or mutation. The row set
is deliberately tenant-wide because a non-admin role may hold
`users.membership.manage` through a tenant override. After this lock, the shared
effective-holdership predicate rejects a post-write state with zero effective
managers as 409 `CONFLICT`.

AuditWriter — exactly one row per mutation, appended INSIDE the mutation's
`$transaction` (review WARNING-1: mutation-without-audit impossible), reads emit
nothing:

| Mutation         | action                             | metadata diff                                        |
| ---------------- | ---------------------------------- | ---------------------------------------------------- |
| Override replace | `rbac.role_permissions_overridden` | `{before:[keys],after:[keys]}` sorted effective sets |
| Role assignment  | `rbac.membership_role_assigned`    | `{before:"CODE",after:"CODE"}`                       |

targetType/targetId = role/membership ids; actor + requestId auto-filled.

### D4 — Effective permissions endpoint (spec: rbac-enforcement)

`GET /memberships/me/permissions` ⇒ `{ permissions: string[] }` sorted,
empty-declared, resolved via D2 from the active membership. NOT an `/auth/me`
extension: `/auth/*` is deliberately reachable without membership, while
effective permissions require tenant context. Spec fixes this route; confirmed.

### D5 — Entitlements gate (specs: entitlements-enforcement, tenant-settings)

Additive registry entry `FEATURE_NOT_ENTITLED: { status: 403 }` (append-only).
Write-path order in `TenantSettingsService.update`: ① definition lookup
(unregistered ⇒ `NOT_FOUND`) → ② `has(tenantId, def.requiresFeature)`
when declared (false ⇒ `FEATURE_NOT_ENTITLED`) → ③ patch schema validation → ④
persist. Registration precedes gate because the feature code lives on the
definition; each spec scenario stays single-variable. Reads never evaluate
entitlements; no epic code path creates grants (zero automatic grants
preserved).

### D6 — Settings infrastructure (spec: tenant-settings)

| Aspect            | Decision                                                                                                                                                                                                                                                                                                                        |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Table             | `TenantSettingNamespace` per TENANT-SETTINGS.md model verbatim (`@@unique([tenantId,namespace])`, `@@index([tenantId])`, `schemaVersion Int`, `data Json`, map `tenant_setting_namespace`); additive reversible migration                                                                                                       |
| Registry location | **apps/api/src/settings/registry.ts**, not packages/shared — schemas/defaults/versioning are backend enforcement material evolving with API domains; shared stays a thin frozen contract surface                                                                                                                                |
| Definition        | `{namespace, version, schema: z.object({...}).strict(), defaults, requiresFeature?, requiredPermissionKey}`; closed schemas make secrets unpersistable                                                                                                                                                                          |
| v1 namespace      | `sales`: `defaultCurrency` `/^[A-Z]{3}$/` default `"PYG"`; `requireCustomerForInvoice` bool default false; `requiresFeature:"sales"`, key `sales.settings.manage`                                                                                                                                                               |
| Service API       | `get(ns)` = defaults ⊕ stored (stored re-parsed through schema defensively); `update(ns, patch)` per D5 flow; partial patches preserve siblings. Tenant context is resolved strictly from the authenticated request (`requireTenantId()`); there is no `tenantId` selector and no cross-tenant-addressable settings row. Schema validation failures (unknown field, wrong type) return 400 `VALIDATION_FAILED`. |
| Routes            | `GET /settings/:namespace` empty-declared; `PUT /settings/:namespace` declares `sales.settings.manage`; service re-asserts `definition.requiredPermissionKey` via resolver — defense-in-depth so a forgotten decorator cannot fail open; expansion convention: new namespace ⇒ registry entry + decorator key + union-sync test |

### D7 — Seed interaction (spec: rbac-administration, documented behavior)

Seed keeps today's per-pair create-if-missing upserts (`update:{}`); edits are
purely additive: `PERMISSION_SEEDS += sales.settings.manage`; OWNER+ADMIN matrix
rows gain it. Plainly stated: admin-ADDED pairs survive reruns (seed never
deletes); admin-REMOVED baseline pairs ARE restored by rerun (self-healing
baseline). Durable custom matrices are not an MVP goal (fixed six roles,
seed-owned catalog); ops avoid rerunning reference-seed after intentional matrix
surgery. Double-run probe stays green.

### D8 — Execution order

| Slice | Content                                                                                                    | Verification                                                                                   | Rollback boundary                                  |
| ----- | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| S1    | Registry entry, ALS roleId, resolver, guard, decorator, annotate existing routes, `/me/permissions`, tests | unit/integration: 403 undeclared, AND, wire order, probe, anonymous 401                        | Remove RbacModule import ⇒ two-link chain restored |
| S2    | rbac-admin module (roles, permissions, assignment, audit)                                                  | replace-set, unknown-key 400, last-admin 409, cross-tenant 404, audit rows                     | Delete module                                      |
| S3    | Migration, settings registry/service/routes, entitlement gate, seed additions                              | defaults/rejection/isolation/version/entitlement suites; migrations job; seed double-run probe | Migration down + remove SettingsModule             |
| S4    | Docs: rbac module doc, TENANT-SETTINGS flip, roadmap EPIC-02 file, PRD §9-extension Decision               | quality gates, docs atomicity                                                                  | n/a                                                |

## Data Flow

```text
Request ─→ ALS{requestId}
  ├─ AuthGuard ───────────── setUserProfileId
  ├─ TenantActiveGuard ───── setTenantMembership(tenantId, membershipId, roleId, roleCode)
  └─ PermissionGuard ───┐
       metadata absent? ├─ yes ⇒ 403 FORBIDDEN
       PermissionResolver(roleId) ⇒ keys ⊇ declared? ── handler
             └─ PUT settings ⇒ EntitlementsService.has ⇒ AuditWriter.append
```

## File Changes

| File                                                                              | Action                                              |
| --------------------------------------------------------------------------------- | --------------------------------------------------- |
| `packages/shared/src/errors/registry.ts`                                          | Modify (+FEATURE_NOT_ENTITLED)                      |
| `packages/shared/src/context.ts`                                                  | Modify (+optional roleId)                           |
| `packages/database/prisma/schema.prisma` + migration                              | Modify/Create (+TenantSettingNamespace)             |
| `packages/database/src/reference-seed.ts`                                         | Modify (additive key + matrix rows)                 |
| `apps/api/src/rbac/**` (module, guard, decorator, resolver, controllers, service) | Create                                              |
| `apps/api/src/settings/**` (module, registry, service, controller)                | Create                                              |
| `apps/api/src/tenancy/tenant-active.guard.ts` · `tenant-membership.repository.ts` | Modify (roleId include; assignment + last-admin tx) |
| `apps/api/src/tenancy/membership.controller.ts`                                   | Modify (decorators; POST :id/role)                  |
| `apps/api/src/app.module.ts`                                                      | Modify (pinned import order)                        |
| wiring/probe/isolation/settings test suites                                       | Create                                              |

## Testing Strategy

| Layer       | Coverage                                                                                                                               |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Unit        | resolver AND/subset; registry rejection; defaults merge; seed double-run                                                               |
| Integration | 403 undeclared; probe enumeration; admin flows; last-admin 409; audit counts; settings get/set/isolation/entitlement; no cross-tenant-addressable settings resource |
| CI          | migrations job (fresh PG16 deploy); lint/typecheck/test/build gates                                                                    |

## Threat Matrix

N/A — no shell/command routing, subprocess, VCS/PR automation, executable-file
classification or process-integration boundary changes; authorization is
enforced inside the HTTP domain via the existing guard chain.

## Migration / Rollout

Single additive reversible migration (new table only; no confirmed-data
mutation). Guard wiring additive; slices roll back at module-import boundaries.

## Open Questions

- [x] Probe route-enumeration accessor (`printRoutes` parse vs container
      traversal) — pinned during tasks; both dependency-free. RESOLVED (task
      1.1): DI-container traversal wins
      (`apps/api/src/rbac/route-enumeration.ts`). `printRoutes()` renders an
      ASCII glyph tree with auto-added HEAD siblings whose text reconstruction
      is fragile; find-my-way internals are private. Traversing
      `ModuleRef.container.getModules()` yields structured {controller path,
      method path, HTTP method, SetMetadata keys} mirroring exactly what
      `Reflector.getAllAndOverride` reads at request time. A
      minimum-expected-inventory assertion guards against silent
      under-enumeration.

## Implementation Evidence

| Decision                            | Evidence location                                                                                                                                                                                         |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1 guard chain / route contract     | `apps/api/src/rbac/permission.guard.ts`, `apps/api/src/rbac/route-contract.ts`, `apps/api/src/rbac/route-contract.probe.test.ts`                                                                          |
| D2 permission resolution            | `apps/api/src/rbac/permission-resolver.service.ts`, `apps/api/src/rbac/me-permissions.integration.test.ts`                                                                                                |
| D3 administration endpoints / audit | `apps/api/src/rbac/rbac-admin.controller.ts`, `apps/api/src/rbac/rbac-admin.service.ts`, `apps/api/src/tenancy/membership-role-assignment.service.ts`, `apps/api/src/rbac/rbac-admin.integration.test.ts` |
| D4 `/me/permissions`                | `apps/api/src/tenancy/membership.controller.ts`, `apps/api/src/rbac/me-permissions.integration.test.ts`                                                                                                   |
| D5 entitlements gate                | `apps/api/src/settings/tenant-settings.service.ts`, `apps/api/src/settings/settings.integration.test.ts`                                                                                                  |
| D6 settings infrastructure          | `apps/api/src/settings/registry.ts`, `apps/api/src/settings/tenant-settings.service.ts`, `apps/api/src/settings/settings.controller.ts`                                                                   |
| D7 seed interaction                 | `packages/database/src/reference-seed.ts`, `packages/database/src/reference-seed.test.ts`                                                                                                                 |
| DEC-003 per-tenant overrides        | `docs/07-decisions/DEC-003-rbac-role-mapping-overrides.md`, `apps/api/src/rbac/manage-holdership.ts`                                                                                                      |
| Module docs / EPIC file             | `docs/05-modules/RBAC.md`, `docs/03-architecture/TENANT-SETTINGS.md`, `docs/01-roadmap/EPIC-02-RBAC-Entitlements-Tenant-Settings.md`                                                                      |

Apply-progress for this change was maintained externally in Engram
(`sdd/epic-02-rbac-settings/apply-progress`). Verification was waived at archive
time; see `archive-report.md` for the waiver state.
