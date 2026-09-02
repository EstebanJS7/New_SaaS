# Design: EPIC-03 Phase B — Tenant Branding

## Technical Approach

Make Phase A's `brandOverrideSchema` usable per tenant: one-row `TenantBranding`
table; private `branding` module reusing the settings pattern (auth +
permission + entitlement + audit); unauthenticated public endpoint with
allowlisted v1 DTO; server-side merge in the staff-shell layout using the
existing `brandStyleCss` bridge. Reuses: `brandOverrideSchema` v1,
`resolveBrand`/`toCssVariables`, `AuditWriter` (`$transaction` tx),
`RequestContextService`, `EntitlementsService.has()`, `PermissionGuard`,
`@Public`, `localStorage` appearance contract. Out of scope: assets/object
storage, arbitrary CSS, fonts, dark palette recoloring, generic tenant-settings
namespace.

## Architecture Decisions

| #   | Choice                                                                                                                                                   | Rationale                                                                        |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| D1  | One `tenant_branding` row per tenant (`tenantId` UNIQUE) + `theme_schema_version`; validate on controller AND on stored rows                             | Mirrors `tenant_setting_namespace`; catches legacy/corrupt rows.                 |
| D2  | Reads `@RequirePermissions()`; writes `branding.settings.manage` + `custom_branding`; reset is a write                                                   | Matches `sales.settings.manage`; reset mutates.                                  |
| D3  | Public DTO: `{ productDisplayName, primary?, accent?, radius?, defaultAppearance? }`; no `tenantId`/`slug`/`updatedBy`/audit                             | Data-class: PUBLIC = four tokens; INTERNAL = rest.                               |
| D4  | Private `GET /branding/current` returns full `ResolvedBrand`; public `GET /api/v1/public/tenants/:slug/branding` (`@Public()`, 404 on miss)              | Preserves layering; one round trip per staff page; slug is a public natural key. |
| D5  | Server interpolates `defaultAppearance` into parser-blocking bootstrap; localStorage `"light"\|"dark"` always wins                                       | Bootstrap stays parser-blocking; tenant default is only fallback.                |
| D6  | `action: "branding.updated"\|"branding.reset"` in same `$transaction`; reset = hard-delete (idempotent: missing row ⇒ 200 + preset-only payload + audit) | Atomic audit-or-nothing; "reset to product default" = no-row state.              |
| D7  | Settings UI: GET + PUT + reset; preview stays client-side                                                                                                | One fetch + three mutations; preview never hits the API.                         |

## Data Flow

    Staff (server): cookies() → GET /branding/current → validateBrandOverride(stored)
      → resolveBrand(preset, undefined, tenant) → brandStyleCss(brand) → <style>
    Public: GET /api/v1/public/tenants/:slug/branding → Tenant by slug
      → 404 on miss → toPublicBrandingDto
    Settings: GET → form values; local edits; preview consumes form state;
      Save → PUT; Reset → POST

## File Changes

| Path                                                                                                                                | Action |
| ----------------------------------------------------------------------------------------------------------------------------------- | ------ |
| `packages/database/prisma/schema.prisma`                                                                                            | Modify |
| `packages/database/prisma/migrations/<ts>_tenant_branding/migration.sql`                                                            | Create |
| `packages/database/src/reference-seed.ts`                                                                                           | Modify |
| `apps/api/src/branding/{branding.module,branding.service,branding.controller,public-branding.controller,brand-override.zod,dto}.ts` | Create |
| `apps/api/src/branding/branding.{service,integration}.test.ts`                                                                      | Create |
| `apps/api/src/app.module.ts`                                                                                                        | Modify |
| `apps/api/src/rbac/route-contract.probe.test.ts`                                                                                    | Modify |
| `apps/web/src/app/(app)/app/settings/branding/{page,branding-form,branding-preview}.tsx`                                            | Create |
| `apps/web/src/app/(app)/layout.tsx`                                                                                                 | Modify |
| `apps/web/src/lib/appearance.ts` + `appearance.test.ts`                                                                             | Modify |
| `docs/05-modules/Branding.md`, `docs/09-releases/CHANGELOG.md`                                                                      | Modify |

Schema adds `TenantBranding` (UUID PK, `tenantId` UNIQUE FK,
`themeSchemaVersion`, `data Json`, `updatedBy`); additive migration. Seed adds
`branding.settings.manage` (OWNER + ADMIN).

## Interfaces / Contracts

```ts
// apps/api/src/branding/dto.ts
export interface BrandingResponse {
  readonly source: "tenant" | "preset";
  readonly brand: ResolvedBrand;
}
export interface PublicBrandingDto {
  readonly productDisplayName: string;
  readonly primary?: string;
  readonly accent?: string;
  readonly radius?: string;
  readonly defaultAppearance?: "light" | "dark" | "system";
}
```

## Testing Strategy

Unit (Vitest): stored-row validation, merge precedence, preview isolation.
Integration (Supertest + two-tenant fixture): endpoints over real HTTP,
isolation, entitlement gate, reset idempotency, audit co-commit, route-contract
probe. E2E (Playwright + live PG): deferred to combined hardening after EPIC-04.

## Threat Matrix

`references/threat-matrix.md` is not shipped (skill references dir is empty).
Per applicability, this change only touches **routing**: two new HTTP surfaces
and one server layout. Other boundaries (shell, subprocess, VCS-PR, exec-file,
process) are not introduced. Routing is covered by the existing
`PermissionGuard`, `@Public`, and `route-contract.probe.test.ts` inventory Phase
B extends. **N/A** for non-routing boundaries; no new red tests beyond the
probe.

## Migration / Rollout

Additive and reversible: every tenant starts in no-row state (= preset fallback
= current Phase A behavior). Rollback disables the controller, the layout server
component, and the settings page; rows + audit entries are preserved so
re-enabling is lossless. Gated by `custom_branding`.

## Open Questions

- [ ] `branding.settings.manage` grant stays OWNER + ADMIN only?

## Slices / Forecast

| Slice | Goal                                                           | Risk | 400-line budget |
| ----- | -------------------------------------------------------------- | ---- | --------------- |
| S1    | Model + migration + permission seed                            | Low  | Low             |
| S2    | Private module + controller + service + audit + tests          | Med  | Low             |
| S3    | Public endpoint + server-layout resolution + appearance wiring | Med  | Low             |
| S4    | Settings UI (page + form + bounded preview)                    | Med  | Low             |

`Decision needed before apply: No` · `Chained PRs recommended: Yes` (code-first
train with EPIC-04) · `400-line budget risk: Low`. **Combined hardening**
(live-PG isolation, security review, Playwright, TD-006) runs AFTER EPIC-04
lands; per-slice verification still gates every PR — final verification
requirements are not weakened.

## Next

sdd-tasks to break Phase B into S1–S4 with explicit per-slice verification gates
and a `code-first-train` label.
