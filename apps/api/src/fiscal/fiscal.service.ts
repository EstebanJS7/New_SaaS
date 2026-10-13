import { Inject, Injectable } from "@nestjs/common";
import { PrismaService } from "@newsaas/database";
import { DomainError } from "@newsaas/shared";
import {
  buildEventGroupXml,
  DteEventValidationError,
  FISCAL_CREDENTIAL_PORT,
  FISCAL_PROVIDER,
  FISCAL_PROVIDER_VALUES,
  signEventXml,
  type FiscalCancelResult,
  type FiscalCredentialPort,
  type FiscalIssueDocument,
  type FiscalProviderId,
  type FiscalProviderPort,
  type FiscalSigningEnvironment,
  type FiscalTransportCredential,
} from "@newsaas/fiscal";
import { AuditWriter, type AuditAppendTx } from "../audit/audit-writer.service.js";
import { runWithinDeadline } from "./fiscal.deadline.js";
import { scrubProviderText } from "./fiscal.provider-text.js";
import { RequestContextService } from "../context/request-context.service.js";
import { EntitlementsService } from "../entitlements/entitlements.service.js";
import { PermissionResolver } from "../rbac/permission-resolver.service.js";
import {
  FISCAL_SUBMISSION_PRODUCER,
  type FiscalSubmissionProducer,
} from "./fiscal-submission.producer.js";
import type { FiscalDocumentResponse } from "./fiscal.dto.js";
import {
  FiscalRepository,
  FISCAL_DOCUMENT_TARGET_NOT_FOUND_MESSAGE,
  type FiscalDocumentRow,
  type FiscalDocumentStatus,
  type FiscalDocumentReadTx,
  type FiscalRepositoryTx,
} from "./fiscal.repository.js";
import { FISCAL_PERMISSIONS, type FiscalPermission } from "./fiscal.permissions.js";
import {
  FISCAL_DTO_SCHEMA_VERSION,
  type CreateFiscalDocumentInput,
  type FiscalDocumentListInput,
} from "./fiscal.zod.js";

export const FISCAL_FEATURE_NOT_ENTITLED_MESSAGE =
  "Fiscal features are not enabled for this tenant.";
export const FISCAL_INVOICE_NOT_CONFIRMED_MESSAGE =
  "Only a confirmed invoice can have a fiscal document.";
export const FISCAL_DOCUMENT_ALREADY_ISSUED_MESSAGE =
  "A fiscal document has already been issued for this invoice.";
export const FISCAL_DOCUMENT_CANCEL_SENDING_MESSAGE =
  "This fiscal document is being submitted and cannot be cancelled yet.";
export const FISCAL_DOCUMENT_CANCEL_CONFLICT_MESSAGE =
  "The fiscal document changed while the cancellation was in progress.";
export const FISCAL_DOCUMENT_CANCEL_REFUSED_MESSAGE =
  "The fiscal provider refused the cancellation.";
export const FISCAL_PROVIDER_UNRECOGNISED_MESSAGE = "The stored fiscal provider is not recognised.";
export const FISCAL_DOCUMENT_CANCELLATION_REQUESTED_ACTION =
  "fiscal.document.cancellation_requested";
export const FISCAL_DOCUMENT_CANCELLATION_FAILED_ACTION = "fiscal.document.cancellation_failed";

/**
 * The DNIT environment the API reads the tenant's signing material for.
 *
 * ADR-008 §3: the credential for the other environment is never substituted, so
 * this must be the same value the provider module resolved for the adapter it
 * built. `fiscal.module.ts` provides the token from the package's own resolver;
 * the service only consumes it.
 */
export const FISCAL_SIGNING_ENVIRONMENT = Symbol("FISCAL_SIGNING_ENVIRONMENT");

/** `rEve/@Id` for a lot of one: its ordinal, the strategy FISC-016 pinned (§25.7). */
export const FISCAL_CANCELLATION_EVENT_ID = "1" as const;

/**
 * `fecHhmmss` — `AAAA-MM-DDThh:mm:ss`, **local**, with no timezone suffix and no
 * fractional seconds, the same type `dFeEmiDE` uses (§25.6).
 *
 * The local accessors are the point: a `toISOString()` `Z` or an emitted UTC
 * offset would fail the builder's own `INVALID_TIMESTAMP` rule. The instant is
 * the caller's (`new Date()` at the call site) and the components read are the
 * server's, which is the same reading `dFeEmiDE` gets; this function only
 * renders it and never reads a clock.
 */
export function formatFiscalTimestamp(now: Date): string {
  const pad = (value: number): string => String(value).padStart(2, "0");
  const date = `${String(now.getFullYear()).padStart(4, "0")}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  return `${date}T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}

