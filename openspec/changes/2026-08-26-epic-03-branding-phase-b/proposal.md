# Proposal: EPIC-03 Phase B — Tenant Branding

## Intent

Make the Phase A branding contract usable per tenant without component forks:
persist safe v1 overrides, resolve them server-side, and let authorized staff
manage them. This advances EPIC-03 while preserving the approved layering.

## Scope

### In Scope

- Persist versioned tenant overrides for `primary`, `accent`, `radius`, and
  `defaultAppearance`; fall back to the product preset.
- Add authenticated get/update/reset, `branding.settings.manage` (OWNER/ADMIN),
  `custom_branding` write gating, atomic audit, and tenant isolation.
- Expose `GET /api/v1/public/tenants/:slug/branding` with an allowlisted v1 DTO;
  resolve tenant overrides at the existing server-layout seam.
- Add `/app/settings/branding` with local-only, bounded sample-card preview;
  Save and Reset are explicit mutations.
- Respect tenant `defaultAppearance` only when no valid local preference exists;
  an explicit valid local choice wins.

### Out of Scope

- Logo/favicon uploads, branding assets, Files/object storage, custom domains,
  fonts, or dark-palette recoloring.
- Arbitrary tenant CSS/JS, full-shell preview, PRD edits, and a generic
  tenant-settings namespace.

## Capabilities

### New Capabilities

- `tenant-branding`: persisted, tenant-safe v1 branding management, public safe
  resolution, and staff settings UX.

### Modified Capabilities

None. Existing RBAC and entitlement contracts are consumed without changing
their requirements.

## Approach

Create a dedicated Branding module and additive `TenantBranding` relation; reuse
the Phase A strict `brandOverrideSchema`, request context, audit writer, RBAC,
and entitlement boundary. Return only validated v1 tokens publicly, then merge
them as `CoreDesignDefaults → ProductBrandPreset → TenantBranding` in the web
server layout. Deliver as <=400-line slices: seed/schema; private API/audit;
public endpoint/layout; settings UI. Phase B is in the code-first train with
EPIC-04, followed by combined hardening.

## Affected Areas

| Area                                              | Impact   | Description                                             |
| ------------------------------------------------- | -------- | ------------------------------------------------------- |
| `packages/database/prisma/schema.prisma`          | Modified | Add tenant-scoped branding storage and migration.       |
| `packages/database/src/reference-seed.ts`         | Modified | Seed/assign `branding.settings.manage`.                 |
| `apps/api/src/branding/**`                        | New      | Private/public DTOs, authorization, entitlement, audit. |
| `apps/web/src/app/layout.tsx`                     | Modified | Server-side tenant override resolution.                 |
| `apps/web/src/app/(app)/app/settings/branding/**` | New      | Bounded preview and explicit mutations.                 |

## Risks

| Risk                            | Likelihood | Mitigation                                                         |
| ------------------------------- | ---------- | ------------------------------------------------------------------ |
| Public leakage or tenant escape | Med        | Allowlisted DTO; server-derived tenant scope; isolation tests.     |
| Stored invalid data             | Low        | Versioned strict schema on read/write.                             |
| Live-PG evidence gap (TD-006)   | Med        | Track inherited gap; run live isolation during combined hardening. |

## Rollback Plan

Disable/revert branding routes, UI, and layout resolution so all tenants fall
back to presets. Retain additive branding rows and immutable audit records; do
not delete tenant data during rollback.

## Dependencies

- Shipped Phase A branding resolver/schema; existing RBAC, audit, entitlement,
  and tenant context.

## Success Criteria

- [ ] Authorized entitled tenants can get, update, and reset only v1 overrides;
      mutations are audited and isolated.
- [ ] Public endpoint and server layout expose/apply only safe resolved v1
      values with preset fallback.
- [ ] Preview remains local until Save; local valid appearance preference
      overrides tenant default.
- [ ] Delivery slices remain within the 400 changed-line review budget; combined
      hardening addresses TD-006.
