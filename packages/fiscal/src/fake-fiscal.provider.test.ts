import { describe, expect, it } from "vitest";
import { createFakeFiscalProvider } from "./fake-fiscal.provider.js";
import type {
  FiscalCancelRequest,
  FiscalCancelResult,
  FiscalIssueRequest,
  FiscalIssueResult,
} from "./fiscal-provider.port.js";

const request: FiscalIssueRequest = {
  fiscalDocumentId: "document-1",
  tenantId: "tenant-1",
  provider: "FAKE",
  invoice: { series: "A", number: 1, currency: "PYG", issuedAt: "2026-10-02T00:00:00.000Z" },
  lines: [],
  totals: { taxableBase: "0", taxAmount: "0", total: "0" },
};

async function issue(
  provider: ReturnType<typeof createFakeFiscalProvider>
): Promise<FiscalIssueResult> {
  return provider.issue(request);
}

const cancelRequest: FiscalCancelRequest = {
  fiscalDocumentId: "document-1",
  tenantId: "tenant-1",
  provider: "FAKE",
  reason: "Operator request",
  externalId: "fake-1",
  cdc: null,
};

async function cancel(
  provider: ReturnType<typeof createFakeFiscalProvider>
): Promise<FiscalCancelResult> {
  return provider.cancel(cancelRequest);
}

describe("FakeFiscalProvider", () => {
  it("consumes the script in order and repeats its last entry", async () => {
    const provider = createFakeFiscalProvider({ outcomes: ["APPROVED", "REJECTED"] });
    expect((await issue(provider)).outcome).toBe("APPROVED");
    expect((await issue(provider)).outcome).toBe("REJECTED");
    expect((await issue(provider)).outcome).toBe("REJECTED");
  });

  it("derives reproducible external IDs from the 1-based call index", async () => {
    const provider = createFakeFiscalProvider({ externalIdPrefix: "demo" });
    const first = await issue(provider);
    const second = await issue(provider);
    expect(first.externalId).toBe("demo-1");
    expect(second.externalId).toBe("demo-2");
  });

  it("returns a single APPROVED outcome by default", async () => {
    expect((await issue(createFakeFiscalProvider())).outcome).toBe("APPROVED");
  });

  it("falls back to APPROVED for an empty script rather than failing", async () => {
    // An empty script is the degenerate case of "shorter than the call count":
    // there is no last entry to repeat, so the default stands instead of the
    // fake throwing on a dev process that configured nothing.
    const provider = createFakeFiscalProvider({ outcomes: [] });
    expect((await issue(provider)).outcome).toBe("APPROVED");
    expect((await issue(provider)).outcome).toBe("APPROVED");
  });

  it.each([
    ["APPROVED", "externalId"],
    ["REJECTED", "reasonCode"],
    ["FUNCTIONAL_REJECTION", "reasonCode"],
    ["CONFIGURATION_ERROR", "reasonCode"],
    ["TRANSIENT_FAILURE", "retryAfterMs"],
  ] as const)("preserves the required result shape for %s", async (outcome, requiredField) => {
    const result = await issue(createFakeFiscalProvider({ outcomes: [outcome] }));
    if (requiredField === "externalId") {
      expect(result.externalId).not.toBeNull();
      expect(result.reasonCode).toBeNull();
    } else if (requiredField === "retryAfterMs") {
      expect(result.retryAfterMs).not.toBeNull();
      expect(result.externalId).toBeNull();
    } else {
      expect(result.reasonCode).toMatch(/^FAKE_[A-Z_]+$/);
      expect(result.externalId).toBeNull();
    }
  });

  it("consumes cancellation outcomes in order and repeats the last entry", async () => {
    const provider = createFakeFiscalProvider({ cancelOutcomes: ["CANCEL_PENDING", "CANCELLED"] });
    expect((await cancel(provider)).outcome).toBe("CANCEL_PENDING");
    expect((await cancel(provider)).outcome).toBe("CANCELLED");
    expect((await cancel(provider)).outcome).toBe("CANCELLED");
  });

  it("defaults cancellation to CANCELLED, including an empty script", async () => {
    expect((await cancel(createFakeFiscalProvider())).outcome).toBe("CANCELLED");
    const provider = createFakeFiscalProvider({ cancelOutcomes: [] });
    expect((await cancel(provider)).outcome).toBe("CANCELLED");
    expect((await cancel(provider)).outcome).toBe("CANCELLED");
  });

  it.each([
    ["CANCELLED", null, null],
    ["CANCEL_PENDING", null, null],
    ["REJECTED", "FAKE_REJECTED", null],
    ["CONFIGURATION_ERROR", "FAKE_CONFIGURATION_ERROR", null],
    ["TRANSIENT_FAILURE", "FAKE_TRANSIENT_FAILURE", 1_000],
  ] as const)("returns the required cancellation shape for %s", async (outcome, code, retry) => {
    const result = await cancel(createFakeFiscalProvider({ cancelOutcomes: [outcome] }));
    expect(result.outcome).toBe(outcome);
    expect(result.reasonCode).toBe(code);
    expect(result.reason === null).toBe(code === null);
    expect(result.retryAfterMs).toBe(retry);
  });

  it("keeps issue and cancellation scripts on independent counters", async () => {
    const provider = createFakeFiscalProvider({
      outcomes: ["APPROVED", "REJECTED"],
      cancelOutcomes: ["CANCEL_PENDING", "CANCELLED"],
    });
    expect((await issue(provider)).outcome).toBe("APPROVED");
    expect((await cancel(provider)).outcome).toBe("CANCEL_PENDING");
    expect((await cancel(provider)).outcome).toBe("CANCELLED");
    expect((await issue(provider)).outcome).toBe("REJECTED");
  });

  it("uses the injected clock for cancellation", async () => {
    const result = await cancel(
      createFakeFiscalProvider({ clock: () => new Date("2026-01-02T03:04:05.000Z") })
    );
    expect(result.resolvedAt).toBe("2026-01-02T03:04:05.000Z");
  });

  it("returns cancellation JSON payloads without protocol artefacts", async () => {
    const result = await cancel(createFakeFiscalProvider());
    for (const payload of [result.providerRequest, result.providerResponse]) {
      expect(payload).toBeTypeOf("object");
      expect(payload).not.toBeNull();
      const serialized = JSON.stringify(payload);
      expect(serialized).not.toMatch(/<\/?[a-z][^>]*>/i);
      expect(serialized).not.toMatch(/xml|signature|certificate|private.?key|cdc/i);
    }
  });

  it("uses the injected clock for an ISO 8601 UTC timestamp", async () => {
    const result = await issue(
      createFakeFiscalProvider({ clock: () => new Date("2026-01-02T03:04:05.000Z") })
    );
    expect(result.resolvedAt).toBe("2026-01-02T03:04:05.000Z");
  });

  it("returns JSON raw payloads without XML or signature/protocol artefacts", async () => {
    const result = await issue(createFakeFiscalProvider({ outcomes: ["APPROVED"] }));
    for (const payload of [result.providerRequest, result.providerResponse]) {
      expect(payload).toBeTypeOf("object");
      expect(payload).not.toBeNull();
      const serialized = JSON.stringify(payload);
      expect(serialized).not.toMatch(/<\/?[a-z][^>]*>/i);
      expect(serialized).not.toMatch(/xml|signature|certificate|private.?key|cdc/i);
      const keys = Object.keys(payload as Record<string, unknown>);
      expect(keys.some((key) => /xml|signature|certificate|private.?key|protocol/i.test(key))).toBe(
        false
      );
    }
  });
});