/**
 * Builds and signs the cancellation event the SIFEN_DIRECT provider submits.
 *
 * The composition is FISC-016 WU-C's hand-off: `buildEventGroupXml` renders the
 * `gGroupGesEve` the facade's envelope will carry, `signEventXml` applies the
 * DE's XMLDSig profile to each event, and the provider receives the signed group
 * verbatim as `document.signedXml` (ADR-009 applied to cancel). The event's
 * `@Id` is `1` — a lot of one — and `dFecFirma` comes from the caller's clock.
 *
 * The private key is RESTRICTED material: it enters `signEventXml` and nothing
 * here logs, returns or persists it.
 */
export function buildCancellationEventDocument(args: {
  readonly cdc: string;
  readonly reason: string;
  readonly now: Date;
  readonly credential: FiscalTransportCredential;
}): FiscalIssueDocument {
  return {
    cdc: args.cdc,
    signedXml: signEventXml({
      xml: buildEventGroupXml([
        {
          id: FISCAL_CANCELLATION_EVENT_ID,
          dFecFirma: formatFiscalTimestamp(args.now),
          payload: { kind: "cancellation", cdc: args.cdc, reason: args.reason },
        },
      ]),
      privateKeyPem: args.credential.privateKeyPem,
      certificatePem: args.credential.certificatePem,
    }),
  };
}

/** Deadline for one synchronous provider cancel call. */
export const FISCAL_CANCEL_TIMEOUT_MS = 10_000;
export const FISCAL_CANCEL_TIMEOUT_REASON_CODE = "FISCAL_CANCEL_TIMEOUT";
export const FISCAL_CANCEL_TIMEOUT_REASON = "The fiscal provider did not respond in time.";

export interface FiscalCancellationWrite {
  readonly status?: FiscalDocumentStatus;
  readonly cancelledAt?: Date;
  readonly lastErrorCode: string | null;
  readonly lastErrorMessage: string | null;
  readonly accepted: boolean;
}

/**
 * Bounds ONE provider cancel call.
 *
 * A hung provider must never turn a staff cancellation into an unbounded open
 * request: past the deadline the call is abandoned and reported as a retryable
 * `TRANSIENT_FAILURE`, which the shared {@link mapFiscalCancelOutcome} mapping
 * already persists as `last_error_*` with NO status change and a
 * `fiscal.document.cancellation_failed` audit row. The mechanism itself is
 * `runWithinDeadline`'s, shared with the range void (FISC-016 WU-D) so the two
 * commands cannot drift; this function is this command's naming of it.
 */
export async function cancelWithinDeadline(
  call: (signal: AbortSignal) => Promise<FiscalCancelResult>,
  deadlineMs: number
): Promise<FiscalCancelResult> {
  return runWithinDeadline({
    call,
    deadlineMs,
    onTimeout: () => ({
      outcome: "TRANSIENT_FAILURE",
      reasonCode: FISCAL_CANCEL_TIMEOUT_REASON_CODE,
      reason: FISCAL_CANCEL_TIMEOUT_REASON,
      retryAfterMs: deadlineMs,
      providerRequest: null,
      providerResponse: null,
      resolvedAt: new Date().toISOString(),
    }),
  });
}

export function mapFiscalCancelOutcome(
  result: FiscalCancelResult,
  now: Date
): FiscalCancellationWrite {
  if (result.outcome === "CANCELLED")
    return {
      status: "CANCELLED",
      cancelledAt: now,
      lastErrorCode: null,
      lastErrorMessage: null,
      accepted: true,
    };
  if (result.outcome === "CANCEL_PENDING")
    return {
      status: "CANCEL_PENDING",
      lastErrorCode: null,
      lastErrorMessage: null,
      accepted: true,
    };
  return {
    lastErrorCode: scrubProviderText(result.reasonCode),
    lastErrorMessage: scrubProviderText(result.reason),
    accepted: false,
  };
}
export type FiscalWriteTx = FiscalRepositoryTx & { auditLog: AuditAppendTx["auditLog"] };
export interface FiscalPrisma {
  $transaction: <T>(work: (tx: FiscalWriteTx) => Promise<T>) => Promise<T>;
}

function toResponse(row: FiscalDocumentRow): FiscalDocumentResponse {
  return {
    id: row.id,
    invoiceId: row.invoiceId,
    provider: row.provider,
    status: row.status,
    attemptCount: row.attemptCount,
    externalId: row.externalId,
    cdc: row.cdc,
    lastErrorCode: row.lastErrorCode,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    cancelledAt: row.cancelledAt?.toISOString() ?? null,
  };
}

