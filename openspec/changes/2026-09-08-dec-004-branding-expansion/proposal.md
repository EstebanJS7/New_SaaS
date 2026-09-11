# Proposal: DEC-004 Branding Expansion

## Intent

Implement accepted
[DEC-004](../../../docs/07-decisions/DEC-004-expand-epic-03-branding-td-009.md)
to resolve the scheduled
[TD-009](../../../docs/08-tech-debt/TD-009-branding-scope-deferred.md) gaps:
controlled tenant identity assets, portal brand consumption, and system
appearance. This continues EPIC-03 without changing the PRD.

## Scope

### In Scope

- Tenant-scoped light/dark logo and favicon upload, replacement, and delivery.
- Portal consumption of the allowlisted resolved public brand contract.
- `system` appearance with `prefers-color-scheme` precedence: local → tenant →
  system → Core.

### Out of Scope

- Arbitrary CSS/JS, remote fonts, SVG support, custom domains, CMS/page
  builders, or component forks.
- Veterinary-specific behavior in Core, portal reuse of staff
  authentication/routes, PRD or TD closure.

## Capabilities

### New Capabilities

- `tenant-branding-assets`: controlled, entitled, audited tenant logo/favicon
  lifecycle.
- `portal-brand-resolution`: portal application of the safe resolved public
  brand DTO.
- `system-appearance`: OS-preference appearance resolution and persistence
  behavior.

### Modified Capabilities

None. No existing `openspec/specs/` capability changes requirements.

## Approach

Extend
`CoreDesignDefaults → ProductBrandPreset → TenantBranding → ResolvedBrand`.
Store only opaque, tenant-owned asset keys in the approved object-storage
boundary; expose short-lived signed URLs through an allowlisted public DTO. Keep
staff mutations private and portal reads public-only. Validate PNG/WebP/ICO
MIME, content and bounded size before storage; reject executable/unknown types.
Preserve preset fallback and semantic-token rendering.

## Privacy, Security, and Tenancy

- Asset keys, tenant IDs, actors, and audit metadata are INTERNAL; only approved
  asset URLs and branding tokens are PUBLIC.
- Resolve tenant scope server-side; cross-tenant private asset access/mutation
  returns `404`.
- Require `branding.settings.manage` and `custom_branding`; audit every asset
  mutation. Never return bucket paths, keys, staff cookies, or private branding
  configuration to the portal.

## Expected Areas

| Area                                               | Impact   | Description                                    |
| -------------------------------------------------- | -------- | ---------------------------------------------- |
| `packages/database/prisma/schema.prisma`           | Modified | Additive tenant-owned branding asset metadata. |
| `apps/api/src/branding/**`                         | Modified | Asset API, resolver/DTO, authorization, audit. |
| `packages/ui/src/branding/**`                      | Modified | Asset-aware resolved-brand contract.           |
| `apps/web/src/app/(app)/**`, `components/shell/**` | Modified | Staff identity and appearance control.         |
| `apps/web/src/app/**` portal layout/routes         | New      | Public-DTO-only portal brand application.      |
| `apps/web/src/lib/appearance.ts`                   | Modified | System-preference bootstrap and precedence.    |

## Risks and Rollback

| Risk                         | Level  | Mitigation                                                           |
| ---------------------------- | ------ | -------------------------------------------------------------------- |
| Asset leakage or stale cache | Medium | Opaque keys, signed URLs, replacement invalidation, preset fallback. |
| Browser appearance flash     | Medium | Parser-blocking bootstrap and focused tests.                         |

Disable the entitlement and new asset/portal reads, reverting consumers to
preset identity. Retain additive asset metadata and audit records; do not delete
tenant data.

## Dependencies

- Existing Branding, RBAC, Entitlements, Audit, tenant context, and approved
  object storage.

## Success Criteria

- [ ] Entitled staff can safely manage only their tenant's validated branding
      assets; mutations are audited.
- [ ] Staff and portal render the same resolved identity without exposing keys
      or staff boundaries.
- [ ] `system` follows OS preference when local and tenant choices do not
      override it.
