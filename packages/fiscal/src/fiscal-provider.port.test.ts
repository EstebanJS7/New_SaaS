import { describe, expect, it } from "vitest";
import { isRetryableOutcome } from "./fiscal-provider.port.js";

describe("isRetryableOutcome", () => {
  it("accepts TRANSIENT_FAILURE", () => {
    expect(isRetryableOutcome("TRANSIENT_FAILURE")).toBe(true);
  });

  it("rejects APPROVED", () => {
    expect(isRetryableOutcome("APPROVED")).toBe(false);
  });

  it("rejects REJECTED", () => {
    expect(isRetryableOutcome("REJECTED")).toBe(false);
  });

  it("rejects FUNCTIONAL_REJECTION", () => {
    expect(isRetryableOutcome("FUNCTIONAL_REJECTION")).toBe(false);
  });

  it("rejects CONFIGURATION_ERROR", () => {
    expect(isRetryableOutcome("CONFIGURATION_ERROR")).toBe(false);
  });
});
