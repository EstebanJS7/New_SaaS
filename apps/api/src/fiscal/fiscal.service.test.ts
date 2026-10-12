import { afterEach, describe, expect, it, vi } from "vitest";
import {
  EVENT_SIGNATURE_PLACEHOLDER,
  serializeEventReception,
  type FiscalCancelRequest,
  type FiscalCancelResult,
  type FiscalCredentialPort,
  type FiscalProviderPort,
  type FiscalTransportCredential,
} from "@newsaas/fiscal";
import { FIXTURE_CERTIFICATE_PEM, FIXTURE_PRIVATE_KEY_PEM } from "@newsaas/fiscal/testing";
import type { AuditWriter } from "../audit/audit-writer.service.js";
import type { RequestContextService } from "../context/request-context.service.js";
import type { EntitlementsService } from "../entitlements/entitlements.service.js";
import type { PermissionResolver } from "../rbac/permission-resolver.service.js";
import { FISCAL_PERMISSIONS } from "./fiscal.permissions.js";
import type { FiscalDocumentRow, FiscalRepository } from "./fiscal.repository.js";
import type { FiscalSubmissionProducer } from "./fiscal-submission.producer.js";
import {
  buildCancellationEventDocument,
  cancelWithinDeadline,
  FISCAL_CANCELLATION_EVENT_ID,
  FISCAL_CANCEL_TIMEOUT_MS,
  FISCAL_CANCEL_TIMEOUT_REASON,
  FISCAL_CANCEL_TIMEOUT_REASON_CODE,
  FiscalService,
  formatFiscalTimestamp,
  type FiscalCancellationWrite,
  type FiscalPrisma,
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

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const ACTOR = "22222222-2222-4222-8222-222222222222";
const DOCUMENT_ID = "33333333-3333-4333-8333-333333333333";
const CDC = `12${"1234567A"}${"0".repeat(34)}`;
const REASON = "Operator request";
const ENVIRONMENT = "TEST" as const;

/** The signing material a cancellation signs with; throwaway test bytes. */
const CREDENTIAL: FiscalTransportCredential = {
  certificatePem: FIXTURE_CERTIFICATE_PEM,
  privateKeyPem: FIXTURE_PRIVATE_KEY_PEM,
  notBefore: new Date("2026-01-01T00:00:00.000Z"),
  notAfter: new Date("2027-01-01T00:00:00.000Z"),
};

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

describe("the API's cancellation composition (WU-C)", () => {
  it("renders fecHhmmss from the clock's local components: no timezone, no fraction (§25.6)", () => {
    const now = new Date("2026-10-08T15:30:45.000Z");

    const formatted = formatFiscalTimestamp(now);

    const pad = (value: number): string => String(value).padStart(2, "0");
    const expected =
      `${String(now.getFullYear()).padStart(4, "0")}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}` +
      `T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
    expect(formatted).toBe(expected);
    expect(formatted).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
  });

  it("derives dFecFirma from the clock it is given, never a constant", () => {
    expect(formatFiscalTimestamp(new Date("2026-10-08T15:00:00.000Z"))).not.toBe(
      formatFiscalTimestamp(new Date("2026-10-09T15:00:00.000Z"))
    );
  });

  it("builds and signs the gGroupGesEve cancellation the provider submits", () => {
    const now = new Date("2026-10-08T15:30:45.000Z");

    const document = buildCancellationEventDocument({
      cdc: CDC,
      reason: REASON,
      now,
      credential: CREDENTIAL,
    });

    expect(document.cdc).toBe(CDC);
    // The facade's serializer accepts the hand-off surface, which is what makes
    // the composition and the submission agree on the group root (§25.1).
    expect(() =>
      serializeEventReception({ dId: "123456789012345", eventGroupXml: document.signedXml })
    ).not.toThrow();
    expect(document.signedXml).toContain("<gGroupGesEve");
    expect(document.signedXml).toContain(`<rEve Id="${FISCAL_CANCELLATION_EVENT_ID}">`);
    expect(document.signedXml).toContain(`<Id>${CDC}</Id>`);
    expect(document.signedXml).toContain(`<mOtEve>${REASON}</mOtEve>`);
    expect(document.signedXml).toContain(`<dFecFirma>${formatFiscalTimestamp(now)}</dFecFirma>`);
    // Signed for real: the placeholder is gone and exactly one signature sits
    // beside the event. The private key never travels with the bytes.
    expect(document.signedXml).not.toContain(EVENT_SIGNATURE_PLACEHOLDER);
    expect(document.signedXml.match(/<Signature[\s>]/g) ?? []).toHaveLength(1);
    expect(document.signedXml).not.toContain(FIXTURE_PRIVATE_KEY_PEM.split("\n")[1] ?? "");
  });

  it("refuses a reason the event's mOtEve cannot carry", () => {
    expect(() =>
      buildCancellationEventDocument({
        cdc: CDC,
        reason: "no",
        now: new Date("2026-10-08T15:30:45.000Z"),
        credential: CREDENTIAL,
      })
    ).toThrow(/mOtEve/);
  });
});

interface CancelHarness {
  readonly service: FiscalService;
  readonly cancelRequests: FiscalCancelRequest[];
  readonly credentialReads: { readonly tenantId: string; readonly environment: string }[];
}

interface CancelHarnessOptions {
  readonly requiresDocument: boolean;
  readonly credential?: FiscalTransportCredential | null;
  readonly cdc?: string | null;
}

/**
 * A `FiscalService` wired with fakes just rich enough to reach the provider.
 *
 * The point is the one thing `cancel` decides about the request: whether it
 * carries a document, and whether a credential was read to build it.
 */
function buildCancelHarness(options: CancelHarnessOptions): CancelHarness {
  const createdAt = new Date("2026-10-08T15:00:00.000Z");
  const row: FiscalDocumentRow = {
    id: DOCUMENT_ID,
    tenantId: TENANT_A,
    invoiceId: "invoice-1",
    provider: "SIFEN_DIRECT",
    status: "APPROVED",
    attemptCount: 1,
    externalId: "provider-1",
    cdc: options.cdc === undefined ? CDC : options.cdc,
    lastErrorCode: null,
    createdAt,
    updatedAt: createdAt,
    cancelledAt: null,
  };
  const cancelRequests: FiscalCancelRequest[] = [];
  const credentialReads: { tenantId: string; environment: string }[] = [];

  const repository = {
    lockDocument: () => Promise.resolve(),
    findDocument: () => Promise.resolve(row),
    applyCancellation: (
      _id: string,
      _observed: string,
      write: FiscalCancellationWrite
    ): Promise<number> => {
      if (write.status !== undefined) row.status = write.status;
      if (write.cancelledAt !== undefined) row.cancelledAt = write.cancelledAt;
      row.lastErrorCode = write.lastErrorCode;
      return Promise.resolve(1);
    },
  } as unknown as FiscalRepository;
  const prisma = {
    $transaction: (work: (tx: unknown) => Promise<unknown>) => work({}),
  } as unknown as FiscalPrisma;
  const entitlements = { has: () => Promise.resolve(true) } as unknown as EntitlementsService;
  const context = {
    requireUserProfileId: () => ACTOR,
    requireTenantId: () => TENANT_A,
  } as unknown as RequestContextService;
  const permissionResolver = {
    resolveForActiveRequest: () => Promise.resolve(new Set([FISCAL_PERMISSIONS.issue])),
  } as unknown as PermissionResolver;
  const audit = { append: () => Promise.resolve({ id: "audit-1" }) } as unknown as AuditWriter;
  const provider: FiscalProviderPort = {
    provider: "SIFEN_DIRECT",
    requiresSignedDocument: options.requiresDocument,
    issue: () => Promise.reject(new Error("issue is not under test")),
    query: () => Promise.reject(new Error("query is not under test")),
    cancel: (request) => {
      cancelRequests.push(request);
      return Promise.resolve(cancelResult("CANCELLED"));
    },
  };
  const producer = { enqueue: () => Promise.resolve() } as unknown as FiscalSubmissionProducer;
  const credentialPort = {
    read: (args: { tenantId: string; environment: string }) => {
      credentialReads.push(args);
      return Promise.resolve(options.credential === undefined ? CREDENTIAL : options.credential);
    },
  } as unknown as FiscalCredentialPort;

  const service = new FiscalService(
    repository,
    prisma,
    entitlements,
    context,
    permissionResolver,
    audit,
    provider,
    producer,
    credentialPort,
    ENVIRONMENT
  );

  return { service, cancelRequests, credentialReads };
}

describe("FiscalService.cancel — the document it hands the provider (ADR-009 applied to cancel)", () => {
  it("builds and signs the event for a requiring provider, reading the credential per call", async () => {
    const harness = buildCancelHarness({ requiresDocument: true });

    const response = await harness.service.cancel(DOCUMENT_ID, REASON);

    expect(response.status).toBe("CANCELLED");
    expect(harness.cancelRequests).toHaveLength(1);
    const request = harness.cancelRequests[0];
    expect(request?.document?.cdc).toBe(CDC);
    expect(request?.document?.signedXml).toContain("<gGroupGesEve");
    expect(request?.document?.signedXml).toMatch(/<Signature[\s>]/);
    // ADR-008 §2: the read is per call and names the deployment's environment.
    expect(harness.credentialReads).toEqual([{ tenantId: TENANT_A, environment: ENVIRONMENT }]);
  });

  it("hands a non-requiring provider null and reads no credential", async () => {
    const harness = buildCancelHarness({ requiresDocument: false });

    await harness.service.cancel(DOCUMENT_ID, REASON);

    expect(harness.cancelRequests[0]?.document).toBeNull();
    expect(harness.credentialReads).toHaveLength(0);
  });

  it("hands null when the tenant has no active material, rather than fabricating an event", async () => {
    const harness = buildCancelHarness({ requiresDocument: true, credential: null });

    await harness.service.cancel(DOCUMENT_ID, REASON);

    expect(harness.cancelRequests[0]?.document).toBeNull();
  });

  it("hands null when the document has no CDC to cancel, and does not read a credential", async () => {
    const harness = buildCancelHarness({ requiresDocument: true, cdc: null });

    await harness.service.cancel(DOCUMENT_ID, REASON);

    expect(harness.cancelRequests[0]?.document).toBeNull();
    expect(harness.credentialReads).toHaveLength(0);
  });

  it("refuses a reason the event cannot carry with a 400 before any provider call", async () => {
    const harness = buildCancelHarness({ requiresDocument: true });

    await expect(harness.service.cancel(DOCUMENT_ID, "no")).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
    });
    expect(harness.cancelRequests).toHaveLength(0);
  });
});
