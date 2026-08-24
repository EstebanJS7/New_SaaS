import type { ResolvedBrand } from "./types.js";

/**
 * CSS custom-property map keyed by variable name (`--primary`).
 *
 * Values are ready for direct injection into a `<style>` block: HSL colors
 * are stripped to bare triplets and 6-digit hex is normalized to its HSL
 * triplet, because Tailwind re-wraps them via `hsl(var(--x))` in
 * `apps/web/tailwind.config.ts` (raw hex would be invalid there).
 */
export type CssVariableMap = Record<`--${string}`, string>;

const HSL_WRAPPER = /^hsl\(\s*(\d[\d\s.%]*)\)$/;
const HEX_COLOR = /^#([0-9a-fA-F]{6})$/;

/**
 * Convert a schema-blessed 6-digit hex color into a bare `H S% L%` triplet.
 *
 * Tailwind re-wraps variable values via `hsl(var(--x))`, which is only valid
 * for numeric channel lists — so the bridge normalizes hex here instead of
 * letting an invalid `hsl(#rrggbb)` reach computed-value time.
 */
function hexToTriplet(hex: string): string {
  const int = Number.parseInt(hex.slice(1), 16);
  const r = ((int >> 16) & 0xff) / 255;
  const g = ((int >> 8) & 0xff) / 255;
  const b = (int & 0xff) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;

  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) {
      h = (g - b) / d + (g < b ? 6 : 0);
    } else if (max === g) {
      h = (b - r) / d + 2;
    } else {
      h = (r - g) / d + 4;
    }
    h /= 6;
  }

  return `${Math.round(h * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}

/**
 * Convert a schema-approved color into the variable value form.
 *
 * `hsl(173 80% 28%)` → `173 80% 28%`; 6-digit hex normalizes to its HSL
 * triplet (`#101828` → `220 43% 11%`) because the consumption pattern cannot
 * render raw hex; any other value passes through verbatim.
 */
function toVariableValue(color: string): string {
  const triplet = HSL_WRAPPER.exec(color)?.[1]?.trim();
  if (triplet !== undefined) {
    return triplet;
  }
  return HEX_COLOR.test(color) ? hexToTriplet(color) : color;
}

/**
 * Convert a resolved brand into the CSS-variable map consumed by the SSR
 * `<style>` bridge (design D2/D4: the layout emits these under
 * `:root:not(.dark)` so the dark class always wins under `.dark`).
 *
 * Color tokens are emitted as bare HSL triplets; radius and font stacks are
 * emitted verbatim. The map covers exactly the tokens branding owns from
 * `globals.css` (the popover pair stays stylesheet-owned).
 */
export function toCssVariables(brand: ResolvedBrand): CssVariableMap {
  const colors = brand.theme.colors;
  return {
    "--background": toVariableValue(colors.background),
    "--foreground": toVariableValue(colors.foreground),
    "--card": toVariableValue(colors.card),
    "--card-foreground": toVariableValue(colors["card-foreground"]),
    "--primary": toVariableValue(colors.primary),
    "--primary-foreground": toVariableValue(colors["primary-foreground"]),
    "--secondary": toVariableValue(colors.secondary),
    "--secondary-foreground": toVariableValue(colors["secondary-foreground"]),
    "--muted": toVariableValue(colors.muted),
    "--muted-foreground": toVariableValue(colors["muted-foreground"]),
    "--accent": toVariableValue(colors.accent),
    "--accent-foreground": toVariableValue(colors["accent-foreground"]),
    "--destructive": toVariableValue(colors.destructive),
    "--destructive-foreground": toVariableValue(colors["destructive-foreground"]),
    "--status-success": toVariableValue(colors.status.success),
    "--status-error": toVariableValue(colors.status.error),
    "--border": toVariableValue(colors.border),
    "--input": toVariableValue(colors.input),
    "--ring": toVariableValue(colors.ring),
    "--radius": brand.theme.radius,
    "--font-sans": brand.theme.fonts.sans,
    "--font-mono": brand.theme.fonts.mono,
  };
}
