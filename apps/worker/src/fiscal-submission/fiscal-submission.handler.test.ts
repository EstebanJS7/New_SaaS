import { describe, expect, it, vi, type Mock } from "vitest";
import { Prisma } from "@newsaas/database";
import {
  DteSchemaError,
  type FiscalIssueDocument,
  type FiscalIssueOutcome,
  type FiscalIssueRequest,
  type FiscalIssueResult,
  type FiscalProviderPort,
} from "@newsaas/fiscal";
import type { StoragePort } from "@newsaas/storage";
import type {
  FiscalDocumentBuildOutcome,
  FiscalDocumentBuildRequest,
} from "./fiscal-document-builder.js";
import { FiscalSubmissionHandler, mapOutcomeToStatus } from "./fiscal-submission.handler.js";

/**
 * The stage's two external answers — the XSD gate and the schema directory —
 * are mocked so each case scripts them directly; everything else the handler
 * imports from `@newsaas/fiscal` is the real code.
 */
const { gateSpy, schemaDirectorySpy } = vi.hoisted(() => ({
  gateSpy: vi.fn(),
  schemaDirectorySpy: vi.fn(() => "/opt/newsaas/dte-xsd"),
}));

vi.mock("@newsaas/fiscal", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@newsaas/fiscal")>();
  return {
    ...actual,
    validateDeAgainstOfficialXsd: gateSpy,
    defaultDteSchemaDirectory: schemaDirectorySpy,
  };
});

type Status =
  | "PENDING"
  | "QUEUED"
  | "ERROR"
  | "APPROVED"
  | "REJECTED"
  | "SIGNING"
  | "SENDING"
  | "SUBMITTED"
  | "CANCELLED";
const job = {
  fiscalDocumentId: "00000000-0000-4000-8000-000000000001",
  tenantId: "00000000-0000-4000-8000-000000000002",
};
const outcomes: readonly {
  outcome: FiscalIssueOutcome;
  status: "APPROVED" | "REJECTED" | "ERROR" | "SUBMITTED";
  resolved: boolean;
}[] = [
  { outcome: "APPROVED", status: "APPROVED", resolved: true },
  { outcome: "REJECTED", status: "REJECTED", resolved: true },
  { outcome: "FUNCTIONAL_REJECTION", status: "REJECTED", resolved: true },
  { outcome: "SUBMITTED", status: "SUBMITTED", resolved: false },
  { outcome: "CONFIGURATION_ERROR", status: "ERROR", resolved: false },
  { outcome: "TRANSIENT_FAILURE", status: "ERROR", resolved: false },
];

/** The document the seam hands back; its bytes are distinctive to catch leaks. */
const BUILT_DOCUMENT: FiscalIssueDocument = {
  cdc: "cdc-built-1",
  signedXml: '<rDE Id="cdc-built-1"><dVerFor>150</dVerFor></rDE>',
};

interface DocumentFixture {
  readonly id: string;
  readonly tenantId: string;
  readonly invoiceId: string;
  readonly provider: "FAKE";
  readonly status: Status;
  readonly attemptCount: number;
  readonly lastAttemptAt: Date | null;
  readonly xmlStorageKey: string | null;
  readonly cdc: string | null;
}

interface InvoiceLineFixture {
  readonly description: string;
  readonly quantity: Prisma.Decimal;
  readonly unitPrice: Prisma.Decimal;
  readonly rateCode: string;
  readonly taxableBase: Prisma.Decimal;
  readonly taxAmount: Prisma.Decimal;
  readonly lineTotal: Prisma.Decimal;
}

interface InvoiceFixture {
  readonly series: string;
  readonly number: number;
  readonly currency: string;
  readonly confirmedAt: Date;
  readonly lines: readonly InvoiceLineFixture[];
}

