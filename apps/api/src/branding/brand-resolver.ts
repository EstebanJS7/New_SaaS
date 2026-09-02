import type {
  BrandOverride,
  BrandTheme,
  BrandThemePatch,
  DefaultAppearance,
  ProductBrandPreset,
  ResolvedBrand,
} from "./dto.js";

const DEFAULT_APPEARANCE: DefaultAppearance = "light";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Merge one layer over a base value without mutating either side.
 *
 * Objects merge per property; every other overlay value replaces the base.
 * Absent (`undefined`) overlay properties fall back to the previous layer
 * silently — a missing layer or missing property is never an error.
 */
function mergeLayer(base: unknown, overlay: unknown): unknown {
  if (overlay === undefined) {
    return base;
  }
  if (!isPlainObject(base) || !isPlainObject(overlay)) {
    return overlay;
  }
  const merged: Record<string, unknown> = { ...base };
  for (const [key, overlayValue] of Object.entries(overlay)) {
    if (overlayValue === undefined) {
      continue;
    }
    merged[key] = mergeLayer(merged[key], overlayValue);
  }
  return merged;
}

/**
 * Map the flat camelCase tenant contract onto theme paths.
 *
 * `primary`/`accent` target color tokens; `radius` targets the base radius.
 * `defaultAppearance` is deliberately excluded — it resolves on
 * `ResolvedBrand`, not inside the theme.
 */
function tenantToPatch(tenant: BrandOverride | null | undefined): BrandThemePatch {
  if (!tenant) {
    return {};
  }
  const patch: BrandThemePatch = {};
  if (tenant.primary !== undefined || tenant.accent !== undefined) {
    patch.colors = {
      ...(tenant.primary !== undefined ? { primary: tenant.primary } : {}),
      ...(tenant.accent !== undefined ? { accent: tenant.accent } : {}),
    };
  }
  if (tenant.radius !== undefined) {
    patch.radius = tenant.radius;
  }
  return patch;
}

/** Neutral CoreDesignDefaults — bottom layer of the brand resolution stack. */
const coreDesignDefaults: BrandTheme = {
  colors: {
    background: "hsl(0 0% 100%)",
    foreground: "hsl(240 10% 3.9%)",
    card: "hsl(0 0% 100%)",
    "card-foreground": "hsl(240 10% 3.9%)",
    primary: "hsl(240 5.9% 10%)",
    "primary-foreground": "hsl(0 0% 98%)",
    secondary: "hsl(240 4.8% 95.9%)",
    "secondary-foreground": "hsl(240 5.9% 10%)",
    muted: "hsl(240 4.8% 95.9%)",
    "muted-foreground": "hsl(240 3.8% 46.1%)",
    accent: "hsl(240 4.8% 95.9%)",
    "accent-foreground": "hsl(240 5.9% 10%)",
    destructive: "hsl(0 84.2% 60.2%)",
    "destructive-foreground": "hsl(0 0% 98%)",
    status: {
      success: "hsl(142 76% 36%)",
      error: "hsl(0 84.2% 60.2%)",
    },
    border: "hsl(240 5.9% 90%)",
    input: "hsl(240 5.9% 90%)",
    ring: "hsl(240 5.9% 10%)",
  },
  radius: "0.5rem",
  fonts: {
    sans: "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
    mono: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
  },
};

/** Active product preset for the veterinary vertical. */
export const activeProductPreset: ProductBrandPreset = {
  code: "veterinary-default",
  productName: "Clinical Precision",
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
  },
};

/**
 * Resolve the final brand by layering, later layers winning per property:
 *
 * ```text
 * CoreDesignDefaults ← preset.theme ← patch ← tenant overrides
 * ```
 */
export function resolveBrand(
  preset: ProductBrandPreset,
  patch?: BrandThemePatch,
  tenant?: BrandOverride | null
): ResolvedBrand {
  let theme: unknown = coreDesignDefaults;
  theme = mergeLayer(theme, preset.theme);
  theme = mergeLayer(theme, patch);
  theme = mergeLayer(theme, tenantToPatch(tenant));
  return {
    presetCode: preset.code,
    theme: theme as BrandTheme,
    defaultAppearance: tenant?.defaultAppearance ?? DEFAULT_APPEARANCE,
  };
}
