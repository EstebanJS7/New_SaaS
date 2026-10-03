import { describe, expect, it } from "vitest";
import { isRetryableOutcome } from "./fiscal-provider.port.js";
import type { FiscalCancelOutcome } from "./fiscal-provider.port.js";

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

  it("reuses retryability safely for every cancellation outcome", () => {
    const outcomes: readonly FiscalCancelOutcome[] = [
      "CANCELLED",
      "CANCEL_PENDING",
      "REJECTED",
      "CONFIGURATION_ERROR",
      "TRANSIENT_FAILURE",
    ];
    const accepted = outcomes.filter((outcome) => isRetryableOutcome(outcome));
    expect(accepted).toEqual(["TRANSIENT_FAILURE"]);
    expect(outcomes).toHaveLength(5);
  });
});
