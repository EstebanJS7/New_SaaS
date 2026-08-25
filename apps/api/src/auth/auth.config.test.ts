import { describe, expect, it } from "vitest";
import { readAuthConfig } from "./auth.config.js";

/**
 * Design D4 transport baseline: the session cookie is `Secure` in EVERY
 * environment except local development. The predicate must fail safe — an
 * unset or exotic NODE_ENV (staging, QA, …) stays secure; only "development"
 * downgrades.
 */
describe("readAuthConfig — cookie Secure posture", () => {
  it("maps every non-development environment to Secure ON", () => {
    for (const nodeEnv of ["production", "staging", "qa", "test"] as const) {
      expect(readAuthConfig({ NODE_ENV: nodeEnv }).cookieSecure).toBe(true);
    }
  });

  it("maps ONLY development to Secure OFF", () => {
    expect(readAuthConfig({ NODE_ENV: "development" }).cookieSecure).toBe(false);
  });

  it("fails safe when NODE_ENV is unset (secure by default)", () => {
    expect(readAuthConfig({}).cookieSecure).toBe(true);
  });
});
