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
import { DomainError } from "@newsaas/shared";
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
  FISCAL_CANCEL_PENDING_LEASE_MS,
  FISCAL_CANCEL_TIMEOUT_MS,
  FISCAL_CANCEL_TIMEOUT_REASON,
  FISCAL_CANCEL_TIMEOUT_REASON_CODE,
  FISCAL_DOCUMENT_CANCEL_PENDING_MESSAGE,
  FiscalService,
  formatFiscalTimestamp,
  isFiscalCancelPendingLeaseStale,
  mapFiscalCancelOutcome,
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
  readonly cancellationWrites: FiscalCancellationWrite[];
  readonly credentialReads: { readonly tenantId: string; readonly environment: string }[];
  readonly row: FiscalDocumentRow;
}

interface CancelHarnessOptions {
  readonly requiresDocument: boolean;
  readonly credential?: FiscalTransportCredential | null;
  readonly cdc?: string | null;
  readonly status?: FiscalDocumentRow["status"];
  readonly cancelPendingSince?: Date | null;
  /** The provider's whole answer, so a case can hand the command any outcome. */
  readonly cancelResult?: FiscalCancelResult;
}

/**
 * A `FiscalService` wired with fakes just rich enough to reach the provider.
 *
 * The point is the one thing `cancel` decides about the request: whether it
 * carries a document, whether a credential was read to build it, and — since
 * the cancellation lease exists — whether the call happens at all.
 */
