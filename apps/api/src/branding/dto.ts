import { z } from "zod";
import { brandOverrideSchema } from "./brand-override.zod.js";

/** Tenant-editable branding override inferred from the v1 schema. */
export type BrandOverride = z.infer<typeof brandOverrideSchema>;

/** Appearance preference accepted by the versioned tenant contract. */
export type DefaultAppearance = "light" | "dark" | "system";

/** Recursive partial helper for theme layering. */
type DeepPartial<T> = T extends object ? { [K in keyof T]?: DeepPartial<T[K]> } : T;

/** Complete semantic theme handed to rendering surfaces. */
export interface BrandTheme {
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
  radius: string;
  fonts: {
    sans: string;
    mono: string;
  };
}

/** Theme fragment layered between preset and tenant overrides. */
export type BrandThemePatch = DeepPartial<BrandTheme>;

/** Product-level brand identity shipped as data. */
export interface ProductBrandPreset {
  code: string;
  productName: string;
  theme: BrandTheme;
}

/** Fully merged brand handed to rendering surfaces. */
export interface ResolvedBrand {
  presetCode: string;
  theme: BrandTheme;
  defaultAppearance: DefaultAppearance;
}

/** Private branding endpoint response. */
export interface BrandingResponse {
  readonly source: "tenant" | "preset";
  readonly brand: ResolvedBrand;
}

/**
 * Public safe branding DTO.
 *
 * INTERNAL fields (`tenantId`, `slug`, `updatedBy`, audit) are never exposed;
 * only the four v1 tokens plus the product display name are allowlisted.
 */
export interface PublicBrandingDto {
  readonly productDisplayName: string;
  readonly primary?: string;
  readonly accent?: string;
  readonly radius?: string;
  readonly defaultAppearance?: DefaultAppearance;
}
