import { coreDesignDefaults } from "./core-defaults.js";
import type {
  BrandOverride,
  BrandTheme,
  BrandThemePatch,
  DefaultAppearance,
  ProductBrandPreset,
  ResolvedBrand,
} from "./types.js";

/**
 * Appearance used when no layer provides one.
 *
 * The spec fixes the default to light: the pre-paint bootstrap only acts on a
 * stored `"dark"` preference, so absent configuration mounts light.
 */
export const DEFAULT_APPEARANCE: DefaultAppearance = "light";

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

/**
 * Resolve the final brand by layering, later layers winning per property:
 *
 * ```text
 * CoreDesignDefaults ← preset.theme ← patch ← tenant overrides
 * ```
 *
 * - Absent layers (`undefined` patch, `null`/`undefined`/empty tenant) and
 *   absent properties fall back silently to the previous layer.
 * - Inputs are never mutated; the returned `theme` is a fresh object.
 * - Presets are expected schema-valid upstream (see the preset tests); this
 *   function stays a pure merge with no I/O and no validation.
 */
export function resolveBrand(
  preset: ProductBrandPreset,
  patch?: BrandThemePatch,
  tenant?: BrandOverride | null,
): ResolvedBrand {
  let theme = coreDesignDefaults as unknown;
  theme = mergeLayer(theme, preset.theme);
  theme = mergeLayer(theme, patch);
  theme = mergeLayer(theme, tenantToPatch(tenant));
  return {
    presetCode: preset.code,
    theme: theme as BrandTheme,
    defaultAppearance: tenant?.defaultAppearance ?? DEFAULT_APPEARANCE,
  };
}
