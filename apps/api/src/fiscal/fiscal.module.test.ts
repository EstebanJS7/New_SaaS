import { describe, expect, it } from "vitest";
import { FISCAL_PROVIDER_ENV_VALUES } from "../config/api-env.schema.js";
import { resolveFiscalProvider } from "./fiscal.module.js";

/**
 * The composition root's production refusal is a safety path with deployment
 * impact, so it is pinned here rather than living only inside a Nest factory
 * where nothing would notice it regressing. The authoritative gate is
 * `apiEnvSchema`'s `superRefine` and is covered by its own suite; this covers the
 * defense-in-depth copy at the composition root.
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

  it("refuses a value outside the closed set", () => {
    expect(() => resolveFiscalProvider("development", "third_party")).toThrow(
      /FISCAL_PROVIDER must be one of/
    );
    expect(() => resolveFiscalProvider("production", "SIFEN_DIRECT")).toThrow(
      /FISCAL_PROVIDER must be one of/
    );
  });

  it("keeps the closed set in one place", () => {
    // A widened set is a config decision, so it must be a deliberate edit to the
    // single exported constant both the schema and this resolver read.
    expect(FISCAL_PROVIDER_ENV_VALUES).toEqual(["fake"]);
  });
});
