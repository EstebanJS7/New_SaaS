import { describe, expect, it, vi, type Mock } from "vitest";
import { Prisma } from "@newsaas/database";
import type {
  FiscalIssueOutcome,
  FiscalIssueRequest,
  FiscalIssueResult,
  FiscalProviderPort,
} from "@newsaas/fiscal";
import { FiscalSubmissionHandler, mapOutcomeToStatus } from "./fiscal-submission.handler.js";

type Status =
  "PENDING" | "QUEUED" | "ERROR" | "APPROVED" | "REJECTED" | "SENDING" | "SUBMITTED" | "CANCELLED";
const job = {
  fiscalDocumentId: "00000000-0000-4000-8000-000000000001",
  tenantId: "00000000-0000-4000-8000-000000000002",
};
const outcomes: readonly {
  outcome: FiscalIssueOutcome;
  status: "APPROVED" | "REJECTED" | "ERROR";
  resolved: boolean;
}[] = [
  { outcome: "APPROVED", status: "APPROVED", resolved: true },
  { outcome: "REJECTED", status: "REJECTED", resolved: true },
  { outcome: "FUNCTIONAL_REJECTION", status: "REJECTED", resolved: true },
  { outcome: "CONFIGURATION_ERROR", status: "ERROR", resolved: false },
  { outcome: "TRANSIENT_FAILURE", status: "ERROR", resolved: false },
];

interface DocumentFixture {
  readonly id: string;
  readonly tenantId: string;
  readonly invoiceId: string;
  readonly provider: "FAKE";
  readonly status: Status;
  readonly attemptCount: number;
  readonly lastAttemptAt: Date | null;
}

/**
 * The returned members are typed explicitly: without a declared return type the
 * mocks infer loosely enough that every destructuring becomes an unsafe
 * assignment under the repo's strict lint rules.
 */
interface SetupResult {
  readonly handler: FiscalSubmissionHandler;
  readonly issue: Mock<(request: FiscalIssueRequest) => Promise<FiscalIssueResult>>;
  readonly findFirst: Mock<() => Promise<DocumentFixture | null>>;
  readonly updates: { where: unknown; data: Record<string, unknown> }[];
}

function setup(
  status: Status = "PENDING",
  outcome: FiscalIssueOutcome = "APPROVED",
  lastAttemptAt: Date | null = null
): SetupResult {
  const document: DocumentFixture = {
    id: job.fiscalDocumentId,
    tenantId: job.tenantId,
    invoiceId: "00000000-0000-4000-8000-000000000003",
    provider: "FAKE" as const,
    status,
    attemptCount: 2,
    lastAttemptAt,
  };
  const line = {
    description: "Consultation",
    quantity: new Prisma.Decimal("1.000"),
    unitPrice: new Prisma.Decimal("10.00"),
    rateCode: "EXEMPT",
    taxableBase: new Prisma.Decimal("10.00"),
    taxAmount: new Prisma.Decimal("0.00"),
    lineTotal: new Prisma.Decimal("10.00"),
  };
  const invoice = {
    series: "A",
    number: 42,
    currency: "PYG",
    confirmedAt: new Date("2026-01-02T03:04:05.000Z"),
    lines: [line],
  };
  const updates: { where: unknown; data: Record<string, unknown> }[] = [];
  const findFirst = vi.fn<() => Promise<DocumentFixture | null>>(() => Promise.resolve(document));
  const invoiceFind = vi.fn(() => Promise.resolve(invoice));
  const updateMany = vi.fn((args: { where: unknown; data: Record<string, unknown> }) => {
    updates.push(args);
    return Promise.resolve({ count: 1 });
  });
  const result: FiscalIssueResult = {
    outcome,
    externalId: "external-1",
    cdc: "cdc-1",
    reasonCode: "R-1",
    reason: "Provider reason",
    retryAfterMs: null,
    providerRequest: { provider: "FAKE", secret: "do-not-persist" },
    providerResponse: { status: "ok", token: "do-not-persist" },
    resolvedAt: "2026-01-02T03:05:00.000Z",
  };
  const issue = vi.fn(() => Promise.resolve(result));
  const provider = { provider: "FAKE", issue } as FiscalProviderPort;
  const tx = {
    fiscalDocument: { updateMany },
    auditLog: {
      create: vi.fn(() => Promise.resolve({ id: "00000000-0000-4000-8000-000000000004" })),
    },
  };
  const prisma = {
    fiscalDocument: { findFirst, updateMany },
    invoice: { findFirst: invoiceFind },
    $transaction: async (work: (transaction: typeof tx) => Promise<unknown>) => work(tx),
  };
  const handler = new FiscalSubmissionHandler(prisma as never, provider);
  return { handler, issue, findFirst, updates };
}

