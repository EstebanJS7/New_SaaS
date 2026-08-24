/**
 * Forward-declared branding theme type.
 *
 * Resolution (Core → Product → Tenant) is implemented by `resolve-brand.ts`.
 * EPIC-00 ships the neutral defaults and a validating schema.
 */
export interface BrandTheme {
  /** Semantic color tokens. */
  colors: {
    background: string;
    foreground: string;
    card: string;
    "card-foreground": string;
    primary: string;
    "primary-foreground": string;
    secondary: string;
    "secondary-foreground": string;
    muted: string;
    "muted-foreground": string;
    accent: string;
    "accent-foreground": string;
    destructive: string;
    "destructive-foreground": string;
    status: {
      success: string;
      error: string;
    };
    border: string;
    input: string;
    ring: string;
  };
  /** Border radius in rem. */
  radius: string;
  /** Approved font family stacks. */
  fonts: {
    sans: string;
    mono: string;
  };
}

/**
 * Appearance preference accepted by the versioned tenant contract (PRD 10.1).
 *
 * `"system"` is part of the schema surface but Phase A UI acts only on
 * explicit `"light"` / `"dark"` values.
 */
export type DefaultAppearance = "light" | "dark" | "system";

/** Partial variant of `T`; nested objects stay partially overridable. */
export type DeepPartial<T> = T extends object ? { [K in keyof T]?: DeepPartial<T[K]> } : T;

/**
 * Product-level brand identity shipped as data (ADR-002 layering).
 *
 * Swapping the active preset must never require editing shared components or
 * app screens: identity reaches the UI exclusively through the resolver and
 * the CSS-variable bridge.
 */
export interface ProductBrandPreset {
  /** Stable identifier used by diagnostics and preset switching. */
  code: string;
  /** Human-facing product name rendered by shell surfaces. */
  productName: string;
  /** Complete replacement theme; every property wins over core defaults. */
  theme: BrandTheme;
  // Controlled branding assets (logo/favicon uploads) are reserved for a
  // later phase; the key is intentionally not declared yet so adopting it
  // stays an additive change to this contract.
}

/** Theme fragment layered between preset and tenant overrides; gaps fall back silently. */
export type BrandThemePatch = DeepPartial<BrandTheme>;

/**
 * Fully merged brand handed to rendering surfaces.
 *
 * Intended for reuse by staff and portal shells alike; consumers never read
 * raw presets or tenant payloads.
 */
export interface ResolvedBrand {
  /** `code` of the preset the brand was resolved from. */
  presetCode: string;
  /** Core ← preset ← patch ← tenant merge result. */
  theme: BrandTheme;
  /** Appearance applied when no stored preference exists. */
  defaultAppearance: DefaultAppearance;
}

/**
 * Tenant-editable branding override: the versioned partial contract target
 * from PRD 10.1. camelCase keys per design D5; validated by
 * `brandOverrideSchema` before reaching the resolver.
 */
export interface BrandOverride {
  /** Contract version; must equal `BRAND_OVERRIDE_SCHEMA_VERSION`. */
  schemaVersion: number;
  primary?: string;
  accent?: string;
  radius?: string;
  defaultAppearance?: DefaultAppearance;
}