/** What a case scripts for the stage; every field has a default. */
interface StageScript {
  readonly requiresSignedDocument?: boolean;
  readonly build?: FiscalDocumentBuildOutcome;
  readonly gate?: { readonly valid: boolean; readonly errors: readonly string[] };
  readonly gateError?: DteSchemaError;
  /** The custody a `SENDING` recovery reads back. */
  readonly stored?: { readonly xmlStorageKey: string | null; readonly cdc: string | null };
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
  readonly invoiceFind: Mock<() => Promise<InvoiceFixture | null>>;
  readonly build: Mock<
    (request: FiscalDocumentBuildRequest) => Promise<FiscalDocumentBuildOutcome>
  >;
  readonly storagePut: Mock<
    (args: { key: string; body: Buffer; contentType: string }) => Promise<{
      key: string;
      byteSize: number;
    }>
  >;
  readonly storageGet: Mock<
    (args: { key: string }) => Promise<{ body: Buffer; contentType: string }>
  >;
  readonly updates: { where: unknown; data: Record<string, unknown> }[];
}

function setup(
  status: Status = "PENDING",
  outcome: FiscalIssueOutcome = "APPROVED",
  lastAttemptAt: Date | null = null,
  /** The document identity the provider's answer carries, varied by case. */
  identity: { readonly cdc: string | null; readonly externalId: string | null } = {
    cdc: "cdc-1",
    externalId: "external-1",
  },
  /** The hand-over handle the provider's answer carries; `null` is a real case. */
  providerReference: string | null = "operation-1",
  stage: StageScript = {}
): SetupResult {
  const document: DocumentFixture = {
    id: job.fiscalDocumentId,
    tenantId: job.tenantId,
    invoiceId: "00000000-0000-4000-8000-000000000003",
    provider: "FAKE" as const,
    status,
    attemptCount: 2,
    lastAttemptAt,
    xmlStorageKey: stage.stored?.xmlStorageKey ?? null,
    cdc: stage.stored?.cdc ?? null,
  };
  const line: InvoiceLineFixture = {
    description: "Consultation",
    quantity: new Prisma.Decimal("1.000"),
    unitPrice: new Prisma.Decimal("10.00"),
    rateCode: "EXEMPT",
    taxableBase: new Prisma.Decimal("10.00"),
    taxAmount: new Prisma.Decimal("0.00"),
    lineTotal: new Prisma.Decimal("10.00"),
  };
  const invoice: InvoiceFixture = {
    series: "A",
    number: 42,
    currency: "PYG",
    confirmedAt: new Date("2026-01-02T03:04:05.000Z"),
    lines: [line],
  };
  const updates: { where: unknown; data: Record<string, unknown> }[] = [];
  const findFirst = vi.fn<() => Promise<DocumentFixture | null>>(() => Promise.resolve(document));
  const invoiceFind = vi.fn<() => Promise<InvoiceFixture | null>>(() => Promise.resolve(invoice));
  const updateMany = vi.fn((args: { where: unknown; data: Record<string, unknown> }) => {
    updates.push(args);
    return Promise.resolve({ count: 1 });
  });
  const result: FiscalIssueResult = {
    outcome,
    externalId: identity.externalId,
    providerReference,
    cdc: identity.cdc,
    reasonCode: "R-1",
    reason: "Provider reason",
    retryAfterMs: null,
    providerRequest: { provider: "FAKE", secret: "do-not-persist" },
    providerResponse: { status: "ok", token: "do-not-persist" },
    resolvedAt: "2026-01-02T03:05:00.000Z",
  };
  const issue = vi.fn(() => Promise.resolve(result));
  // The submission handler never cancels or queries, but the port requires both
  // methods: a double missing one is a contract the test would not be testing.
  const cancel = vi.fn(() => Promise.reject(new Error("cancel is not used by the handler")));
  const query = vi.fn(() => Promise.reject(new Error("query is not used by the handler")));
  const provider: FiscalProviderPort = {
    provider: "FAKE",
    requiresSignedDocument: stage.requiresSignedDocument ?? false,
    issue,
    query,
    cancel,
  };

  const buildOutcome: FiscalDocumentBuildOutcome = stage.build ?? {
    outcome: "BUILT",
    document: BUILT_DOCUMENT,
  };
  const build = vi.fn(() => Promise.resolve(buildOutcome));
  const storagePut = vi.fn((args: { key: string; body: Buffer; contentType: string }) =>
    Promise.resolve({ key: args.key, byteSize: args.body.byteLength })
  );
  const storageGet = vi.fn(() =>
    Promise.resolve({
      body: Buffer.from(BUILT_DOCUMENT.signedXml, "utf8"),
      contentType: "application/xml",
    })
  );
  const storage: StoragePort = {
    put: storagePut,
    get: storageGet,
    delete: vi.fn(() => Promise.resolve()),
    signedUrl: vi.fn(() => Promise.resolve("https://storage.example.test/signed")),
  };

  gateSpy.mockReset();
  schemaDirectorySpy.mockReset();
  schemaDirectorySpy.mockReturnValue("/opt/newsaas/dte-xsd");
  gateSpy.mockResolvedValue({
    valid: stage.gate?.valid ?? true,
    errors: stage.gate?.errors ?? [],
    schemaDirectory: "/opt/newsaas/dte-xsd",
  });
  if (stage.gateError !== undefined) {
    gateSpy.mockRejectedValue(stage.gateError);
  }

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
  const handler = new FiscalSubmissionHandler(prisma as never, provider, { build }, storage);
  return { handler, issue, findFirst, invoiceFind, build, storagePut, storageGet, updates };
}

