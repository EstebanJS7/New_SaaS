import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { FISCAL_PROVIDER, isRetryableOutcome } from "./fiscal-provider.port.js";
import type {
  FiscalCancelOutcome,
  FiscalIssueOutcome,
  FiscalQueryOutcome,
} from "./fiscal-provider.port.js";

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

  it("rejects SUBMITTED, because the hand-over succeeded and a retry would duplicate it", () => {
    // ADR-007 guardrail 1. The document is unresolved, not failed: the worker
    // must not rethrow for BullMQ to retry, and the provider treats a second
    // send of a document it still holds as a blocking offence.
    expect(isRetryableOutcome("SUBMITTED")).toBe(false);
  });

  it("keeps every issuance outcome but TRANSIENT_FAILURE terminal", () => {
    const outcomes: readonly FiscalIssueOutcome[] = [
      "APPROVED",
      "REJECTED",
      "FUNCTIONAL_REJECTION",
      "SUBMITTED",
      "CONFIGURATION_ERROR",
      "TRANSIENT_FAILURE",
    ];
    expect(outcomes.filter((outcome) => isRetryableOutcome(outcome))).toEqual([
      "TRANSIENT_FAILURE",
    ]);
    // `SUBMITTED` is the non-terminal member ADR-007 §1 adds, so its presence
    // here is the assertion that the amendment survives a refactor.
    expect(outcomes).toContain("SUBMITTED");
    expect(outcomes).toHaveLength(6);
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

/**
 * ADR-007 guardrail 4: the port learns no provider constant.
 *
 * The check reads the port's own source because the strings that must not appear
 * are the protocol's: element names, service names and result codes are things a
 * TypeScript scanner cannot see through `readonly string | null` fields. The one
 * legitimate occurrence is the provider identifier the port already mirrors from
 * the `fiscal_provider` enum, so that block is removed before the scan and the
 * removal is itself asserted — otherwise a scan that stripped too much would
 * pass vacuously.
 */
describe("the port's public surface", () => {
  const source = readFileSync(
    fileURLToPath(new URL("fiscal-provider.port.ts", import.meta.url)),
    "utf8"
  );
  const providerIdBlock =
    /export const FISCAL_PROVIDER_VALUES = Object\.freeze\(\[[\s\S]*?\] as const\);/.exec(source);

  /** Protocol vocabulary that may not enter a provider-agnostic port. */
  const FORBIDDEN = [
    "lote",
    "dprotconslote",
    "dcodres",
    "destres",
    "gresproc",
    "0360",
    "0361",
    "0362",
    "0364",
    "recibe",
    "consulta",
    "wsdl",
    "soapaction",
    "sifen",
  ] as const;

  it("names the provider identifier exactly where the port must, and nowhere else", () => {
    expect(providerIdBlock, "the provider-id block must exist to be excluded").not.toBeNull();
    expect(providerIdBlock?.[0]).toContain('"SIFEN_DIRECT"');
    const scanned = source.replace(providerIdBlock![0], "");
    expect(scanned).not.toBe(source);
    for (const token of FORBIDDEN) {
      expect(scanned.toLowerCase(), `port surface must not carry ${token}`).not.toContain(token);
    }
  });

  it("exposes the query vocabulary without borrowing the persistence layer's words", () => {
    const outcomes: readonly FiscalQueryOutcome[] = [
      "APPROVED",
      "REJECTED",
      "FUNCTIONAL_REJECTION",
      "PROCESSING",
      "CONFIGURATION_ERROR",
      "TRANSIENT_FAILURE",
    ];
    // `PROCESSING` and not `PENDING`, which is already a fiscal document status:
    // ADR-007 §1 names the collision the choice avoids.
    expect(outcomes).toContain("PROCESSING");
    expect(outcomes).not.toContain("PENDING");
    expect(typeof FISCAL_PROVIDER).toBe("symbol");
  });
});
