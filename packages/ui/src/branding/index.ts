export type {
  BrandOverride,
  BrandTheme,
  BrandThemePatch,
  DefaultAppearance,
  ProductBrandPreset,
  ResolvedBrand,
} from "./types.js";
export { coreDesignDefaults } from "./core-defaults.js";
export {
  APPROVED_FONT_FAMILIES,
  brandThemeSchema,
  hslOrHex,
  remValue,
} from "./brand-theme.schema.js";
export {
  BRAND_OVERRIDE_ERROR_CODES,
  BRAND_OVERRIDE_SCHEMA_VERSION,
  BrandOverrideValidationError,
  brandOverrideSchema,
  validateBrandOverride,
} from "./brand-override.schema.js";
export type { BrandOverrideErrorCode } from "./brand-override.schema.js";
export { DEFAULT_APPEARANCE, resolveBrand } from "./resolve-brand.js";
export { toCssVariables } from "./to-css-variables.js";
export type { CssVariableMap } from "./to-css-variables.js";
export { veterinaryDefaultPreset as activeProductPreset } from "./presets/veterinary-default.js";