@Injectable()
export class FiscalService {
  constructor(
    private readonly repository: FiscalRepository,
    @Inject(PrismaService) private readonly prisma: FiscalPrisma,
    private readonly entitlements: EntitlementsService,
    private readonly context: RequestContextService,
    private readonly permissionResolver: PermissionResolver,
    private readonly audit: AuditWriter,
    @Inject(FISCAL_PROVIDER) private readonly provider: FiscalProviderPort,
    @Inject(FISCAL_SUBMISSION_PRODUCER) private readonly producer: FiscalSubmissionProducer,
    @Inject(FISCAL_CREDENTIAL_PORT) private readonly credentialPort: FiscalCredentialPort,
    @Inject(FISCAL_SIGNING_ENVIRONMENT)
    private readonly signingEnvironment: FiscalSigningEnvironment
  ) {}

  /**
   * Tenant-scoped read of the invoice's live (non-CANCELLED) fiscal document.
   * Billing has already asserted the entitlement and the permission on its own
   * path, so this asserts NEITHER: it is a pure read seam (D5).
   */
  async hasLiveDocumentForInvoice(invoiceId: string, tx?: FiscalDocumentReadTx): Promise<boolean> {
    return this.repository.hasLiveDocument(invoiceId, tx ?? this.repository.client);
  }

  /**
   * Tenant-scoped, unaudited list. Gate order: fiscal entitlement, then fiscal.read.
   */
  async list(input: FiscalDocumentListInput): Promise<FiscalDocumentResponse[]> {
    await this.assertFiscalEnabled();
    await this.requirePermission(FISCAL_PERMISSIONS.read);
    const rows = await this.repository.list(input.status, this.repository.client);
    return rows.map(toResponse);
  }

  /**
   * Tenant-scoped, unaudited detail read. Gate order: fiscal entitlement, then fiscal.read.
   */
  async get(id: string): Promise<FiscalDocumentResponse> {
    await this.assertFiscalEnabled();
    await this.requirePermission(FISCAL_PERMISSIONS.read);
    const row = await this.repository.findDocument(id, this.repository.client);
    if (!row) throw new DomainError("NOT_FOUND", FISCAL_DOCUMENT_TARGET_NOT_FOUND_MESSAGE);
    return toResponse(row);
  }

  /** Cancels a fiscal document; the synchronous provider call is deadline-bounded. */
  async cancel(id: string, reason: string): Promise<FiscalDocumentResponse> {
    await this.assertFiscalEnabled();
    await this.requirePermission(FISCAL_PERMISSIONS.issue);
    const actorUserProfileId = this.context.requireUserProfileId();
    const observed = await this.prisma.$transaction(async (tx) => {
      await this.repository.lockDocument(id, tx);
      const document = await this.repository.findDocument(id, tx);
      if (!document) throw new DomainError("NOT_FOUND", FISCAL_DOCUMENT_TARGET_NOT_FOUND_MESSAGE);
      return document;
    });
    if (observed.status === "CANCELLED") return toResponse(observed);
    if (observed.status === "SENDING")
      throw new DomainError("CONFLICT", FISCAL_DOCUMENT_CANCEL_SENDING_MESSAGE);
    // ADR-009 applied to cancel: a provider that requires a signed document is
    // handed the caller's built-and-signed event; one that does not gets `null`.
    const document = await this.cancellationDocument(observed, reason);
    // Phase B — provider call, OUTSIDE any transaction, bounded by a deadline.
    const result = await cancelWithinDeadline(
      (signal) =>
        this.provider.cancel({
          fiscalDocumentId: observed.id,
          tenantId: observed.tenantId,
          provider: this.toProviderId(observed.provider),
          reason,
          externalId: observed.externalId,
          cdc: observed.cdc,
          document,
          signal,
        }),
      FISCAL_CANCEL_TIMEOUT_MS
    );
    const applied = await this.prisma.$transaction(async (tx) => {
      const write = mapFiscalCancelOutcome(result, new Date());
      const count = await this.repository.applyCancellation(
        observed.id,
        observed.status,
        write,
        tx
      );
      if (count !== 1) return { kind: "conflict" as const };
      await this.audit.append(
        {
          action: write.accepted
            ? FISCAL_DOCUMENT_CANCELLATION_REQUESTED_ACTION
            : FISCAL_DOCUMENT_CANCELLATION_FAILED_ACTION,
          tenantId: observed.tenantId,
          actorUserProfileId,
          targetType: "fiscal_document",
          targetId: observed.id,
          metadata: { schemaVersion: FISCAL_DTO_SCHEMA_VERSION, outcome: result.outcome },
        },
        tx
      );
      const updated = await this.repository.findDocument(observed.id, tx);
      return { kind: "applied" as const, updated, accepted: write.accepted };
    });
    if (applied.kind === "conflict")
      throw new DomainError("CONFLICT", FISCAL_DOCUMENT_CANCEL_CONFLICT_MESSAGE);
    if (!applied.accepted)
      throw new DomainError(
        "CONFLICT",
        scrubProviderText(result.reason) ?? FISCAL_DOCUMENT_CANCEL_REFUSED_MESSAGE
      );
    if (!applied.updated)
      throw new DomainError("INTERNAL", FISCAL_DOCUMENT_CANCEL_CONFLICT_MESSAGE);
    return toResponse(applied.updated);
  }

