---
id: EPIC-02
type: epic
title: RBAC Enforcement / Entitlements / Tenant Settings
status: done
priority: critical
depends_on:
  - EPIC-01
prd_sections:
  - "9"
  - "10"
  - "38"
created: 2026-08-25
updated: 2026-09-11
---

# EPIC-02 — RBAC Enforcement / Entitlements / Tenant Settings

## Objective

Add deny-by-default route authorization to the existing guard chain, expose
effective permissions and audited RBAC administration, and ship the first typed
tenant-settings namespace gated by entitlements. Keeps roles and the permission
catalog as seed-owned global reference data while letting tenant administrators
configure role mappings through a tenant-local override layer.

## Scope

- `PermissionGuard` as the third link in the guard chain (AuthGuard →
  TenantActiveGuard → PermissionGuard) with deny-by-default route contract and
  AND semantics.
- `PermissionResolver` merging `RolePermission` baseline with
  `TenantRolePermissionOverride` deltas per request.
- `GET /memberships/me/permissions` returning the active membership's effective
  keys.
- Audited RBAC administration: `GET /rbac/roles`, `GET /rbac/permissions`,
  `PUT /rbac/roles/:code/permissions`, `POST /memberships/:id/role`.
- Effective-holder retention invariant: reject mutations that would leave zero
  ACTIVE members whose role effectively holds `users.membership.manage`.
- `TenantSettingNamespace` model, additive reversible migration, typed registry,
  `TenantSettingsService`, and `GET/PUT /settings/:namespace`.
- First entitlement production call site in the settings write path.
- Additive reference-seed updates for `sales.settings.manage` and the OWNER/
  ADMIN matrix.

## Out of Scope

- Custom role CRUD — roles remain the six PRD §9 seeded codes.
- Plan or grant administration surfaces — `EntitlementsService.has()` is
  consumed, never mutated, by this epic.
- UI screens for role/permission/settings management.
- Permission caching across requests (v1 resolves once per request; Redis cache
  deferred per complexity budget).
- Portal-side RBAC or portal settings.

## Acceptance Criteria

- [x] Private routes without `@RequirePermissions` are rejected `403 FORBIDDEN`
      before handlers execute. — Evidence:
      `apps/api/src/rbac/route-contract.probe.test.ts` + `permission.guard.ts`.
- [x] Declared permission keys enforce AND semantics and ADMIN authority is data
      (mutating `RolePermission` or override rows changes enforcement). —
      Evidence: `apps/api/src/rbac/permission-enforcement.integration.test.ts`.
- [x] Effective permissions endpoint returns sorted keys for the active tenant
      role and rejects anonymous calls `401 UNAUTHENTICATED`. — Evidence:
      `apps/api/src/rbac/me-permissions.integration.test.ts`.
- [x] RBAC administration endpoints are tenant-scoped, address only seeded role
      codes, validate against the seed-owned catalog, and emit exactly one audit
      row per mutation inside the transaction. — Evidence:
      `apps/api/src/rbac/rbac-admin.integration.test.ts` +
      `apps/api/src/rbac/rbac-admin.service.ts`.
- [x] Last effective manager holder is protected by `409 CONFLICT` in both the
      override-replace and membership-assignment flows under a shared
      effective-holdership predicate. — Evidence:
      `apps/api/src/rbac/manage-holdership.test.ts` +
      `apps/api/src/rbac/rbac-admin.integration.test.ts`.
- [x] Settings reads return defaults when absent; unknown namespaces return
      `404 NOT_FOUND`; writes validate against a closed schema, reject unknown
      fields and secret-shaped payloads, preserve sibling values, and upsert one
      row per `(tenantId, namespace)`. — Evidence:
      `apps/api/src/settings/tenant-settings.service.test.ts` +
      `apps/api/src/settings/settings.integration.test.ts`.
- [x] Settings writes are gated by the `sales` entitlement AND the
      `sales.settings.manage` permission; reads skip entitlement evaluation. —
      Evidence: `apps/api/src/settings/settings.integration.test.ts`.
