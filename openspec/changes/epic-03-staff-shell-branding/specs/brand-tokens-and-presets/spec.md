# Delta for brand-tokens-and-presets

Purpose: light/dark semantic token sets, product presets, theme validation, and
the brand resolution/fallback chain producing a typed `ResolvedBrand`. Phase A
only: no persistence, API, asset uploads, or entitlement gating.

## ADDED Requirements

### Requirement: Semantic token completeness

All reusable UI components (`packages/ui/src/components/ui/**`) MUST consume
semantic CSS variables / Tailwind token utilities and MUST NOT use literal brand
colors (raw hex/HSL literals or Tailwind palette utilities such as
`bg-emerald-500`). Verification SHALL be automatable with a lint rule or source
scan that fails when a violation is introduced.

#### Scenario: No literal brand colors in shared components

- GIVEN the repository source tree
- WHEN a lint/source-scan check runs over `packages/ui/src/components/ui/**`
- THEN it reports zero occurrences of literal hex/HSL color values or palette
  color utility classes
- AND the check exits non-zero when any new occurrence appears

### Requirement: Complete dark token set

The `.dark` selector MUST define a parallel semantic token set such that every
custom property declared in `:root` also exists under `.dark`. Both sets MUST
cover the full shadcn semantic set plus the status, radius, and font variables
shipped by the app.

#### Scenario: Light/dark parity check

- GIVEN `apps/web/src/app/globals.css`
- WHEN a parity check extracts custom-property names from `:root` and `.dark`
- THEN both sets are equal (every light token has a dark counterpart)
- AND removing any dark counterpart makes the parity check fail

### Requirement: Product presets supply identity via configuration

A veterinary preset (`presets/veterinary-default.ts`) MUST supply brand values,
validated by the brand theme schema, that reach the UI exclusively through the
token/CSS-variable bridge. Switching the active preset MUST NOT require editing
any shared component or app screen.

#### Scenario: Swapping preset re-themes with zero component edits

- GIVEN the veterinary preset and an alternative fixture preset, both
  schema-valid
- WHEN each is resolved and converted into a CSS-variable map
- THEN the two maps differ wherever the presets define different values (e.g.
  `--primary`)
- AND switching between them involves changes only inside
  `packages/ui/src/branding/`

### Requirement: Brand resolution fallback chain

The resolver MUST combine layers in order
`CoreDesignDefaults → ProductBrandPreset → TenantBranding overrides (reserved)`
where later layers win per property. An absent layer or absent property MUST
fall back to the previous layer without error. The resolver SHALL return a typed
`ResolvedBrand` contract intended for reuse by staff and portal surfaces.

#### Scenario: Preset overrides core defaults

- GIVEN `coreDesignDefaults` and the veterinary preset
- WHEN the resolver merges them
- THEN every property defined by the preset takes the preset value
- AND any property not defined by the preset keeps the core default value

#### Scenario: Missing tenant layer falls back

- GIVEN core defaults, a preset, and no tenant overrides (absent or empty)
- WHEN the resolver runs
- THEN the result equals the preset-over-core merge
- AND the missing tenant layer raises no error

### Requirement: Versioned theme schemas with tenant-editable contract

The package MUST expose an explicitly versioned partial-override schema variant
that accepts exactly `primary`, `accent`, `radius`, and `defaultAppearance`
(camelCase keys per PRD 10.1) as the tenant-editable contract target, reusing
approved value formats and rejecting unknown keys. The existing full-theme
`brandThemeSchema` behavior MUST remain unchanged (EPIC-00 tests stay green).
This resolves the kebab-case required-all vs camelCase partial drift by keeping
two distinct versioned variants instead of mutating the shipped schema.

#### Scenario: Valid partial override accepted

- GIVEN an override providing any subset of `primary`, `accent`, `radius`,
  `defaultAppearance` with approved value formats
- WHEN validated by the versioned partial-override schema
- THEN it passes and carries its explicit schema version

#### Scenario: Unknown keys or unsafe values rejected

- GIVEN an override containing an unlisted key (e.g. `background`) or an unsafe
  color value (e.g. `url(...)`)
- WHEN validated by the partial-override schema
- THEN it is rejected with a stable validation error
