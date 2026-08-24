import { describe, expect, it } from "vitest";
import { brandThemeSchema } from "./brand-theme.schema.js";
import { veterinaryDefaultPreset } from "./presets/veterinary-default.js";
import { resolveBrand } from "./resolve-brand.js";
import { toCssVariables } from "./to-css-variables.js";
import type { ProductBrandPreset } from "./types.js";

/**
 * Alternative schema-valid identity used for the swap scenario: different
 * primary/accent/radius/sans, but deliberately sharing background and mono
 * with the veterinary preset so equality is proven to be value-driven.
 */
const alternativePreset: ProductBrandPreset = {
  code: "fixture-alternative",
  productName: "Alternative Identity",
  theme: {
    colors: {
      background: veterinaryDefaultPreset.theme.colors.background,
      foreground: "#101828",
      card: "hsl(220 30% 98%)",
      "card-foreground": "#0f172a",
      primary: "hsl(243 75% 59%)",
      "primary-foreground": "hsl(0 0% 100%)",
      secondary: "hsl(220 14% 96%)",
      "secondary-foreground": "hsl(243 75% 59%)",
      muted: "hsl(220 14% 96%)",
      "muted-foreground": "hsl(215 16% 47%)",
      accent: "hsl(347 77% 60%)",
      "accent-foreground": "hsl(0 0% 100%)",
      destructive: "hsl(0 72% 51%)",
      "destructive-foreground": "hsl(0 0% 98%)",
      status: { success: "hsl(152 60% 40%)", error: "hsl(0 72% 51%)" },
      border: "hsl(220 13% 91%)",
      input: "hsl(220 13% 88%)",
      ring: "hsl(243 75% 59%)",
    },
    radius: "0.25rem",
    fonts: {
      sans: "Inter, ui-sans-serif, system-ui, sans-serif",
      mono: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
    },
  },
};

describe("toCssVariables", () => {
  it("strips hsl() wrappers into bare triplets", () => {
    const map = toCssVariables(resolveBrand(veterinaryDefaultPreset));

    expect(map["--primary"]).toBe("173 80% 28%");
    expect(map["--primary"]).not.toContain("hsl(");
    expect(map["--status-success"]).toBe("152 62% 34%");
  });

  it("emits radius and font stacks verbatim", () => {
    const map = toCssVariables(resolveBrand(veterinaryDefaultPreset));

    expect(map["--radius"]).toBe("0.75rem");
    expect(map["--font-sans"]).toBe('"Noto Sans", ui-sans-serif, system-ui, sans-serif');
    expect(map["--font-mono"]).toBe("ui-monospace, SFMono-Regular, Menlo, Consolas, monospace");
  });

  it("covers exactly the branding-owned tokens from globals.css", () => {
    const map = toCssVariables(resolveBrand(veterinaryDefaultPreset));
    const keys = Object.keys(map);

    expect(keys).toHaveLength(22);
    expect(keys.every((key) => key.startsWith("--"))).toBe(true);
    // The popover pair stays stylesheet-owned; branding never overrides it.
    expect(keys).not.toContain("--popover");
    expect(keys).not.toContain("--popover-foreground");
  });

  it("normalizes schema-blessed hex into bare HSL triplets", () => {
    const map = toCssVariables(
      resolveBrand(alternativePreset, { colors: { accent: "#ff0000" } }),
    );

    // #101828 from the fixture: rgb(16 24 40) → 220° 43% 11%.
    expect(map["--foreground"]).toBe("220 43% 11%");
    // #ff0000 patch: pure red → 0° 100% 50%.
    expect(map["--accent"]).toBe("0 100% 50%");
    // No hex can survive the bridge — hsl(var(--x)) cannot render it.
    expect(Object.values(map).some((value) => value.startsWith("#"))).toBe(false);
  });

  it("swapping presets changes only the variables whose values differ", () => {
    expect(brandThemeSchema.safeParse(alternativePreset.theme).success).toBe(true);

    const veterinary = toCssVariables(resolveBrand(veterinaryDefaultPreset));
    const alternative = toCssVariables(resolveBrand(alternativePreset));

    expect(alternative["--primary"]).not.toBe(veterinary["--primary"]);
    expect(alternative["--accent"]).not.toBe(veterinary["--accent"]);
    expect(alternative["--radius"]).not.toBe(veterinary["--radius"]);
    expect(alternative["--font-sans"]).not.toBe(veterinary["--font-sans"]);
    // Shared values stay shared — the diff is driven by data, not identity.
    expect(alternative["--background"]).toBe(veterinary["--background"]);
    expect(alternative["--font-mono"]).toBe(veterinary["--font-mono"]);
  });
});
