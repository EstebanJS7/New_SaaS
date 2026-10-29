import { describe, expect, it } from "vitest";
import { assertCommercialDemoEnvironment } from "./demo-environment.js";

describe("commercial demo environment boundary", () => {
  it.each([undefined, "production", "staging"])(
    "refuses NODE_ENV=%s even with explicit opt-in",
    (NODE_ENV) => {
      expect(() =>
        assertCommercialDemoEnvironment({ NODE_ENV, ENABLE_DEMO_SEED: "true" })
      ).toThrow();
    }
  );
  it("requires explicit opt-in", () => {
    expect(() => assertCommercialDemoEnvironment({ NODE_ENV: "development" })).toThrow();
  });
  it.each(["FISCAL_PROVIDER", "EMAIL_PROVIDER", "WHATSAPP_PROVIDER"])(
    "refuses a real %s",
    (key) => {
      expect(() =>
        assertCommercialDemoEnvironment({
          NODE_ENV: "development",
          ENABLE_DEMO_SEED: "true",
          [key]: "real",
        })
      ).toThrow();
    }
  );
  it("allows the explicitly selected local fake providers", () => {
    expect(() =>
      assertCommercialDemoEnvironment({
        NODE_ENV: "development",
        ENABLE_DEMO_SEED: "true",
        FISCAL_PROVIDER: "fake",
        EMAIL_PROVIDER: "fake",
        WHATSAPP_PROVIDER: "fake",
      })
    ).not.toThrow();
  });
});
