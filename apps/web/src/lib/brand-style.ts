import { toCssVariables, type ResolvedBrand } from "@newsaas/ui/branding";

/**
 * Selector for the SSR brand bridge (design D2).
 *
 * `(0,2,0)` specificity beats the stylesheet-owned `.dark` block in light
 * mode regardless of tag order, while going fully inert once `.dark` is set
 * — so dark palette stays design-system-owned.
 */
export const BRAND_STYLE_SELECTOR = ":root:not(.dark)";

/**
 * Serialize a resolved brand into the payload of the SSR `<style>` bridge
 * emitted by the root layout (designs D1/D2/D4).
 *
 * Branding owns values, the stylesheet owns declarations: this emits only the
 * branding-owned custom properties under {@link BRAND_STYLE_SELECTOR}. The
 * popover pair intentionally stays absent because it is stylesheet-owned.
 */
export function brandStyleCss(brand: ResolvedBrand): string {
  const declarations = Object.entries(toCssVariables(brand))
    .map(([name, value]) => `${name}:${value};`)
    .join("");
  return `${BRAND_STYLE_SELECTOR}{${declarations}}`;
}
