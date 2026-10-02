import { describe, expect, it } from "vitest";
import { createFakeFiscalProvider } from "./fake-fiscal.provider.js";
import type { FiscalIssueRequest, FiscalIssueResult } from "./fiscal-provider.port.js";

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
