import { afterEach, describe, expect, it, vi } from "vitest";
import type { FiscalCancelResult } from "@newsaas/fiscal";
import {
  cancelWithinDeadline,
  FISCAL_CANCEL_TIMEOUT_MS,
  FISCAL_CANCEL_TIMEOUT_REASON,
  FISCAL_CANCEL_TIMEOUT_REASON_CODE,
} from "./fiscal.service.js";

function cancelResult(outcome: FiscalCancelResult["outcome"]): FiscalCancelResult {
  return {
    outcome,
    reasonCode: null,
    reason: null,
    retryAfterMs: null,
    providerRequest: null,
    providerResponse: null,
    resolvedAt: "2026-01-01T00:00:00.000Z",
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("cancelWithinDeadline", () => {
  it("returns the provider result unchanged when it settles before the deadline", async () => {
    const providerResult = cancelResult("CANCELLED");
    let signal: AbortSignal | undefined;

    const result = await cancelWithinDeadline((receivedSignal) => {
      signal = receivedSignal;
      return Promise.resolve(providerResult);
    }, 100);

    expect(result).toBe(providerResult);
    expect(signal?.aborted).toBe(false);
  });

  it("returns a retryable timeout failure and aborts the provider signal", async () => {
    const deadlineMs = 10;
    let signal: AbortSignal | undefined;

    const result = await cancelWithinDeadline((receivedSignal) => {
      signal = receivedSignal;
      return new Promise<FiscalCancelResult>((resolve) => {
        void resolve;
      });
    }, deadlineMs);

    expect(result.outcome).toBe("TRANSIENT_FAILURE");
    expect(result.reasonCode).toBe(FISCAL_CANCEL_TIMEOUT_REASON_CODE);
    expect(result.reason).toBe(FISCAL_CANCEL_TIMEOUT_REASON);
    expect(result.retryAfterMs).toBe(deadlineMs);
    expect(signal?.aborted).toBe(true);
  });

  it("propagates a provider rejection unchanged", async () => {
    const rejection = new Error("provider failed");

    await expect(cancelWithinDeadline(() => Promise.reject(rejection), 100)).rejects.toBe(
      rejection
    );
  });

  it("clears the deadline timer when the provider settles first", async () => {
    vi.useFakeTimers();

    await cancelWithinDeadline(
      () => Promise.resolve(cancelResult("CANCELLED")),
      FISCAL_CANCEL_TIMEOUT_MS
    );
    await vi.advanceTimersByTimeAsync(FISCAL_CANCEL_TIMEOUT_MS);

    expect(vi.getTimerCount()).toBe(0);
  });

  it("uses a positive finite default deadline", () => {
    expect(Number.isFinite(FISCAL_CANCEL_TIMEOUT_MS)).toBe(true);
    expect(FISCAL_CANCEL_TIMEOUT_MS).toBeGreaterThan(0);
  });
});
