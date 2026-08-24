import type { BrandTheme } from "../types.js";

/**
 * Veterinary ProductBrandPreset.
 *
 * Supplies the product's brand identity exclusively as schema-validated theme
 * values consumed through the token/CSS-variable bridge. Swapping this preset
 * must never require editing shared components or app screens: every visual
 * identity decision lives in the data below.
 *
 * Controlled branding assets (logo, favicon uploads) are intentionally absent
 * in Phase A. The preset shape reserves an optional `assets` field for them;
 * it is introduced alongside the versioned `ProductBrandPreset` type in the
 * resolver slice so this module needs no structural change to adopt it.
 */
export const veterinaryDefaultPreset = {
  /** Stable preset identifier consumed by the resolver and diagnostics. */
  code: "veterinary-default",
  /** Human-facing product name rendered by shell surfaces. */
  productName: "Clinical Precision",
  /** Complete replacement theme; validated by `brandThemeSchema`. */
  theme: {
    colors: {
      background: "hsl(180 33% 99%)",
      foreground: "hsl(183 28% 14%)",
      card: "hsl(0 0% 100%)",
      "card-foreground": "hsl(183 28% 14%)",
      primary: "hsl(173 80% 28%)",
      "primary-foreground": "hsl(0 0% 98%)",
      secondary: "hsl(173 32% 93%)",
      "secondary-foreground": "hsl(174 52% 20%)",
      muted: "hsl(175 22% 95%)",
      "muted-foreground": "hsl(178 13% 38%)",
      accent: "hsl(42 92% 56%)",
      "accent-foreground": "hsl(33 82% 16%)",
      destructive: "hsl(0 74% 46%)",
      "destructive-foreground": "hsl(0 0% 98%)",
      status: {
        success: "hsl(152 62% 34%)",
        error: "hsl(0 74% 46%)",
      },
      border: "hsl(175 20% 87%)",
      input: "hsl(175 20% 84%)",
      ring: "hsl(173 80% 28%)",
    },
    radius: "0.75rem",
    fonts: {
      sans: '"Noto Sans", ui-sans-serif, system-ui, sans-serif',
      mono: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
    },
  } satisfies BrandTheme,
};
