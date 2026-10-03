import { Inject, Injectable } from "@nestjs/common";
import { PrismaService, Prisma, appendAuditLog, type AuditAppendTx } from "@newsaas/database";
import {
  FISCAL_PROVIDER,
  isRetryableOutcome,
  sanitizeProviderSnapshot,
  type FiscalIssueOutcome,
  type FiscalIssueRequest,
  type FiscalIssueResult,
  type FiscalProviderId,
  type FiscalProviderPort,
  type FiscalSubmissionJob,
} from "@newsaas/fiscal";

type FiscalStatus =
  | "PENDING"
  | "QUEUED"
  | "SENDING"
  | "SUBMITTED"
  | "APPROVED"
  | "REJECTED"
  | "ERROR"
  | "CANCEL_PENDING"
  | "CANCELLED";

interface FiscalDocumentRecord {
  readonly id: string;
  readonly tenantId: string;
  readonly invoiceId: string;
  readonly provider: FiscalProviderId;
  readonly status: FiscalStatus;
  readonly attemptCount: number;
}

interface FiscalLineRecord {
  readonly description: string;
  readonly quantity: Prisma.Decimal;
  readonly unitPrice: Prisma.Decimal;
  readonly rateCode: string;
  readonly taxableBase: Prisma.Decimal;
  readonly taxAmount: Prisma.Decimal;
  readonly lineTotal: Prisma.Decimal;
}

interface InvoiceRecord {
  readonly series: string;
  readonly number: number | null;
  readonly currency: string;
  readonly confirmedAt: Date | null;
  readonly lines: readonly FiscalLineRecord[];
}

interface FiscalDocumentDelegate {
  findFirst(args: {
    where: { id: string; tenantId: string };
  }): Promise<FiscalDocumentRecord | null>;
  updateMany(args: {
    where: { id: string; tenantId: string; status: { in: readonly FiscalStatus[] } };
    data: Record<string, unknown>;
  }): Promise<{ count: number }>;
}

interface InvoiceDelegate {
  findFirst(args: {
    where: { id: string; tenantId: string };
    include: { lines: { orderBy: { position: "asc" } } };
  }): Promise<InvoiceRecord | null>;
}

interface FiscalTransaction extends AuditAppendTx {
  fiscalDocument: FiscalDocumentDelegate;
}

interface FiscalHandlerPrisma extends FiscalTransaction {
  invoice: InvoiceDelegate;
  $transaction<R>(work: (tx: FiscalTransaction) => Promise<R>): Promise<R>;
}

export interface OutcomeStatusMapping {
  readonly status: "APPROVED" | "REJECTED" | "ERROR";
  readonly resolved: boolean;
}

export function mapOutcomeToStatus(outcome: FiscalIssueOutcome): OutcomeStatusMapping {
  switch (outcome) {
    case "APPROVED":
      return { status: "APPROVED", resolved: true };
    case "REJECTED":
    case "FUNCTIONAL_REJECTION":
      return { status: "REJECTED", resolved: true };
    case "CONFIGURATION_ERROR":
    case "TRANSIENT_FAILURE":
      return { status: "ERROR", resolved: false };
  }
}

const MAX_ERROR_LENGTH = 500;
const ACTIVE_STATUSES: readonly FiscalStatus[] = ["PENDING", "QUEUED", "ERROR"];
const NO_RETRY_STATUSES: readonly FiscalStatus[] = [
  "APPROVED",
  "REJECTED",
  "CANCELLED",
  "SENDING",
  "SUBMITTED",
];

@Injectable()
export class FiscalSubmissionHandler {
  constructor(
    @Inject(PrismaService) private readonly prisma: FiscalHandlerPrisma,
    @Inject(FISCAL_PROVIDER) private readonly provider: FiscalProviderPort
  ) {}

