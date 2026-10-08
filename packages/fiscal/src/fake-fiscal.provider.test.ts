import { describe, expect, it } from "vitest";
import { createFakeFiscalProvider } from "./fake-fiscal.provider.js";
import type {
  FiscalCancelRequest,
  FiscalCancelResult,
  FiscalIssueRequest,
  FiscalIssueResult,
  FiscalQueryOutcome,
  FiscalQueryRequest,
  FiscalQueryResult,
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

/** The recovery path's request: the handle is absent, the document's identity is not. */
const queryRequest: FiscalQueryRequest = {
  fiscalDocumentId: "document-1",
  tenantId: "tenant-1",
  provider: "FAKE",
  cdc: "cdc-1",
  externalId: null,
  providerReference: null,
};

async function query(
  provider: ReturnType<typeof createFakeFiscalProvider>
): Promise<FiscalQueryResult> {
  return provider.query(queryRequest);
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

  it.each([
    ["SUBMITTED", "fake-ref-1"],
    ["APPROVED", null],
    ["REJECTED", null],
    ["FUNCTIONAL_REJECTION", null],
    ["CONFIGURATION_ERROR", null],
    ["TRANSIENT_FAILURE", null],
  ] as const)("returns the operation handle %s carries", async (outcome, providerReference) => {
    // ADR-007 §2: the handle belongs to the HAND-OVER and to nothing else. A
    // `SUBMITTED` without one would leave the reconciliation path with nothing to
    // poll with, and a handle on a resolved answer would blur it with the
    // document reference.
    const result = await issue(createFakeFiscalProvider({ outcomes: [outcome] }));
    expect(result.providerReference).toBe(providerReference);
  });

  it("derives the operation handle from its prefix and the 1-based call index", async () => {
    const provider = createFakeFiscalProvider({
      outcomes: ["SUBMITTED"],
      providerReferencePrefix: "operation",
    });
    expect((await issue(provider)).providerReference).toBe("operation-1");
    expect((await issue(provider)).providerReference).toBe("operation-2");
  });

  it("keeps the operation handle distinct from the document's external id", async () => {
    const provider = createFakeFiscalProvider({ outcomes: ["SUBMITTED", "APPROVED"] });
    const submitted = await issue(provider);
    const approved = await issue(provider);
    expect(submitted.externalId).toBeNull();
    expect(submitted.providerReference).toBe("fake-ref-1");
    expect(approved.externalId).toBe("fake-2");
    expect(approved.providerReference).toBeNull();
    expect(submitted.providerReference).not.toBe(approved.externalId);
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

  it("consumes the query script in order and repeats its last entry", async () => {
    const provider = createFakeFiscalProvider({
      queryOutcomes: ["PROCESSING", "PROCESSING", "APPROVED"],
    });
    expect((await query(provider)).outcome).toBe("PROCESSING");
    expect((await query(provider)).outcome).toBe("PROCESSING");
    expect((await query(provider)).outcome).toBe("APPROVED");
    expect((await query(provider)).outcome).toBe("APPROVED");
  });

  it("answers a query with APPROVED by default, including an empty script", async () => {
    expect((await query(createFakeFiscalProvider())).outcome).toBe("APPROVED");
    const provider = createFakeFiscalProvider({ queryOutcomes: [] });
    expect((await query(provider)).outcome).toBe("APPROVED");
    expect((await query(provider)).outcome).toBe("APPROVED");
  });

  it("returns the required query shape for every outcome", async () => {
    const expected: readonly [FiscalQueryOutcome, string | null, number | null][] = [
      ["APPROVED", null, null],
      ["PROCESSING", null, null],
      ["REJECTED", "FAKE_REJECTED", null],
      ["FUNCTIONAL_REJECTION", "FAKE_FUNCTIONAL_REJECTION", null],
      ["CONFIGURATION_ERROR", "FAKE_CONFIGURATION_ERROR", null],
      ["TRANSIENT_FAILURE", "FAKE_TRANSIENT_FAILURE", 1_000],
    ];
    for (const [outcome, reasonCode, retryAfterMs] of expected) {
      const result = await query(createFakeFiscalProvider({ queryOutcomes: [outcome] }));
      expect(result.outcome, outcome).toBe(outcome);
      expect(result.reasonCode, outcome).toBe(reasonCode);
      expect(result.reason === null, outcome).toBe(reasonCode === null);
      // With no scripted hint, `PROCESSING` is an answer rather than a failure
      // and carries none: the provider's polling cadence is a protocol constant
      // the adapter owns, and the knob that scripts one is exercised separately.
      expect(result.retryAfterMs, outcome).toBe(retryAfterMs);
      expect(result.externalId === null, outcome).toBe(outcome !== "APPROVED");
    }
  });

  it("keeps issue, query and cancellation scripts on independent counters", async () => {
    const provider = createFakeFiscalProvider({
      outcomes: ["APPROVED", "SUBMITTED"],
      queryOutcomes: ["PROCESSING", "APPROVED"],
      cancelOutcomes: ["CANCEL_PENDING", "CANCELLED"],
    });
    expect((await issue(provider)).outcome).toBe("APPROVED");
    expect((await query(provider)).outcome).toBe("PROCESSING");
    expect((await cancel(provider)).outcome).toBe("CANCEL_PENDING");
    expect((await query(provider)).outcome).toBe("APPROVED");
    expect((await issue(provider)).outcome).toBe("SUBMITTED");
    expect((await cancel(provider)).outcome).toBe("CANCELLED");
  });

  it("uses the injected clock for a query", async () => {
    const result = await query(
      createFakeFiscalProvider({ clock: () => new Date("2026-02-03T04:05:06.000Z") })
    );
    expect(result.resolvedAt).toBe("2026-02-03T04:05:06.000Z");
  });

  it("carries a scripted retry hint on a PROCESSING answer", async () => {
    // ADR-007 guardrail 5: `retryAfterMs` is what keeps the reconciliation sweep
    // from hot-looping against an answer of "still processing". Without a knob the
    // bound would be untestable with the fake, and the fake is what makes the
    // contract exercisable before a real provider exists.
    const result = await query(
      createFakeFiscalProvider({ queryOutcomes: ["PROCESSING"], queryRetryAfterMs: 60_000 })
    );
    expect(result.outcome).toBe("PROCESSING");
    expect(result.retryAfterMs).toBe(60_000);
    // The hint is not a reason code: `PROCESSING` is not a failure.
    expect(result.reasonCode).toBeNull();
  });

  it("carries no retry hint for PROCESSING unless the option supplies one", async () => {
    const result = await query(createFakeFiscalProvider({ queryOutcomes: ["PROCESSING"] }));
    expect(result.outcome).toBe("PROCESSING");
    expect(result.retryAfterMs).toBeNull();
  });

  it("never attaches the scripted PROCESSING hint to another outcome", async () => {
    // The knob belongs to "keep waiting". A transient failure keeps its own fixed
    // hint so a test can tell the two apart, and an answer carries none.
    const transient = await query(
      createFakeFiscalProvider({ queryOutcomes: ["TRANSIENT_FAILURE"], queryRetryAfterMs: 60_000 })
    );
    expect(transient.retryAfterMs).toBe(1_000);
    for (const outcome of [
      "APPROVED",
      "REJECTED",
      "FUNCTIONAL_REJECTION",
      "CONFIGURATION_ERROR",
    ] as const) {
      const result = await query(
        createFakeFiscalProvider({ queryOutcomes: [outcome], queryRetryAfterMs: 60_000 })
      );
      expect(result.retryAfterMs, outcome).toBeNull();
    }
  });

  it("answers a query without protocol artefacts, whatever the script says", async () => {
    for (const outcome of [
      "APPROVED",
      "PROCESSING",
      "REJECTED",
      "FUNCTIONAL_REJECTION",
      "CONFIGURATION_ERROR",
      "TRANSIENT_FAILURE",
    ] as const) {
      const result = await query(createFakeFiscalProvider({ queryOutcomes: [outcome] }));
      for (const payload of [result.providerRequest, result.providerResponse]) {
        expect(payload).toBeTypeOf("object");
        expect(payload).not.toBeNull();
        const serialized = JSON.stringify(payload);
        expect(serialized, outcome).not.toMatch(/<\/?[a-z][^>]*>/i);
        expect(serialized, outcome).not.toMatch(/xml|signature|certificate|private.?key/i);
      }
    }
  });

  it("answers a query for the recovery path, which carries no handle", async () => {
    // ADR-007 §2: the query is identified by whatever the document has, so the
    // scripted answer must not depend on the handle being present.
    const provider = createFakeFiscalProvider({ queryOutcomes: ["APPROVED"] });
    const withoutHandle = await provider.query({ ...queryRequest, providerReference: null });
    const withHandle = await provider.query({ ...queryRequest, providerReference: "operation-1" });
    expect(withoutHandle.outcome).toBe("APPROVED");
    expect(withHandle.outcome).toBe("APPROVED");
  });

  it("confirms the CDC the question carried", async () => {
    const result = await query(createFakeFiscalProvider({ queryOutcomes: ["APPROVED"] }));
    expect(result.cdc).toBe(queryRequest.cdc);
  });

  it("hands back the CDC it was not given, for a resolved answer", async () => {
    // The lost-hand-over case ADR-007 §2 exists for: the request carries no
    // identity, the answer is what tells us which document it resolved. A fake
    // that could only echo would leave the recovery path unexercisable.
    for (const outcome of ["APPROVED", "REJECTED", "FUNCTIONAL_REJECTION"] as const) {
      const result = await createFakeFiscalProvider({ queryOutcomes: [outcome] }).query({
        ...queryRequest,
        cdc: null,
      });
      expect(result.outcome, outcome).toBe(outcome);
      expect(result.cdc, outcome).not.toBeNull();
    }
  });

  it("hands back no CDC for an answer that resolved nothing", async () => {
    // Including when the question carried one: an unresolved or failed answer
    // identifies no document, so reporting a CDC there would be an identity the
    // provider never confirmed. `queryRequest` carries `cdc-1` on purpose.
    for (const outcome of ["PROCESSING", "TRANSIENT_FAILURE", "CONFIGURATION_ERROR"] as const) {
      const result = await createFakeFiscalProvider({ queryOutcomes: [outcome] }).query(
        queryRequest
      );
      expect(result.outcome, outcome).toBe(outcome);
      expect(result.cdc, outcome).toBeNull();
    }
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
