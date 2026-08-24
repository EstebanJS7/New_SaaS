import { describe, it, expect } from "vitest";
import { veterinaryDefaultPreset } from "./veterinary-default.js";
import { brandThemeSchema } from "../brand-theme.schema.js";
import { coreDesignDefaults } from "../core-defaults.js";

describe("veterinaryDefaultPreset", () => {
  it("parses brandThemeSchema without edits elsewhere", () => {
    const parsed = brandThemeSchema.parse(veterinaryDefaultPreset.theme);

    // Schema strips nothing and rejects nothing: the preset ships as-is.
    expect(parsed).toEqual(veterinaryDefaultPreset.theme);
  });

  it("carries preset identity metadata with reserved asset fields", () => {
    expect(veterinaryDefaultPreset.code).toBe("veterinary-default");
    expect(veterinaryDefaultPreset.productName.length).toBeGreaterThan(0);
    expect("assets" in veterinaryDefaultPreset).toBe(false);
  });

  it("defines an identity distinct from CoreDesignDefaults", () => {
    // Swapping core defaults for this preset must change resolved token
    // inputs wherever the preset declares a different value; the full
    // CSS-variable map comparison lands with the resolver slice.
    expect(veterinaryDefaultPreset.theme.colors.primary).not.toBe(
      coreDesignDefaults.colors.primary
    );
    expect(veterinaryDefaultPreset.theme.colors.accent).not.toBe(coreDesignDefaults.colors.accent);
    expect(veterinaryDefaultPreset.theme.colors.background).not.toBe(
      coreDesignDefaults.colors.background
    );
    expect(veterinaryDefaultPreset.theme.radius).not.toBe(coreDesignDefaults.radius);
    expect(veterinaryDefaultPreset.theme.fonts.sans).not.toBe(coreDesignDefaults.fonts.sans);
  });
});
