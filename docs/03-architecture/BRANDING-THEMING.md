---
type: architecture
status: active
updated: 2026-08-13
---

# Branding and Theming

## Goal

Allow the same reusable SaaS Core and UI component library to serve multiple
products/verticals and optional tenant white-labeling without frontend forks.

## Resolution layers

```text
CoreDesignDefaults
      ↓
ProductBrandPreset
      ↓
TenantBranding
      ↓
ResolvedBrand
      ↓
CSS semantic variables
      ↓
shadcn/Tailwind UI
```

### CoreDesignDefaults

Stable neutral defaults owned by the reusable design system.

### ProductBrandPreset

Versioned configuration for a product/vertical. Examples:

```text
veterinary-default
workshop-default
dental-default
```

This is how one product can have a distinctly different look & feel while using
the same components and Core.

### TenantBranding

Optional runtime overrides owned by a Tenant.

Use it for:

- logo;
- favicon;
- selected semantic colors;
- approved typography;
- radius;
- default appearance.

Do not use it as a generic CSS editor.

## Semantic tokens

Reusable components consume semantic variables compatible with the project's
shadcn/Tailwind setup, for example:

```text
--background
--foreground
--card
--card-foreground
--popover
--popover-foreground
--primary
--primary-foreground
--secondary
--secondary-foreground
--muted
--muted-foreground
--accent
--accent-foreground
--destructive
--destructive-foreground
--border
--input
--ring
--radius
```

A component may use:

```text
bg-primary
text-primary-foreground
border-border
```

It should not use a literal color when that color represents brand identity.

## Theme contract

Recommended TypeScript contract:

```ts
export interface BrandTheme {
  colors: {
    background?: string;
    foreground?: string;
    card?: string;
    cardForeground?: string;
    primary?: string;
    primaryForeground?: string;
    secondary?: string;
    secondaryForeground?: string;
    accent?: string;
    accentForeground?: string;
    muted?: string;
    mutedForeground?: string;
    border?: string;
    ring?: string;
  };
  radius?: "none" | "sm" | "md" | "lg";
  fontHeading?: ApprovedFontCode;
  fontBody?: ApprovedFontCode;
  defaultAppearance?: "light" | "dark" | "system";
}
```

The real contract must use a strict Zod schema and versioning.

## Suggested frontend structure

```text
packages/ui/src/branding/
├── brand-theme.schema.ts
├── brand-types.ts
├── core-defaults.ts
├── resolve-brand.ts
├── to-css-variables.ts
└── presets/
    └── veterinary-default.ts

apps/web/src/branding/
├── brand-provider.tsx
├── brand-loader.ts
└── brand-assets.ts
```

Do not create a separate component library per vertical.

## Product presets

A product preset is code/config committed with the product.

Example conceptual configuration:

```ts
export const veterinaryBrandPreset = {
  code: "veterinary-default",
  productName: "Vet SaaS",
  assets: {
    logoLight: "/brand/veterinary/logo-light.webp",
    logoDark: "/brand/veterinary/logo-dark.webp",
    favicon: "/brand/veterinary/favicon.png",
  },
  theme: {
    // semantic token defaults; actual values owned by design
  },
};
```

Do not copy the whole app just to change this preset.

## Tenant model

```prisma
model TenantBranding {
  id                 String   @id @default(uuid()) @db.Uuid
  tenantId           String   @unique @db.Uuid
  displayName        String?
  logoLightAssetKey  String?
  logoDarkAssetKey   String?
  faviconAssetKey    String?
  themeSchemaVersion Int      @default(1)
  theme              Json
  updatedBy          String?  @db.Uuid
  createdAt          DateTime @default(now())
  updatedAt          DateTime @updatedAt

  tenant Tenant @relation(fields: [tenantId], references: [id])

  @@map("tenant_branding")
}
```

The JSON is validated by a versioned schema and contains only approved theme
keys.

## Brand resolution service

Backend/application responsibility:

```text
resolve product preset
+ load tenant branding when tenant context exists
+ validate stored schema version
+ merge allowed overrides
+ return safe BrandDTO
```

Frontend responsibility:

```text
BrandDTO
→ CSS variable mapping
→ BrandProvider
→ application UI
```

## Public context

Some branding is needed before authentication.

Safe public endpoint:

```text
GET /api/v1/public/tenants/:slug/branding
```

Only return:

- public display name;
- logo URLs;
- favicon URL;
- safe theme tokens.

Never return:

- RUC/private organization configuration;
- membership information;
- billing/subscription secrets;
- storage keys that expose private buckets;
- provider credentials.

## Branding assets

Use a dedicated controlled branding asset path/bucket.

Recommended MVP formats:

```text
PNG
WEBP
ICO/PNG for favicon
```

If SVG is later supported, sanitize it with an explicitly approved pipeline.

Limits should be documented, e.g. logo <= 2 MB and favicon <= 512 KB.

## Settings UX

Route:

```text
/app/settings/branding
```

Editor sections:

```text
Identity
  display name
  logo light
  logo dark
  favicon

Theme
  primary
  accent
  font pair
  radius
  default appearance

Preview
  sidebar
  buttons
  cards
  form
  status badges
  portal header
```

Buttons:

```text
Preview
Save changes
Reset to product defaults
```

Preview state must be local until Save.

## Entitlement

Tenant custom branding may require:

```text
custom_branding
```

A tenant without this entitlement uses the product preset.

## Caching

Resolved branding may be cached because it changes infrequently.

Cache keys must include tenant and theme revision/version.

Saving branding invalidates the cache.

## Custom domains — future

Brand resolution must not assume only URL path tenant identification.

Future resolvers may support:

```text
tenant slug
subdomain
custom domain
```

Domain provisioning and TLS automation are future scope.

## Security invariants

- Tenant A cannot read unpublished/admin branding config of Tenant B.
- Tenant A cannot modify Tenant B branding.
- Public endpoint returns an allowlisted DTO only.
- No arbitrary CSS/JS.
- No executable file upload.
- No remote font CSS entered by users.
- All theme values pass strict schema validation.

## Testing

Unit:

- theme schema validation;
- merge precedence;
- fallback behavior;
- token conversion.

Integration:

- tenant isolation;
- entitlement enforcement;
- asset ownership;
- public safe DTO.

E2E:

- product default renders;
- tenant override renders;
- reset restores product default;
- portal and staff render same tenant identity.
