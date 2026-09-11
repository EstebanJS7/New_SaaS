import { describe, expect, it } from "vitest";
import { coreDesignDefaults } from "./core-defaults.js";
import { veterinaryDefaultPreset } from "./presets/veterinary-default.js";
import { resolveBrand } from "./resolve-brand.js";
import type { ProductBrandPreset } from "./types.js";

describe("resolveBrand", () => {
  it("lets every preset-defined property win over core defaults", () => {
    const resolved = resolveBrand(veterinaryDefaultPreset);
    expect(resolved.presetCode).toBe(veterinaryDefaultPreset.code);
    expect(resolved.theme).toEqual(veterinaryDefaultPreset.theme);
    // No tenant layer: absence is preserved so the OS preference can win.
    expect(resolved.defaultAppearance).toBeUndefined();
  });

  it("keeps the core default for properties the preset does not define", () => {
    // Simulates a runtime-incomplete preset to prove per-property tolerance.
    const partialPreset = {
      code: "fixture-partial",
      productName: "Partial Preset",
      theme: { colors: { primary: "hsl(10 20% 30%)" }, radius: "0.5rem" },
    } as unknown as ProductBrandPreset;

    const resolved = resolveBrand(partialPreset);

    expect(resolved.theme.colors.primary).toBe("hsl(10 20% 30%)");
    expect(resolved.theme.radius).toBe("0.5rem");
    expect(resolved.theme.colors.background).toBe(coreDesignDefaults.colors.background);
    expect(resolved.theme.colors.accent).toBe(coreDesignDefaults.colors.accent);
    expect(resolved.theme.fonts.sans).toBe(coreDesignDefaults.fonts.sans);
  });

  it("applies patch refinements over the preset without touching siblings", () => {
    const resolved = resolveBrand(veterinaryDefaultPreset, {
      radius: "1rem",
      colors: { status: { success: "hsl(100 50% 50%)" } },
    });

    expect(resolved.theme.radius).toBe("1rem");
    expect(resolved.theme.colors.status.success).toBe("hsl(100 50% 50%)");
    expect(resolved.theme.colors.status.error).toBe(
      veterinaryDefaultPreset.theme.colors.status.error
    );
    expect(resolved.theme.colors.primary).toBe(veterinaryDefaultPreset.theme.colors.primary);
  });

  it("treats absent, null and empty tenant layers identically", () => {
    const withoutTenant = resolveBrand(veterinaryDefaultPreset);
    const nullTenant = resolveBrand(veterinaryDefaultPreset, undefined, null);
    // A validated-but-empty override carries no editable keys.
    const emptyTenant = resolveBrand(veterinaryDefaultPreset, undefined, { schemaVersion: 1 });

    expect(nullTenant).toEqual(withoutTenant);
    expect(emptyTenant).toEqual(withoutTenant);
  });

  it("applies validated tenant overrides above preset values", () => {
    const resolved = resolveBrand(veterinaryDefaultPreset, undefined, {
      schemaVersion: 1,
      primary: "hsl(250 70% 60%)",
      radius: "1.5rem",
    });

    expect(resolved.theme.colors.primary).toBe("hsl(250 70% 60%)");
    expect(resolved.theme.radius).toBe("1.5rem");
    expect(resolved.theme.colors.accent).toBe(veterinaryDefaultPreset.theme.colors.accent);
  });

  it("resolves defaultAppearance from the tenant override only", () => {
    expect(resolveBrand(veterinaryDefaultPreset).defaultAppearance).toBeUndefined();
    expect(
      resolveBrand(veterinaryDefaultPreset, undefined, {
        schemaVersion: 1,
        defaultAppearance: "dark",
      }).defaultAppearance
    ).toBe("dark");
  });

  it("does not mutate its inputs", () => {
    const presetSnapshot = structuredClone(veterinaryDefaultPreset);
    const defaultsSnapshot = structuredClone(coreDesignDefaults);

    resolveBrand(
      veterinaryDefaultPreset,
      { colors: { accent: "hsl(0 0% 0%)" } },
      {
        schemaVersion: 1,
        primary: "hsl(0 0% 0%)",
      }
    );

    expect(veterinaryDefaultPreset).toEqual(presetSnapshot);
    expect(coreDesignDefaults).toEqual(defaultsSnapshot);
  });
});
