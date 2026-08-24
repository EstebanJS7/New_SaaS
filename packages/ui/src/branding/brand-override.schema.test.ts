import { describe, expect, it } from "vitest";
import {
  BRAND_OVERRIDE_ERROR_CODES,
  BRAND_OVERRIDE_SCHEMA_VERSION,
  BrandOverrideValidationError,
  brandOverrideSchema,
  validateBrandOverride,
} from "./brand-override.schema.js";

const validFull = {
  schemaVersion: BRAND_OVERRIDE_SCHEMA_VERSION,
  primary: "hsl(173 80% 28%)",
  accent: "#f59e0b",
  radius: "0.75rem",
  defaultAppearance: "dark",
} as const;

describe("brandOverrideSchema", () => {
  it("accepts a complete override carrying the current schema version", () => {
    const parsed = brandOverrideSchema.parse(validFull);
    expect(parsed).toEqual(validFull);
  });

  it("accepts any subset of the four editable keys", () => {
    const subsets = [
      { schemaVersion: 1, primary: "hsl(10 20% 30%)" },
      { schemaVersion: 1, accent: "#112233" },
      { schemaVersion: 1, radius: "1rem" },
      { schemaVersion: 1, defaultAppearance: "system" },
      { schemaVersion: 1 },
    ];
    for (const subset of subsets) {
      expect(brandOverrideSchema.parse(subset)).toEqual(subset);
    }
  });
});

describe("validateBrandOverride", () => {
  it("returns the parsed override for valid input", () => {
    expect(validateBrandOverride(validFull)).toEqual(validFull);
  });

  it.each([
    [
      "unknown key",
      { schemaVersion: 1, background: "hsl(0 0% 100%)" },
      BRAND_OVERRIDE_ERROR_CODES.UNKNOWN_KEY,
    ],
    [
      "unsafe color value",
      { schemaVersion: 1, primary: "url(javascript:alert(1))" },
      BRAND_OVERRIDE_ERROR_CODES.INVALID_VALUE,
    ],
    [
      "unapproved plain color name",
      { schemaVersion: 1, accent: "red" },
      BRAND_OVERRIDE_ERROR_CODES.INVALID_VALUE,
    ],
    [
      "non-rem radius",
      { schemaVersion: 1, radius: "10px" },
      BRAND_OVERRIDE_ERROR_CODES.INVALID_VALUE,
    ],
    [
      "unknown appearance",
      { schemaVersion: 1, defaultAppearance: "purple" },
      BRAND_OVERRIDE_ERROR_CODES.INVALID_VALUE,
    ],
    [
      "older version",
      { ...validFull, schemaVersion: 0 },
      BRAND_OVERRIDE_ERROR_CODES.UNSUPPORTED_VERSION,
    ],
    [
      "newer version",
      { ...validFull, schemaVersion: 2 },
      BRAND_OVERRIDE_ERROR_CODES.UNSUPPORTED_VERSION,
    ],
    [
      "missing version",
      { primary: "hsl(10 20% 30%)" },
      BRAND_OVERRIDE_ERROR_CODES.UNSUPPORTED_VERSION,
    ],
  ])("rejects %s with a stable error code", (_label, input, expectedCode) => {
    expect.assertions(4);
    try {
      validateBrandOverride(input);
      expect.unreachable("expected validation to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(BrandOverrideValidationError);
      const validationError = error as BrandOverrideValidationError;
      expect(validationError.name).toBe("BrandOverrideValidationError");
      expect(validationError.code).toBe(expectedCode);
      expect(Object.values(BRAND_OVERRIDE_ERROR_CODES)).toContain(validationError.code);
    }
  });

  it("rejects non-object payloads", () => {
    expect(() => validateBrandOverride("dark")).toThrow(BrandOverrideValidationError);
    expect(() => validateBrandOverride(null)).toThrow(BrandOverrideValidationError);
  });
});
