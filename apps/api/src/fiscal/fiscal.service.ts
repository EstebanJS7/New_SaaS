import { Inject, Injectable } from "@nestjs/common";
import { PrismaService } from "@newsaas/database";
import { DomainError } from "@newsaas/shared";
import { FISCAL_PROVIDER, type FiscalProviderPort } from "@newsaas/fiscal";
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
  type FiscalDocumentRow,
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
