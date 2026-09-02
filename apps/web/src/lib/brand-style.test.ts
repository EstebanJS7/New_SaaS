import { describe, expect, it } from "vitest";
import { activeProductPreset, resolveBrand } from "@newsaas/ui/branding";
import { BRAND_STYLE_SELECTOR, brandStyleCss } from "./brand-style";

describe("brandStyleCss", () => {
  const brand = resolveBrand(activeProductPreset);
  const css = brandStyleCss(brand);

  it("scopes every declaration under the dark-defeating :root:not(.dark) selector", () => {
    expect(css.startsWith(`${BRAND_STYLE_SELECTOR}{`)).toBe(true);
    expect(css.endsWith("}")).toBe(true);
    expect(BRAND_STYLE_SELECTOR).toBe(":root:not(.dark)");
  });

  it("emits branding-owned variables as bare triplets (no hsl() wrappers)", () => {
    expect(css).toContain("--primary:");
    expect(css).toContain("--radius:");
    expect(css).not.toContain("hsl(");
  });

  it("keeps the stylesheet-owned popover pair out of the bridge", () => {
    expect(css).not.toContain("--popover");
  });

  it("emits the resolved preset identity, not the core defaults", () => {
    // The veterinary preset overrides --primary/--accent/--radius; if the
    // bridge ever leaked core defaults these would diverge.
    const cssVariables = css.slice(BRAND_STYLE_SELECTOR.length + 1, -1);
    expect(cssVariables).toContain(`--radius:${brand.theme.radius};`);
    expect(cssVariables).toContain(
      `--primary:${brand.theme.colors.primary.replace(/^hsl\(\s*|\s*\)$/g, "")};`
    );
  });

  it("emits tenant override values through the SSR layout CSS bridge", () => {
    const tenantBrand = resolveBrand(activeProductPreset, undefined, {
      schemaVersion: 1,
      primary: "#0ea5e9",
      accent: "#f43f5e",
      radius: "0.75rem",
    });
    const css = brandStyleCss(tenantBrand);

    // toCssVariables normalizes colors to bare HSL triplets.
    expect(css).toContain("--primary:199 89% 48%");
    expect(css).toContain("--accent:350 89% 60%");
    expect(css).toContain("--radius:0.75rem");
  });
});