describe("mapOutcomeToStatus", () => {
  it.each(outcomes)("maps $outcome exactly", ({ outcome, status, resolved }) => {
    expect(mapOutcomeToStatus(outcome)).toEqual({ status, resolved });
  });
});

describe("FiscalSubmissionHandler", () => {
  it.each(["PENDING", "QUEUED", "ERROR"] as const)(
    "claims %s as SIGNING and increments the attempt",
    async (status) => {
      const { handler, updates, issue } = setup(status);
      await handler.handle(job);
      const claimed = updates[0]?.data;
      expect(claimed?.status).toBe("SIGNING");
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
    if (outcome !== "SUBMITTED") {
      // Only the hand-over owns the handle and the hand-over timestamp.
      expect(finalData?.providerReference).toBeUndefined();
      expect(finalData?.submittedAt).toBeUndefined();
    }
  });

  it("enters SUBMITTED with its handle, its timestamp and its identity in one update, and does not retry", async () => {
    const { handler, updates } = setup("PENDING", "SUBMITTED");
    // ADR-007 guardrail 1: a hand-over is not a failure, so nothing may be
    // rethrown for BullMQ to retry. A second send of a document the provider
    // already holds is the duplicate submission its own rules punish.
    await expect(handler.handle(job)).resolves.toBeUndefined();
    const finalData = updates[1]?.data;
    // Guardrail 3: the handle lands in the SAME update that enters the state, so
    // a crash between the provider's answer and the next sweep cannot lose it.
    // The CDC and the document reference land with it when the answer carries
    // them: ADR-007 §2 makes the CDC the identifier that survives losing the
    // hand-over answer, so dropping it here would make the recovery path the
    // only one the document has left.
    expect(finalData).toMatchObject({
      status: "SUBMITTED",
      providerReference: "operation-1",
      cdc: "cdc-1",
      externalId: "external-1",
      submittedAt: new Date("2026-01-02T03:05:00.000Z"),
    });
    // SUBMITTED is unresolved: `resolved_at` is required only on entry to
    // APPROVED or REJECTED, and writing it here would be a lie in the row.
    expect(finalData?.resolvedAt).toBeUndefined();
    // The result write stays a conditional update on the claim it is resolving,
    // so a stolen or recovered claim cannot be overwritten by a stale answer.
    expect(updates[1]?.where).toMatchObject({ status: { in: ["SENDING"] } });
  });

  it("leaves cdc and external_id untouched when a SUBMITTED result carries no identity", async () => {
    // A hand-over answer that carries neither must write neither. Writing `null`
    // would be a clearing attempt the transition guard refuses — and, where it
    // did not, it would erase the identity the recovery path needs.
    const { handler, updates } = setup("PENDING", "SUBMITTED", null, {
      cdc: null,
      externalId: null,
    });
    await handler.handle(job);
    const finalData = updates[1]?.data;
    expect(finalData?.status).toBe("SUBMITTED");
    expect(finalData?.providerReference).toBe("operation-1");
    expect(finalData?.submittedAt).toBeInstanceOf(Date);
    expect(finalData?.cdc).toBeUndefined();
    expect(finalData?.externalId).toBeUndefined();
  });

  it("writes no provider_reference when the hand-over answer carries none", async () => {
    const { handler, updates } = setup(
      "PENDING",
      "SUBMITTED",
      null,
      { cdc: null, externalId: null },
      null
    );
    await handler.handle(job);
    const finalData = updates[1]?.data;
    expect(finalData?.status).toBe("SUBMITTED");
    expect(finalData?.submittedAt).toBeInstanceOf(Date);
    // Absent, not null: a `null` write is a clearing attempt the transition
    // guard refuses, and on the retry path it would abort the transaction.
    expect(finalData).not.toHaveProperty("providerReference");
  });

  it("never clears a handle the row already holds, on a retried hand-over", async () => {
    // The scenario the resilience lens named: a SUBMITTED document that became
    // ERROR is re-driven to SENDING and handed over again while the row still
    // carries its first handle. Writing `null` would abort the transaction, and
    // an aborted transaction here is a retried submission of a document the
    // provider already holds.
    const { handler, updates } = setup(
      "ERROR",
      "SUBMITTED",
      null,
      { cdc: null, externalId: null },
      null
    );
    await handler.handle(job);
    expect(updates[1]?.data).not.toHaveProperty("providerReference");
  });

  it("keeps a SUBMITTED document off the claimable set after the hand-over", async () => {
    // The same double-delivery protection APPROVED and REJECTED already have:
    // the reconciliation path queries a SUBMITTED row, it never resubmits it.
    const { handler, issue, updates } = setup("SUBMITTED", "APPROVED");
    await handler.handle(job);
    expect(issue).not.toHaveBeenCalled();
    expect(updates).toHaveLength(0);
  });

  it("persists ERROR before rethrowing TRANSIENT_FAILURE", async () => {
    const { handler, updates } = setup("PENDING", "TRANSIENT_FAILURE");
    await expect(handler.handle(job)).rejects.toThrow("Provider reason");
    expect(updates[1]?.data).toMatchObject({ status: "ERROR" });
  });

  it.each(["APPROVED", "REJECTED", "CANCELLED", "SIGNING", "SENDING", "SUBMITTED"] as const)(
    "does not resubmit %s",
    async (status) => {
      // A fresh claim is the one case where a `SIGNING`/`SENDING` row is off
      // limits: it belongs to another worker that is still inside its lease.
      const { handler, issue, updates } = setup(status, "APPROVED", new Date());
      await handler.handle(job);
      expect(issue).not.toHaveBeenCalled();
      expect(updates).toHaveLength(0);
    }
  );

  it("takes over an abandoned SENDING claim without rewriting its status", async () => {
    // A worker that died between committing `SENDING` and writing a result leaves
    // the row claimed forever: the transition guard admits no other exit, and the
    // reconciliation sweep is deferred. Past the lease a redelivery must be able
    // to take it over, or the document is stalled silently and permanently.
    // The guard admits no `SENDING -> SIGNING`, so the re-claim keeps `SENDING`.
    const abandoned = new Date(Date.now() - 10 * 60_000);
    const { handler, issue, updates } = setup("SENDING", "APPROVED", abandoned);
    await handler.handle(job);
    expect(issue).toHaveBeenCalledOnce();
    expect(updates[0]?.data).not.toHaveProperty("status");
    expect(updates[0]?.data).toMatchObject({ attemptCount: { increment: 1 } });
    // The re-claim is a compare-and-swap on the OBSERVED lease timestamp, so two
    // workers that both see the same abandoned claim cannot both win it.
    expect(updates[0]?.where).toMatchObject({
      status: "SENDING",
      lastAttemptAt: abandoned,
    });
  });

  it("re-claims an abandoned SIGNING row as SIGNING by lease timestamp", async () => {
    // The recovery for a worker that died while signing: `SIGNING` is admitted
    // by the guard as a claim, and `SIGNING -> SIGNING` is not a transition at
    // all, so the re-claim must not write a status.
    const abandoned = new Date(Date.now() - 10 * 60_000);
    const { handler, issue, updates, build } = setup(
      "SIGNING",
      "APPROVED",
      abandoned,
      undefined,
      undefined,
      { requiresSignedDocument: true }
    );
    await handler.handle(job);
    expect(updates[0]?.data).not.toHaveProperty("status");
    expect(updates[0]?.where).toMatchObject({ status: "SIGNING", lastAttemptAt: abandoned });
    // The stage runs again from the claim: build, custody, gate, submit.
    expect(build).toHaveBeenCalledOnce();
    expect(issue).toHaveBeenCalledOnce();
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

  it("lands a missing invoice snapshot on ERROR with a named reason", async () => {
    const state = setup();
    state.invoiceFind.mockResolvedValueOnce(null);
    await state.handler.handle(job);
    expect(state.issue).not.toHaveBeenCalled();
    expect(state.updates[1]?.data).toMatchObject({
      status: "ERROR",
      lastErrorCode: "INVOICE_SNAPSHOT_UNAVAILABLE",
    });
  });

  it("never asks the assembly for a document when the provider requires none", async () => {
    const { handler, build, storagePut, issue } = setup();
    await handler.handle(job);
    // ADR-009/guardrail 2: the flag is honoured, not assumed. The fake path
    // stays free of the fiscal profile and of storage.
    expect(build).not.toHaveBeenCalled();
    expect(storagePut).not.toHaveBeenCalled();
    expect(issue.mock.calls[0]?.[0]?.document).toBeNull();
  });

  it("stores the signed XML first, writes xml_storage_key and cdc, gates it, then submits", async () => {
    const { handler, updates, issue, build, storagePut } = setup(
      "PENDING",
      "APPROVED",
      null,
      undefined,
      undefined,
      { requiresSignedDocument: true }
    );
    await handler.handle(job);

    expect(build).toHaveBeenCalledWith({
      tenantId: job.tenantId,
      fiscalDocumentId: job.fiscalDocumentId,
    });
    // The custody: the signed bytes reach storage under the fiscal prefix...
    const putArgs = storagePut.mock.calls[0]?.[0];
    expect(putArgs?.key).toMatch(/^fiscal-document_/);
    expect(putArgs?.body.toString("utf8")).toBe(BUILT_DOCUMENT.signedXml);
    expect(putArgs?.contentType).toBe("application/xml");
    // ... the key and the CDC are written while the row is still SIGNING ...
    expect(updates[1]?.where).toMatchObject({ status: "SIGNING" });
    expect(updates[1]?.data).toMatchObject({
      xmlStorageKey: putArgs?.key,
      cdc: BUILT_DOCUMENT.cdc,
    });
    // ... the gate runs on the SIGNED bytes and the deployment's directory ...
    expect(gateSpy).toHaveBeenCalledWith(BUILT_DOCUMENT.signedXml, "/opt/newsaas/dte-xsd");
    // ... and only then `SIGNING -> SENDING`, with the document on the request.
    expect(updates[2]?.where).toMatchObject({ status: "SIGNING" });
    expect(updates[2]?.data).toMatchObject({ status: "SENDING" });
    expect(issue.mock.calls[0]?.[0]?.document).toEqual(BUILT_DOCUMENT);
  });

  it("fails closed when the document seam is unavailable", async () => {
    const { handler, updates, issue, storagePut } = setup(
      "PENDING",
      "APPROVED",
      null,
      undefined,
      undefined,
      {
        requiresSignedDocument: true,
        build: {
          outcome: "UNAVAILABLE",
          reasonCode: "DOCUMENT_ASSEMBLY_UNAVAILABLE",
          reason: "The document assembly is not implemented in this deployment (FISC-015).",
        },
      }
    );
    await handler.handle(job);

    expect(storagePut).not.toHaveBeenCalled();
    expect(issue).not.toHaveBeenCalled();
    expect(updates[1]?.data).toMatchObject({
      status: "ERROR",
      lastErrorCode: "DOCUMENT_ASSEMBLY_UNAVAILABLE",
      lastErrorMessage: "The document assembly is not implemented in this deployment (FISC-015).",
    });
  });

  it("stores before validating, and a refused document is never submitted", async () => {
    const { handler, updates, issue, storagePut } = setup(
      "PENDING",
      "APPROVED",
      null,
      undefined,
      undefined,
      {
        requiresSignedDocument: true,
        gate: {
          valid: false,
          errors: ["first diagnostic", "second diagnostic", "third diagnostic", "not carried"],
        },
      }
    );
    await handler.handle(job);

    // Store-then-validate: the refused document stays inspectable.
    expect(storagePut).toHaveBeenCalledOnce();
    expect(typeof updates[1]?.data.xmlStorageKey).toBe("string");
    expect(issue).not.toHaveBeenCalled();
    expect(updates[2]?.data).toMatchObject({
      status: "ERROR",
      lastErrorCode: "XSD_VALIDATION_FAILED",
    });
    const message = String(updates[2]?.data.lastErrorMessage);
    expect(message).toContain("first diagnostic");
    expect(message).not.toContain("not carried");
    // ADR-010 guardrail 5: the diagnostics carry no document bytes.
    expect(message).not.toContain("<rDE");
    // No SENDING transition happened: the document was never submitted.
    expect(updates.some((update) => update.data.status === "SENDING")).toBe(false);
  });

  it("fails closed when the schema directory is unusable, naming the directory", async () => {
    const error = new DteSchemaError(
      "DIRECTORY_UNUSABLE",
      "Schema directory /opt/newsaas/dte-xsd is not usable: missing [DE_v150.xsd]."
    );
    const { handler, updates, issue } = setup("PENDING", "APPROVED", null, undefined, undefined, {
      requiresSignedDocument: true,
      gateError: error,
    });
    await handler.handle(job);

    expect(issue).not.toHaveBeenCalled();
    expect(updates[2]?.data).toMatchObject({
      status: "ERROR",
      lastErrorCode: "DIRECTORY_UNUSABLE",
    });
    expect(String(updates[2]?.data.lastErrorMessage)).toContain("/opt/newsaas/dte-xsd");
  });

  it("resends the stored document when an abandoned SENDING row is re-claimed", async () => {
    const abandoned = new Date(Date.now() - 10 * 60_000);
    const { handler, issue, build, storagePut, storageGet, updates } = setup(
      "SENDING",
      "APPROVED",
      abandoned,
      undefined,
      undefined,
      {
        requiresSignedDocument: true,
        stored: { xmlStorageKey: "fiscal-document_stored", cdc: "cdc-stored" },
      }
    );
    await handler.handle(job);

    // No second identity for one submission: the stored bytes are resent.
    expect(build).not.toHaveBeenCalled();
    expect(storagePut).not.toHaveBeenCalled();
    expect(storageGet).toHaveBeenCalledWith({ key: "fiscal-document_stored" });
    expect(issue.mock.calls[0]?.[0]?.document).toEqual({
      cdc: "cdc-stored",
      signedXml: BUILT_DOCUMENT.signedXml,
    });
    expect(updates[0]?.where).toMatchObject({ status: "SENDING", lastAttemptAt: abandoned });
  });

  it("fails closed when a recovered SENDING row has no stored custody", async () => {
    const abandoned = new Date(Date.now() - 10 * 60_000);
    const { handler, updates, issue, storageGet } = setup(
      "SENDING",
      "APPROVED",
      abandoned,
      undefined,
      undefined,
      { requiresSignedDocument: true }
    );
    await handler.handle(job);

    expect(storageGet).not.toHaveBeenCalled();
    expect(issue).not.toHaveBeenCalled();
    expect(updates[1]?.data).toMatchObject({
      status: "ERROR",
      lastErrorCode: "DOCUMENT_CUSTODY_INCOMPLETE",
    });
  });
});
