---
type: module
module: branding
status: planned
updated: 2026-08-13
---

# Module — Branding

## Responsibility

Resolve the visual identity used by staff UI and customer portal from Core
defaults, product preset and tenant overrides.

## Does Not Own

- Veterinary domain behavior.
- Authentication itself.
- Tenant subscriptions, except querying Entitlements.
- Private clinical files.
- Custom-domain provisioning.

## Main Concepts

```text
CoreDesignDefaults
ProductBrandPreset
TenantBranding
ResolvedBrand
BrandingAsset
```

## Permissions

```text
settings.branding.manage
```

## Entitlement

```text
custom_branding
```

## API

```text
GET   /api/v1/branding/current
GET   /api/v1/settings/branding
PATCH /api/v1/settings/branding
POST  /api/v1/settings/branding/assets
POST  /api/v1/settings/branding/reset
GET   /api/v1/public/tenants/:slug/branding
```

## Invariants

- Tenant overrides are schema validated.
- No arbitrary CSS/JS.
- Shared components consume semantic tokens.
- Public DTO is allowlisted.
- Tenant isolation applies to admin configuration.
- Reset means remove/revert tenant overrides, not mutate product preset.

## Foundation baseline (EPIC-00)

EPIC-00 establishes the brand-resolution layers but does **not** implement
product presets or tenant overrides. The shipped foundation is:

- `packages/ui/src/branding/core-defaults.ts` — neutral `CoreDesignDefaults`
  using semantic tokens (`background`, `foreground`, `primary`, `border`,
  `ring`, etc.).
- `packages/ui/src/branding/brand-theme.schema.ts` — Zod schema that rejects
  arbitrary CSS/JS and constrains colors to `hsl()` or hex, radius to rem, and
  fonts to approved stacks.
- `packages/ui/src/branding/types.ts` — forward-declared `BrandTheme` type.

No tenant resolution, no asset upload, and no Veterinary-specific colors are
present in EPIC-00.

## Deferred Veterinary preset: Clinical Precision

The future default Veterinary product preset is named **Clinical Precision**.
When implemented in EPIC-03 it is expected to use:

- Primary accent in the teal family and slate neutrals.
- `Inter` as the primary sans-serif typeface.
- Defined radii, elevation, and spacing scales.
- A monospaced numeric face for clinical/lab data.
- Desktop-first layouts for dense staff workflows.

Only the name and intent are recorded here; the actual preset file is out of
EPIC-00 scope.

## Related

- [[Branding and Theming]]
- [[ADR-002 Branding Theme Layering]]
