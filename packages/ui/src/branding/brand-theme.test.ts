import { describe, it, expect } from "vitest";
import { coreDesignDefaults } from "./core-defaults.js";
import { brandThemeSchema, APPROVED_FONT_FAMILIES } from "./brand-theme.schema.js";

describe("coreDesignDefaults", () => {
  it("passes the brand theme schema", () => {
    expect(() => brandThemeSchema.parse(coreDesignDefaults)).not.toThrow();
  });

  it("uses semantic status tokens instead of a top-level success color", () => {
    expect(coreDesignDefaults.colors.status.success).toBeDefined();
    expect(coreDesignDefaults.colors.status.error).toBeDefined();
    expect("success" in coreDesignDefaults.colors).toBe(false);
  });
});

describe("brandThemeSchema", () => {
  it("rejects arbitrary CSS in a color value", () => {
    const invalid = {
      ...coreDesignDefaults,
      colors: {
        ...coreDesignDefaults.colors,
        primary: "url(http://evil.example)",
      },
    };

    expect(() => brandThemeSchema.parse(invalid)).toThrow();
  });

  it("rejects an unapproved font family", () => {
    const invalid = {
      ...coreDesignDefaults,
      fonts: {
        sans: "Comic Sans MS, sans-serif",
        mono: coreDesignDefaults.fonts.mono,
      },
    };

    expect(() => brandThemeSchema.parse(invalid)).toThrow("approved font-family names");
  });

  it("accepts approved font stacks with quoted names", () => {
    const valid = {
      ...coreDesignDefaults,
      fonts: {
        sans: '"Inter", system-ui, sans-serif',
        mono: '"SFMono-Regular", Menlo, monospace',
      },
    };

    expect(() => brandThemeSchema.parse(valid)).not.toThrow();
  });

  it("rejects a radius that is not a positive rem value", () => {
    const invalid = {
      ...coreDesignDefaults,
      radius: "12px",
    };

    expect(() => brandThemeSchema.parse(invalid)).toThrow("rem value");
  });
});

describe("APPROVED_FONT_FAMILIES", () => {
  it("includes every family used by CoreDesignDefaults", () => {
    const usedFamilies = [
      ...coreDesignDefaults.fonts.sans.split(","),
      ...coreDesignDefaults.fonts.mono.split(","),
    ]
      .map((family) => family.trim().replace(/^["']|["']$/g, ""))
      .filter(Boolean);

    for (const family of usedFamilies) {
      expect(APPROVED_FONT_FAMILIES).toContain(family);
    }
  });
});
