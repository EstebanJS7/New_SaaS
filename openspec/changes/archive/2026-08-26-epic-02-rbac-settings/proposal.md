# Proposal: EPIC-02 — RBAC Enforcement / Entitlements / Tenant Settings

## Intent

RBAC is inert (`roleCode` unevaluated; `has()` zero callers; no settings
storage). EPIC-02 enforces authorization, turns role→permission mapping into
configurable data, ships typed tenant settings — reusable Core,
product-agnostic. Backend sole authority; frontend checks stay UX-only (PRD §9).

## Scope

**In**:

- Global `PermissionGuard` (third chain link), **deny-by-default**:
  non-`@Public` routes MUST declare permissions via decorator; undeclared
  private route → 403 runtime + startup-probe test.
- Audited admin API: role/permission listing; role permission-set update
  (mapping = mutable data); membership role assignment; effective-permissions
  endpoint.
- First production call site for `EntitlementsService.has()`.
- `TenantSettingNamespace` migration, typed registry, validated service, ONE
  reference namespace.
- Key-expansion convention; module docs; roadmap epic file.

**Out**:

- Custom roles CRUD (PRD §9 fixes six roles).
- Plan/grant management surfaces (ops-only); speculative namespaces beyond the
  reference one.
- UI screens; permission caching (escape hatch documented only);
  secrets/branding in settings.

## Capabilities

> sdd-spec contract; all NEW.

### New

- `rbac-enforcement`: deny-by-default guard, decorator metadata, route-contract
  probe test.
- `rbac-administration`: catalog reads, permission-set updates, role assignment,
  effective-permissions — audited.
- `entitlements-enforcement`: first capability-gate demonstration over `has()`.
- `tenant-settings`: versioned storage, registry, validated service, reference
  namespace.

### Modified

None.

## Approach

1. **Enforcement**: guard + decorator; wire third APP_GUARD; probe fails build
   on undeclared routes; explicit `/auth/*` exemptions.
2. **Administration**: audited rbac endpoints + effective-permissions; mapping
   edits preserve seed upsert idempotency.
3. **Entitlements**: gate demonstration consuming `has()`.
4. **Settings**: migration, registry, service, reference namespace;
   defaults/isolation/rejection/version tests.
5. **Docs**: rbac module doc; flip `Tenant-Settings.md`; create roadmap EPIC-02
   file.

## Proposal Question Round

Maintainer-resolved 2026-08-25: assignment API ships now (extends PRD §9 —
catalog stays seed-owned code, mapping becomes mutable data; authorizing
Decision lands during apply); deny-by-default; settings v1 = infrastructure +
one reference namespace; mutations audited; effective-permissions included;
custom roles out. No open questions.

## Affected Areas

- New: `apps/api/src/rbac/`; `apps/api/src/settings/`.
- Modified: `apps/api/src/app.module.ts`; `context/request-context.service.ts`
  (`roleCode` consumed); `entitlements/`;
  `packages/database/prisma/schema.prisma` (+migration);
  `src/reference-seed.ts`.
- Docs: `docs/05-modules/`; `docs/01-roadmap/EPIC-02-*.md`.

## Risks

- Fail-open regression later (High) — probe test blocks CI, not convention.
- Per-request query cost (Med) — acceptable; document cache escape hatch only.
- Seed idempotency breaks (Med) — catalog seed-owned; double-run probe.
- PRD §9 drift (Low) — Decision doc during apply; PRD untouched.

## Rollback Plan

Guard wiring additive — remove module import restores two-link chain. Migration
adds one reversible table, no confirmed-data mutation. Admin endpoints live in a
deletable module.

## Dependencies

EPIC-01 artifacts (guards, RequestContext, AuditWriter, reference-seed, errors
registry). No new external dependencies.

## Success Criteria

- [ ] Deny-by-default proven: probe test fails build on undeclared private
      route; runtime 403 integration-tested.
- [ ] Role→permission mapping editable via audited API as data; catalog
      seed-upserted; double-run no-op holds.
- [ ] Every RBAC/settings mutation emits an AuditWriter row (actor + ids).
- [ ] Effective-permissions endpoint serves keys resolved server-side from
      active membership.
- [ ] `EntitlementsService.has()` gains ≥1 production enforcement call site.
- [ ] Settings: unknown keys rejected; defaults when absent; write permission +
      tenant isolation enforced (cross-tenant → 404); schema-versioned; no
      secrets.
- [ ] lint/typecheck/tests/build green; docs merged atomically.