  async handle(job: FiscalSubmissionJob): Promise<void> {
    const document = await this.prisma.fiscalDocument.findFirst({
      where: { tenantId: job.tenantId, id: job.fiscalDocumentId },
    });
    if (!document) return;

    if (NO_RETRY_STATUSES.includes(document.status)) {
      // This guard stops a redelivered job from double-submitting to the provider.
      return;
    }

    const attemptCount = document.attemptCount + 1;
    const startedAt = new Date();
    const claimed = await this.prisma.fiscalDocument.updateMany({
      where: { id: document.id, tenantId: document.tenantId, status: { in: ACTIVE_STATUSES } },
      data: { status: "SENDING", attemptCount: { increment: 1 }, lastAttemptAt: startedAt },
    });
    if (claimed.count !== 1) return;

    const invoice = await this.prisma.invoice.findFirst({
      where: { id: document.invoiceId, tenantId: document.tenantId },
      include: { lines: { orderBy: { position: "asc" } } },
    });
    if (!invoice?.confirmedAt || invoice.number === null) {
      throw new Error("Fiscal submission invoice snapshot is unavailable");
    }

    const lines = invoice.lines.map((line) => ({
      description: line.description,
      quantity: line.quantity.toString(),
      unitPrice: line.unitPrice.toString(),
      rateCode: line.rateCode,
      taxableBase: line.taxableBase.toString(),
      taxAmount: line.taxAmount.toString(),
      lineTotal: line.lineTotal.toString(),
    }));
    const totals = invoice.lines.reduce(
      (sum, line) => ({
        taxableBase: sum.taxableBase.plus(line.taxableBase),
        taxAmount: sum.taxAmount.plus(line.taxAmount),
        total: sum.total.plus(line.lineTotal),
      }),
      {
        taxableBase: new Prisma.Decimal(0),
        taxAmount: new Prisma.Decimal(0),
        total: new Prisma.Decimal(0),
      }
    );
    const request: FiscalIssueRequest = {
      fiscalDocumentId: document.id,
      tenantId: document.tenantId,
      provider: document.provider,
      invoice: {
        series: invoice.series,
        number: invoice.number,
        currency: invoice.currency,
        issuedAt: invoice.confirmedAt.toISOString(),
      },
      lines,
      totals: {
        taxableBase: totals.taxableBase.toString(),
        taxAmount: totals.taxAmount.toString(),
        total: totals.total.toString(),
      },
    };

    const result = await this.provider.issue(request);
    await this.persistResult(document, result, attemptCount);
    if (isRetryableOutcome(result.outcome)) {
      throw new Error(this.errorMessage(result.reason, "Fiscal provider transient failure"));
    }
  }

  private async persistResult(
    document: FiscalDocumentRecord,
    result: FiscalIssueResult,
    attemptCount: number
  ): Promise<void> {
    const requestSnapshot = sanitizeProviderSnapshot(result.providerRequest).snapshot;
    const responseSnapshot = sanitizeProviderSnapshot(result.providerResponse).snapshot;
    const mapping = mapOutcomeToStatus(result.outcome);
    const reasonCode = this.truncate(result.reasonCode);
    const reason = this.truncate(result.reason);
    const resolvedAt = mapping.resolved ? new Date(result.resolvedAt) : undefined;

    await this.prisma.$transaction(async (tx) => {
      await tx.fiscalDocument.updateMany({
        where: { id: document.id, tenantId: document.tenantId, status: { in: ["SENDING"] } },
        data: {
          status: mapping.status,
          ...(result.outcome === "APPROVED"
            ? { externalId: result.externalId, cdc: result.cdc, resolvedAt }
            : {}),
          ...(mapping.status === "REJECTED"
            ? {
                externalId: result.externalId,
                lastErrorCode: reasonCode,
                lastErrorMessage: reason,
                resolvedAt,
              }
            : {}),
          ...(mapping.status === "ERROR"
            ? { lastErrorCode: reasonCode, lastErrorMessage: reason }
            : {}),
          requestSnapshot,
          responseSnapshot,
          ...(result.outcome === "APPROVED" ? { lastErrorCode: null, lastErrorMessage: null } : {}),
        },
      });
      await appendAuditLog(tx, {
        action:
          mapping.status === "ERROR"
            ? "fiscal.document.submission_failed"
            : "fiscal.document.submitted",
        actorType: "SYSTEM",
        tenantId: document.tenantId,
        targetType: "fiscal_document",
        targetId: document.id,
        metadata: { outcome: result.outcome, attemptCount },
      });
    });
  }

  private truncate(value: string | null): string | null {
    return value === null ? null : value.replace(/[\r\n\t]+/g, " ").slice(0, MAX_ERROR_LENGTH);
  }

  private errorMessage(reason: string | null, fallback: string): string {
    return this.truncate(reason) ?? fallback;
  }
}