- [x] Settings have no cross-tenant-addressable resource — reads resolve to the
      caller's tenant defaults and writes are scoped to the caller's tenant.
      Membership targets return `404` when foreign. — Evidence:
      `apps/api/test/cross-tenant-isolation.e2e-spec.ts`.
- [x] Reference seed remains idempotent and additive; rerun restores removed
      baseline pairs without deleting admin-added pairs. — Evidence:
      `packages/database/src/reference-seed.test.ts`.

## Stories

- RBAC-A1 (tasks 1.x) — deny-by-default guard chain, route contract probe,
  effective-permissions endpoint.
- RBAC-A2 (tasks 2.x) — audited RBAC administration and membership role
  assignment.
- RBAC-Corrections (tasks C1–C5 / F1–F6) — per-tenant override layer,
  effective-holder locking/serialization, audit-in-transaction atomicity,
  DEC-003, TD-006 scope extension.
- RBAC-B1 (tasks 3.x) — settings storage, typed registry, service core.
- RBAC-B2 (tasks 4.x) — settings HTTP surface, entitlement gate, seed additions.
- RBAC-C (tasks 5.x) — module docs, EPIC file, full root gates.

## Dependencies

- [[EPIC-01]] database, auth, tenancy, audit, and entitlement scaffolding.
- No new runtime dependencies.

## Exit Criteria

- [x] Lint/typecheck/tests/build required for the Epic are green. — CI run
      `34605178149` at `c9cff613`: lint 14/14, format-check, typecheck 14/14,
      test 15/15 (640 passed / 6 skipped), build 9/9.
- [x] Cross-tenant isolation suite executes in a CI run. — CI run `34605178149`,
      `Database migrations` job: live-PG suite 6/6 passed; the broader Batch 5
      and RBAC concurrency gates remain tracked under [[TD-006]].
- [x] Documentation is current. — this Epic, `docs/01-roadmap/ROADMAP.md`, and
      `docs/09-releases/CHANGELOG.md` reconciled 2026-09-11.

Closure evidence (2026-09-11): all nine acceptance criteria map to implemented
code and tests, and the archived verification waiver
(`openspec/changes/archive/2026-08-26-epic-02-rbac-settings/archive-report.md`)
is superseded by canonical CI run `34605178149` at `c9cff613`. Closure is
evidence-based, not a production-readiness statement: [[EPIC-20]] Production
Hardening and the open debt below remain.

## Known Limitations

- [[TD-006]] — tenant-isolation suites and RBAC concurrency proofs run over an
  in-memory Prisma boundary. Live-PostgreSQL evidence for the
  `SELECT ... FOR UPDATE` lock interleavings and transactional audit rollback is
  required before further tenant-scoped aggregates land or any production
  deployment.
- [[TD-010]] — `TenantSettingsService.update` uses a read → in-memory merge →
  upsert pattern; concurrent partial writes to the same `(tenantId, namespace)`
  row can lose disjoint sibling fields. Closure preserves this formerly
  untracked warning as debt instead of dissolving it; remediation (optimistic
  locking or a server-side per-field merge) is deferred.
- [[DEC-003]] — per-tenant role-mapping overrides are accepted architecture; the
  PRD itself is not edited yet (`prd_change_required: true`), so the next
  approved PRD revision should describe §9 mapping configurability as
  tenant-local overrides over a seed-owned baseline.

## Decisions / ADRs

- [[DEC-003]] — RBAC role→permission mapping: per-tenant overrides over an
  immutable platform baseline (maintainer-authorized 2026-08-25, status
  accepted).

## Technical Debt

Tracked in the Known Limitations section: [[TD-006]], [[TD-010]].

## Related

- [[ENGINEERING RULES]]
- [[PRD]] — sections §§9, 10, 38.
- [[RBAC]] — implemented module behavior.
- [[Tenant Settings]] — implemented architecture.
