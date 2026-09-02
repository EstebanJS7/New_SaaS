---
type: module
module: branding
status: active
updated: 2026-08-31
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
branding.settings.manage
```

Granted to `OWNER` and `ADMIN` by the reference seed.

## Entitlement

```text
custom_branding
```

## API

Private (staff, authenticated):

```text
GET   /branding/current          — resolved brand for the active tenant
PUT   /branding/current          — update tenant overrides (manage + entitlement)
POST  /branding/reset            — remove tenant overrides (manage + entitlement)
```

Public (unauthenticated, allowlisted DTO only):

```text
GET   /api/v1/public/tenants/:slug/branding
```

Web proxy routes (staff session cookie forwarded):

```text
GET   /api/branding/current
POST  /api/branding/reset
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

## Implemented public behavior

### EPIC-03 Phase A — token layer and preset

- **Token layer**: complete semantic set in `apps/web/src/app/globals.css`
  including the `--popover` pair and a full `.dark` block with light/dark parity
  enforced by scan tests. Shared components consume tokens only; source scans
  reject literal hex/HSL colors and palette utilities.
- **Veterinary preset**: `Clinical Precision`
  (`packages/ui/src/branding/presets/veterinary-default.ts`) is a complete,
  schema-valid `ProductBrandPreset`.
- **Resolver chain**: `resolveBrand` deep-merges core defaults ← preset ← tenant
  patch into a `ResolvedBrand`.
- **Override schema v1**: `brandOverrideSchema`
  (`BRAND_OVERRIDE_SCHEMA_VERSION = 1`) accepts strict camelCase subsets
  (`primary`, `accent`, `radius`, `defaultAppearance`) with stable error codes.
- **Appearance persistence (client-local)**:
  `localStorage["newsaas.appearance"]` stores `"light" | "dark"`. A
  parser-blocking bootstrap script applies a stored `dark` before first paint;
  the shell toggle flips `<html>.dark` without reload. Valid local appearance
  always wins; tenant `defaultAppearance` is only the fallback bootstrap input.
- **Staff shell skeleton**: chrome-only `/app` route group (sidebar, topbar,
  bounded `<main data-shell-content>` region) composed from shadcn Button/Card
  primitives.

### EPIC-03 Phase B — tenant overrides and admin surface

- **Persistence**: one `tenant_branding` row per tenant (`tenant_id` UNIQUE),
  versioned JSON overrides, `updated_by` relation, additive migration.
- **Private API**: `GET /branding/current`, `PUT /branding/current`,
  `POST /branding/reset`. Reads require authentication + active membership;
  writes require `branding.settings.manage` plus the `custom_branding`
  entitlement.
- **Audit**: every successful write/reset co-commits an `audit_log` row in the
  same transaction (`branding.updated` / `branding.reset`).
- **Public API**: `GET /api/v1/public/tenants/:slug/branding` returns only the
  PUBLIC allowlist (`productDisplayName`, `primary`, `accent`, `radius`,
  `defaultAppearance`); 404 on unknown slug.
- **Server resolution**: staff layout resolves the full brand server-side and
  injects `brandStyleCss` as a parser-blocking `<style>` tag.
- **Settings UI**: `/app/settings/branding` with bounded sample-card preview,
  Save, and Reset. Preview is form-state only and never reproduces the shell.

## Not yet implemented

Asset uploads (logo/favicon), preset-driven dark-mode recoloring, portal-side
branding consumption, and Playwright E2E coverage for the settings page.

## Known limitations / blockers

- Playwright E2E coverage for branding settings is **explicitly blocked**:
  Playwright is not installed or configured in the repository. The Vitest suite
  covers unit, integration, SSR CSS bridge, and bounded preview locality; a
  future change that adds Playwright should implement the settings-page E2E
  scenario before removing this note.

## Veterinary preset: Clinical Precision

Implemented in EPIC-03 Phase A as
`packages/ui/src/branding/presets/veterinary-default.ts`: teal primary and amber
accent over teal-tinted neutrals (hue range ~173–183), `Noto Sans` sans stack,
`0.75rem` radius scale. Asset fields remain reserved (no uploads yet). Live
cross-tab appearance sync is deferred to Phase B.

## Related

- [[Branding and Theming]]
- [[ADR-002 Branding Theme Layering]]