  /**
   * The document the provider is handed, or `null` when it requires none.
   *
   * Three things make this `null` rather than a refusal: the provider's own
   * `requiresSignedDocument` answer (ADR-009's flag — the fake answers `false`),
   * a row with no CDC to cancel, and a tenant with no active signing material
   * for the deployment's environment. The first is the contract; the other two
   * are states in which no honest event can be built, and a requiring provider
   * answers `CONFIGURATION_ERROR` for a `null` document and never submits — the
   * refusal stays in the one place that can phrase it for the provider it is.
   *
   * A reason the event's `mOtEve` cannot carry is a client-input problem, so the
   * builder's typed refusal becomes a 400 (`VALIDATION_FAILED`) before any
   * provider call instead of an internal fault.
   */
  private async cancellationDocument(
    observed: FiscalDocumentRow,
    reason: string
  ): Promise<FiscalIssueDocument | null> {
    if (!this.provider.requiresSignedDocument) return null;
    if (observed.cdc === null) return null;
    const credential = await this.credentialPort.read({
      tenantId: observed.tenantId,
      environment: this.signingEnvironment,
    });
    if (credential === null) return null;

    try {
      return buildCancellationEventDocument({
        cdc: observed.cdc,
        reason,
        now: new Date(),
        credential,
      });
    } catch (error) {
      if (error instanceof DteEventValidationError) {
        throw new DomainError("VALIDATION_FAILED", error.message);
      }
      throw error;
    }
  }

  private toProviderId(value: string): FiscalProviderId {
    const provider = FISCAL_PROVIDER_VALUES.find((candidate) => candidate === value);
    if (!provider) throw new DomainError("INTERNAL", FISCAL_PROVIDER_UNRECOGNISED_MESSAGE);
    return provider;
  }

  async issue(input: CreateFiscalDocumentInput): Promise<FiscalDocumentResponse> {
    await this.assertFiscalEnabled();
    await this.requirePermission(FISCAL_PERMISSIONS.issue);
    const actorUserProfileId = this.context.requireUserProfileId();
    const tenantId = this.context.requireTenantId();
    const row = await this.prisma.$transaction(async (tx) => {
      await this.repository.lockInvoice(input.invoiceId, tx);
      const invoice = await this.repository.findInvoice(input.invoiceId, tx);
      if (invoice.status !== "CONFIRMED")
        throw new DomainError("CONFLICT", FISCAL_INVOICE_NOT_CONFIRMED_MESSAGE);

      let document = await this.repository.findLiveDocument(invoice.id, tx);
      if (document) {
        if (document.status !== "PENDING")
          throw new DomainError("CONFLICT", FISCAL_DOCUMENT_ALREADY_ISSUED_MESSAGE);
        // No Idempotency-Key is needed: the persisted state proves a second effect is impossible (DEC-041).
        if (!(await this.repository.markQueued(document.id, "PENDING", tx)))
          throw new DomainError("CONFLICT", FISCAL_DOCUMENT_ALREADY_ISSUED_MESSAGE);
        document = { ...document, status: "QUEUED" };
      } else {
        document = await this.repository.create(
          { invoiceId: invoice.id, provider: this.provider.provider },
          tx
        );
        if (!(await this.repository.markQueued(document.id, "PENDING", tx)))
          throw new DomainError("CONFLICT", FISCAL_DOCUMENT_ALREADY_ISSUED_MESSAGE);
        document = { ...document, status: "QUEUED" };
      }
      await this.audit.append(
        {
          action: "fiscal.document.issue_requested",
          tenantId: document.tenantId,
          actorUserProfileId,
          targetType: "fiscal_document",
          targetId: document.id,
          metadata: { schemaVersion: FISCAL_DTO_SCHEMA_VERSION, invoiceId: invoice.id },
        },
        tx
      );
      return document;
    });
    // A failed enqueue surfaces; the document remains QUEUED and reconciliation sweep is recorded as technical debt.
    await this.producer.enqueue({ fiscalDocumentId: row.id, tenantId });
    return toResponse(row);
  }

  private async assertFiscalEnabled(): Promise<void> {
    const tenantId = this.context.requireTenantId();
    if (!(await this.entitlements.has(tenantId, "fiscal")))
      throw new DomainError("FEATURE_NOT_ENTITLED", FISCAL_FEATURE_NOT_ENTITLED_MESSAGE);
  }
  private async requirePermission(permission: FiscalPermission): Promise<void> {
    const permissions = await this.permissionResolver.resolveForActiveRequest();
    if (!permissions.has(permission))
      throw new DomainError("FORBIDDEN", "The required fiscal permission is missing.");
  }
}