describe("mapOutcomeToStatus", () => {
  it.each(outcomes)("maps $outcome exactly", ({ outcome, status, resolved }) => {
    expect(mapOutcomeToStatus(outcome)).toEqual({ status, resolved });
  });
});

describe("FiscalSubmissionHandler", () => {
  it.each(["PENDING", "QUEUED", "ERROR"] as const)(
    "claims %s as SENDING and increments the attempt",
    async (status) => {
      const { handler, updates, issue } = setup(status);
      await handler.handle(job);
      const claimed = updates[0]?.data;
      expect(claimed?.status).toBe("SENDING");
      expect(claimed?.attemptCount).toEqual({ increment: 1 });
      expect(claimed?.lastAttemptAt).toBeInstanceOf(Date);
      expect(issue).toHaveBeenCalledOnce();
    }
  );

  it.each(outcomes)("persists the pinned fields for $outcome", async ({ outcome, status }) => {
    const { handler, updates } = setup("PENDING", outcome);
    if (outcome === "TRANSIENT_FAILURE")
      await expect(handler.handle(job)).rejects.toThrow("Provider reason");
    else await handler.handle(job);
    const finalData = updates[1]?.data;
    expect(finalData).toMatchObject({
      status,
      requestSnapshot: { provider: "FAKE", secret: "[redacted]" },
      responseSnapshot: { status: "ok", token: "[redacted]" },
    });
    if (outcome === "APPROVED") {
      expect(finalData?.externalId).toBe("external-1");
      expect(finalData?.cdc).toBe("cdc-1");
      expect(finalData?.resolvedAt).toBeInstanceOf(Date);
    }
    if (outcome === "REJECTED" || outcome === "FUNCTIONAL_REJECTION") {
      expect(finalData?.externalId).toBe("external-1");
      expect(finalData?.lastErrorCode).toBe("R-1");
      expect(finalData?.lastErrorMessage).toBe("Provider reason");
      expect(finalData?.resolvedAt).toBeInstanceOf(Date);
    }
    if (outcome === "CONFIGURATION_ERROR" || outcome === "TRANSIENT_FAILURE") {
      expect(finalData?.lastErrorCode).toBe("R-1");
      expect(finalData?.lastErrorMessage).toBe("Provider reason");
    }
  });

  it("persists ERROR before rethrowing TRANSIENT_FAILURE", async () => {
    const { handler, updates } = setup("PENDING", "TRANSIENT_FAILURE");
    await expect(handler.handle(job)).rejects.toThrow("Provider reason");
    expect(updates[1]?.data).toMatchObject({ status: "ERROR" });
  });

  it.each(["APPROVED", "REJECTED", "CANCELLED", "SENDING", "SUBMITTED"] as const)(
    "does not resubmit %s",
    async (status) => {
      // A fresh claim is the one case where a `SENDING` row is off limits: it
      // belongs to another worker that is still inside its lease.
      const { handler, issue, updates } = setup(status, "APPROVED", new Date());
      await handler.handle(job);
      expect(issue).not.toHaveBeenCalled();
      expect(updates).toHaveLength(0);
    }
  );

  it("takes over an abandoned SENDING claim", async () => {
    // A worker that died between committing `SENDING` and writing a result leaves
    // the row claimed forever: the transition guard admits no other exit, and the
    // reconciliation sweep is deferred. Past the lease a redelivery must be able
    // to take it over, or the document is stalled silently and permanently.
    const abandoned = new Date(Date.now() - 10 * 60_000);
    const { handler, issue, updates } = setup("SENDING", "APPROVED", abandoned);
    await handler.handle(job);
    expect(issue).toHaveBeenCalledOnce();
    expect(updates[0]?.data).toMatchObject({ status: "SENDING" });
    // The re-claim is a compare-and-swap on the OBSERVED lease timestamp, so two
    // workers that both see the same abandoned claim cannot both win it.
    expect(updates[0]?.where).toMatchObject({
      status: "SENDING",
      lastAttemptAt: abandoned,
    });
  });

  it("no-ops when the document is missing", async () => {
    const state = setup();
    state.findFirst.mockResolvedValueOnce(null);
    await state.handler.handle(job);
    expect(state.issue).not.toHaveBeenCalled();
    expect(state.updates).toHaveLength(0);
  });

  it("sends decimal strings and confirmedAt as UTC ISO 8601", async () => {
    const { handler, issue } = setup();
    await handler.handle(job);
    const request = issue.mock.calls[0]?.[0];
    expect(request?.invoice.issuedAt).toBe("2026-01-02T03:04:05.000Z");
    expect(request?.lines[0]?.quantity).toBe("1");
    expect(request?.lines[0]?.unitPrice).toBe("10");
    expect(request?.lines[0]?.lineTotal).toBe("10");
    expect(request?.totals).toEqual({ taxableBase: "10", taxAmount: "0", total: "10" });
  });
});
