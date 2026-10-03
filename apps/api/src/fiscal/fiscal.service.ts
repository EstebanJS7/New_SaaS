import { Inject, Injectable } from "@nestjs/common";
import { PrismaService } from "@newsaas/database";
import { DomainError } from "@newsaas/shared";
import {
  FISCAL_PROVIDER,
  FISCAL_PROVIDER_VALUES,
  type FiscalCancelResult,
  type FiscalProviderId,
  type FiscalProviderPort,
} from "@newsaas/fiscal";
import { AuditWriter, type AuditAppendTx } from "../audit/audit-writer.service.js";
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
  type FiscalRepositoryTx,
} from "./fiscal.repository.js";
import { FISCAL_PERMISSIONS } from "./fiscal.permissions.js";
import { FISCAL_DTO_SCHEMA_VERSION, type CreateFiscalDocumentInput } from "./fiscal.zod.js";

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

export interface FiscalCancellationWrite {
  readonly status?: FiscalDocumentStatus;
  readonly cancelledAt?: Date;
  readonly lastErrorCode: string | null;
  readonly lastErrorMessage: string | null;
  readonly accepted: boolean;
}

function scrub(value: string | null): string | null {
  return value === null ? null : value.replace(/[\r\n\t]+/g, " ").slice(0, 500);
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
    lastErrorCode: scrub(result.reasonCode),
    lastErrorMessage: scrub(result.reason),
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
    @Inject(FISCAL_SUBMISSION_PRODUCER) private readonly producer: FiscalSubmissionProducer
  ) {}

  async cancel(id: string, reason: string): Promise<FiscalDocumentResponse> {
    await this.assertFiscalEnabled();
    await this.requirePermission();
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
    const result = await this.provider.cancel({
      fiscalDocumentId: observed.id,
      tenantId: observed.tenantId,
      provider: this.toProviderId(observed.provider),
      reason,
      externalId: observed.externalId,
      cdc: observed.cdc,
    });
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
        scrub(result.reason) ?? FISCAL_DOCUMENT_CANCEL_REFUSED_MESSAGE
      );
    if (!applied.updated)
      throw new DomainError("INTERNAL", FISCAL_DOCUMENT_CANCEL_CONFLICT_MESSAGE);
    return toResponse(applied.updated);
  }

  private toProviderId(value: string): FiscalProviderId {
    const provider = FISCAL_PROVIDER_VALUES.find((candidate) => candidate === value);
    if (!provider) throw new DomainError("INTERNAL", FISCAL_PROVIDER_UNRECOGNISED_MESSAGE);
    return provider;
  }

  async issue(input: CreateFiscalDocumentInput): Promise<FiscalDocumentResponse> {
    await this.assertFiscalEnabled();
    await this.requirePermission();
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
  private async requirePermission(): Promise<void> {
    const permissions = await this.permissionResolver.resolveForActiveRequest();
    if (!permissions.has(FISCAL_PERMISSIONS.issue))
      throw new DomainError("FORBIDDEN", "The required fiscal permission is missing.");
  }
}
