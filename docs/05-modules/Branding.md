---
type: module
module: branding
status: active
updated: 2026-08-24
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

None shipped yet (Phase B target surface):

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

## Implemented public behavior (EPIC-03 Phase A)

Shipped as of EPIC-03 Phase A (chrome-only staff shell + token layer):

- **Token layer**: complete semantic set in `apps/web/src/app/globals.css`
  including the `--popover` pair and a full `.dark` block with light/dark parity
  enforced by scan tests. Shared components consume tokens only; source scans
  reject literal hex/HSL colors and palette utilities.
- **Veterinary preset**: `Clinical Precision`
  (`packages/ui/src/branding/presets/veterinary-default.ts`) is a complete,
  schema-valid `ProductBrandPreset`.
- **Resolver chain**: `resolveBrand` deep-merges core defaults ← preset ← tenant
  patch (reserved; absent layers fall back silently) into a `ResolvedBrand`.
- **CSS bridge**: root layout renders resolved values as a `<style>` tag under
  `:root:not(.dark)` (see [[Branding and Theming]] for the precedence contract).
  Preset swap requires zero shared-component edits.
- **Override schema v1**: `brandOverrideSchema`
  (`BRAND_OVERRIDE_SCHEMA_VERSION = 1`) accepts strict camelCase subsets
  (`primary`, `accent`, `radius`, `defaultAppearance`) with stable error codes.
  Validated in isolation only — not yet wired to tenant storage.
- **Appearance persistence (client-local)**:
  `localStorage["newsaas.appearance"]` stores `"light" | "dark"`. A
  parser-blocking bootstrap script applies a stored `dark` before first paint;
  the shell toggle flips `<html>.dark` without reload. Absent/corrupted value
  mounts light; `"system"` accepted by schema but inert.
- **Staff shell skeleton**: chrome-only `/app` route group (sidebar, topbar,
  bounded `<main data-shell-content>` region) composed from shadcn Button/Card
  primitives; nav entries are inert placeholders.

## Not yet implemented (Phase B)

Tenant branding persistence and admin API, asset uploads (logo/favicon), public
branding endpoint, tenant isolation and audit for branding changes, settings UI
with live preview/reset, entitlement (`custom_branding`) gating, and
preset-driven recoloring of dark mode.

## Veterinary preset: Clinical Precision

Implemented in EPIC-03 Phase A as
`packages/ui/src/branding/presets/veterinary-default.ts`: teal primary and amber
accent over teal-tinted neutrals (hue range ~173–183), `Noto Sans` sans stack,
`0.75rem` radius scale. Asset fields remain reserved (no uploads yet). Live
cross-tab appearance sync is deferred to Phase B.

## Related

- [[Branding and Theming]]
- [[ADR-002 Branding Theme Layering]]
