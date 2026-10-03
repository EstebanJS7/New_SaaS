import { describe, expect, it } from "vitest";
import { resolveFiscalProvider } from "./fiscal-provider.module.js";

/**
 * Pins the production refusal defense-in-depth copy at the package composition
 * root. The authoritative `apiEnvSchema` gate is covered by the API config suite.
 */
describe("fiscal provider resolution", () => {
  it("returns undefined outside production when nothing is configured", () => {
    expect(resolveFiscalProvider("development", undefined)).toBeUndefined();
    expect(resolveFiscalProvider("test", undefined)).toBeUndefined();
    expect(resolveFiscalProvider(undefined, undefined)).toBeUndefined();
  });

  it("accepts the explicit fake value in every environment", () => {
    expect(resolveFiscalProvider("development", "fake")).toBe("fake");
    expect(resolveFiscalProvider("test", "fake")).toBe("fake");
    expect(resolveFiscalProvider("production", "fake")).toBe("fake");
  });

  it("refuses an unset provider in production", () => {
    expect(() => resolveFiscalProvider("production", undefined)).toThrow(
      /FISCAL_PROVIDER is required in production/
    );
  });

  it("accepts only the package's closed fake-provider value", () => {
    expect(() => resolveFiscalProvider("development", "third_party")).toThrow(
      /FISCAL_PROVIDER must be one of/
    );
    expect(() => resolveFiscalProvider("production", "SIFEN_DIRECT")).toThrow(
      /FISCAL_PROVIDER must be one of/
    );
  });
});