function buildCancelHarness(options: CancelHarnessOptions): CancelHarness {
  const createdAt = new Date("2026-10-08T15:00:00.000Z");
  const row: FiscalDocumentRow = {
    id: DOCUMENT_ID,
    tenantId: TENANT_A,
    invoiceId: "invoice-1",
    provider: "SIFEN_DIRECT",
    status: options.status ?? "APPROVED",
    attemptCount: 1,
    externalId: "provider-1",
    cdc: options.cdc === undefined ? CDC : options.cdc,
    lastErrorCode: null,
    createdAt,
    updatedAt: createdAt,
    cancelledAt: null,
    cancelPendingSince: options.cancelPendingSince ?? null,
  };
  const cancelRequests: FiscalCancelRequest[] = [];
  const cancellationWrites: FiscalCancellationWrite[] = [];
  const credentialReads: { tenantId: string; environment: string }[] = [];

  const repository = {
    lockDocument: () => Promise.resolve(),
    findDocument: () => Promise.resolve(row),
    applyCancellation: (
      _id: string,
      _observed: string,
      write: FiscalCancellationWrite
    ): Promise<number> => {
      cancellationWrites.push(write);
      if (write.status !== undefined) row.status = write.status;
      if (write.cancelledAt !== undefined) row.cancelledAt = write.cancelledAt;
      if (write.cancelPendingSince !== undefined) row.cancelPendingSince = write.cancelPendingSince;
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
      return Promise.resolve(options.cancelResult ?? cancelResult("CANCELLED"));
    },
    voidRange: () => Promise.reject(new Error("voidRange is not under test")),
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

  return { service, cancelRequests, cancellationWrites, credentialReads, row };
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

/**
 * TD-033 item 5 — an attempt whose fate is unknown must not look cancellable.
 *
 * The mapping is the whole decision, so it is pinned field by field: what the
 * document becomes, when its lease starts, and whether the command reports the
 * request as accepted.
 */
describe("mapFiscalCancelOutcome — an unknown fate is parked, not ignored (TD-033 item 5)", () => {
  const now = new Date("2026-10-13T10:00:00.000Z");

  it("parks a TRANSIENT_FAILURE in CANCEL_PENDING with a fresh lease and accepts the request", () => {
    const write = mapFiscalCancelOutcome(
      {
        ...cancelResult("TRANSIENT_FAILURE"),
        reasonCode: "SIFEN_TIMEOUT",
        reason: "The provider did not answer.",
      },
      now
    );

    expect(write.status).toBe("CANCEL_PENDING");
    expect(write.cancelPendingSince).toBe(now);
    // The request WAS made: the tax administration may already have it, so the
    // command reports it as accepted and never as a refusal.
    expect(write.accepted).toBe(true);
    // The reason code is the operator's evidence of why the document is parked.
    expect(write.lastErrorCode).toBe("SIFEN_TIMEOUT");
    expect(write.cancelledAt).toBeUndefined();
  });

  it("leaves the document where it was when the provider answered REJECTED", () => {
    const write = mapFiscalCancelOutcome(
      { ...cancelResult("REJECTED"), reasonCode: "SIFEN_REJECTED", reason: "Refused." },
      now
    );

    // A rejection is the provider's own answer: the cancellation did not take
    // effect, so the document is honestly still cancellable.
    expect(write.status).toBeUndefined();
    expect(write.cancelPendingSince).toBeUndefined();
    expect(write.accepted).toBe(false);
    expect(write.lastErrorCode).toBe("SIFEN_REJECTED");
  });

  it("leaves the document where it was when nothing was sent at all", () => {
    const write = mapFiscalCancelOutcome(
      {
        ...cancelResult("CONFIGURATION_ERROR"),
        reasonCode: "SIFEN_NO_CREDENTIAL",
        reason: "No credential is configured.",
      },
      now
    );

    // A configuration failure means the request never left: no fate to be
    // unknown, so no lease and no parked state.
    expect(write.status).toBeUndefined();
    expect(write.cancelPendingSince).toBeUndefined();
    expect(write.accepted).toBe(false);
    expect(write.lastErrorCode).toBe("SIFEN_NO_CREDENTIAL");
  });

  it("keeps CANCELLED's own write, with no lease to hold", () => {
    const write = mapFiscalCancelOutcome(cancelResult("CANCELLED"), now);

    expect(write.status).toBe("CANCELLED");
    expect(write.cancelledAt).toBe(now);
    expect(write.accepted).toBe(true);
    expect(write.cancelPendingSince).toBeUndefined();
  });

  it("leases the provider's own CANCEL_PENDING, so a second cancel cannot resubmit", () => {
    const write = mapFiscalCancelOutcome(cancelResult("CANCEL_PENDING"), now);

    expect(write.status).toBe("CANCEL_PENDING");
    expect(write.cancelPendingSince).toBe(now);
    expect(write.accepted).toBe(true);
    // The provider's own pending answer carries no error text, as it always has.
    expect(write.lastErrorCode).toBeNull();
    expect(write.lastErrorMessage).toBeNull();
  });
});

describe("the cancellation lease (TD-033 item 5)", () => {
  const at = (ageMs: number): Date => new Date(Date.now() - ageMs);

  it("is live strictly before the window and stale at or after it", () => {
    // `null` counts as stale: nothing renewed the lease, and refusing to retry
    // would park a document forever — the wedge this design exists to avoid.
    expect(isFiscalCancelPendingLeaseStale({ cancelPendingSince: null }, new Date())).toBe(true);
    expect(
      isFiscalCancelPendingLeaseStale(
        { cancelPendingSince: at(FISCAL_CANCEL_PENDING_LEASE_MS - 1) },
        new Date()
      )
    ).toBe(false);
    expect(
      isFiscalCancelPendingLeaseStale(
        { cancelPendingSince: at(FISCAL_CANCEL_PENDING_LEASE_MS) },
        new Date()
      )
    ).toBe(true);
  });

  it("uses the submission's own window, so the house has one number for an unknown fate", () => {
    expect(FISCAL_CANCEL_PENDING_LEASE_MS).toBe(5 * 60_000);
  });

  it("refuses a second cancel while the lease is live, by name, and never calls the provider", async () => {
    const harness = buildCancelHarness({
      requiresDocument: true,
      status: "CANCEL_PENDING",
      cancelPendingSince: at(60_000),
    });

    const error = await harness.service.cancel(DOCUMENT_ID, REASON).then(
      () => null,
      (rejection: unknown) => rejection
    );

    expect(error).toBeInstanceOf(DomainError);
    const failure = error as DomainError;
    expect(failure.code).toBe("CONFLICT");
    expect(failure.message).toBe(FISCAL_DOCUMENT_CANCEL_PENDING_MESSAGE);
    // The retry-after rides the 409: the caller is told when the lease allows a
    // fresh attempt instead of being left to poll.
    const details = failure.details as { retryAfterMs: number };
    expect(Object.keys(details)).toEqual(["retryAfterMs"]);
    expect(details.retryAfterMs).toBeGreaterThan(0);
    expect(details.retryAfterMs).toBeLessThanOrEqual(FISCAL_CANCEL_PENDING_LEASE_MS);
    // The refusal is the API's half of the design: the provider is NEVER asked
    // a second time while the first attempt's fate is still unknown.
    expect(harness.cancelRequests).toHaveLength(0);
    expect(harness.cancellationWrites).toHaveLength(0);
    expect(harness.credentialReads).toHaveLength(0);
    expect(harness.row.status).toBe("CANCEL_PENDING");
  });

  it("proceeds once the lease has expired and lets the document leave the parked state", async () => {
    const stale = at(FISCAL_CANCEL_PENDING_LEASE_MS + 1_000);
    const harness = buildCancelHarness({
      requiresDocument: false,
      status: "CANCEL_PENDING",
      cancelPendingSince: stale,
    });

    const response = await harness.service.cancel(DOCUMENT_ID, REASON);

    expect(harness.cancelRequests).toHaveLength(1);
    expect(response.status).toBe("CANCELLED");
    expect(harness.cancellationWrites.at(-1)?.cancelledAt).toBeInstanceOf(Date);
  });

  it("refreshes the lease when a retry after the window ends unknown again", async () => {
    const stale = at(FISCAL_CANCEL_PENDING_LEASE_MS + 1_000);
    const harness = buildCancelHarness({
      requiresDocument: false,
      status: "CANCEL_PENDING",
      cancelPendingSince: stale,
      cancelResult: {
        ...cancelResult("TRANSIENT_FAILURE"),
        reasonCode: FISCAL_CANCEL_TIMEOUT_REASON_CODE,
        reason: FISCAL_CANCEL_TIMEOUT_REASON,
        retryAfterMs: FISCAL_CANCEL_TIMEOUT_MS,
      },
    });

    const response = await harness.service.cancel(DOCUMENT_ID, REASON);

    expect(response.status).toBe("CANCEL_PENDING");
    const lease = harness.cancellationWrites.at(-1)?.cancelPendingSince;
    expect(lease).toBeInstanceOf(Date);
    // A fresh lease, not the stale one: otherwise the retry would be immediately
    // retryable again while this attempt's fate is unknown.
    expect(lease?.getTime()).toBeGreaterThan(stale.getTime());
  });

  it("proceeds when a parked document carries no lease at all", async () => {
    // A row parked before the column existed, and the provider's own
    // CANCEL_PENDING before this unit: a lease that was never written is stale.
    const harness = buildCancelHarness({
      requiresDocument: false,
      status: "CANCEL_PENDING",
      cancelPendingSince: null,
    });

    const response = await harness.service.cancel(DOCUMENT_ID, REASON);

    expect(harness.cancelRequests).toHaveLength(1);
    expect(response.status).toBe("CANCELLED");
  });

  it("leaves a document that is not parked alone", async () => {
    const harness = buildCancelHarness({
      requiresDocument: false,
      status: "APPROVED",
      cancelPendingSince: new Date(),
    });

    await expect(harness.service.cancel(DOCUMENT_ID, REASON)).resolves.toMatchObject({
      status: "CANCELLED",
    });
    expect(harness.cancelRequests).toHaveLength(1);
  });

  it("reports a terminal failure with no local effect, as it always has", async () => {
    const harness = buildCancelHarness({
      requiresDocument: true,
      status: "APPROVED",
      cancelResult: {
        ...cancelResult("CONFIGURATION_ERROR"),
        reasonCode: "SIFEN_NO_CREDENTIAL",
        reason: "No credential is configured.",
      },
    });

    await expect(harness.service.cancel(DOCUMENT_ID, REASON)).rejects.toMatchObject({
      code: "CONFLICT",
      message: "No credential is configured.",
    });
    expect(harness.cancelRequests).toHaveLength(1);
    expect(harness.row.status).toBe("APPROVED");
    const write = harness.cancellationWrites.at(-1);
    expect(write?.accepted).toBe(false);
    expect(write?.status).toBeUndefined();
    expect(write?.cancelPendingSince).toBeUndefined();
  });
});
