---
id: EPIC-03
type: epic
title: Staff Shell, Design System and Branding
status: planned
priority: high
depends_on:
  - EPIC-01
prd_sections:
  - "10.1"
created: 2026-08-13
updated: 2026-08-13
---

# EPIC-03 — Staff Shell, Design System and Branding

## Objective

Create the reusable application shell and design system so the same UI can
present different product presets and tenant branding without component forks.

## Scope

- Next.js staff shell;
- Tailwind/shadcn setup;
- semantic design tokens;
- light/dark/system appearance;
- `ProductBrandPreset`;
- `TenantBranding`;
- BrandProvider/resolver;
- safe logo/favicon asset handling;
- staff branding settings page;
- live preview;
- reset to product defaults;
- entitlement integration;
- tenant-safe branding API;
- safe public branding DTO;
- sidebar/topbar using resolved identity.

## Out of Scope

- arbitrary CSS editor;
- page builder;
- custom-domain/TLS automation;
- per-tenant component forks;
- advanced CMS.

## Acceptance Criteria

- [ ] Shared components use semantic design tokens.
- [ ] Veterinary product preset can be changed without editing shared
      components.
- [ ] Tenant can upload allowed light/dark logos and favicon when entitled.
- [ ] Tenant can change approved theme properties.
- [ ] Theme input is schema validated.
- [ ] Arbitrary CSS/JS cannot be injected.
- [ ] Staff and portal can consume the same ResolvedBrand contract.
- [ ] Missing tenant overrides fall back to product preset.
- [ ] Reset restores product defaults.
- [ ] Public branding endpoint exposes only safe fields.
- [ ] Tenant A cannot edit Tenant B branding.
- [ ] Branding changes are audited.
- [ ] Live preview does not persist until Save.
- [ ] Lint/typecheck/tests/build are green.

## Suggested Stories

```text
BRAND-001 Semantic design tokens
BRAND-002 Product brand preset
BRAND-003 Tenant branding persistence/API
BRAND-004 Branding asset upload
BRAND-005 Branding settings + live preview
BRAND-006 Public brand resolution / portal integration
```

## Related

- [[Branding and Theming]]
- [[ADR-002 Branding Theme Layering]]
