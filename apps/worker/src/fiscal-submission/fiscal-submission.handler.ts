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
  // FISC-009 appended SIGNING to `fiscal_document_status`; this mirror kept nine
  // values until FISC-010 WU-D closed the drift (lifecycle order, not the
  // enum's append order).
  | "SIGNING"
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
  readonly lastAttemptAt: Date | null;
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
    where: {
      id: string;
      tenantId: string;
      /** Either a claimable set, or one observed status for a lease CAS. */
      status: { in: readonly FiscalStatus[] } | FiscalStatus;
      /** Present only on a stale-claim compare-and-swap. */
      lastAttemptAt?: Date | null;
    };
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
  readonly status: "APPROVED" | "REJECTED" | "ERROR" | "SUBMITTED";
  readonly resolved: boolean;
}

export function mapOutcomeToStatus(outcome: FiscalIssueOutcome): OutcomeStatusMapping {
  switch (outcome) {
    case "APPROVED":
      return { status: "APPROVED", resolved: true };
    case "REJECTED":
    case "FUNCTIONAL_REJECTION":
      return { status: "REJECTED", resolved: true };
    case "SUBMITTED":
      // ADR-007 §1: the provider took the document into its queue. `SUBMITTED`
      // is the state that was pre-wired for this since EPIC-15 and had no
      // writer; it is unresolved, so `resolved_at` stays null, and it is not a
      // failure, so the caller must not retry it.
      return { status: "SUBMITTED", resolved: false };
    case "CONFIGURATION_ERROR":
    case "TRANSIENT_FAILURE":
      return { status: "ERROR", resolved: false };
  }
}

const MAX_ERROR_LENGTH = 500;

/**
 * Statuses this handler must never touch again: the document is resolved, or the
 * provider owns it and a later callback decides.
 */
const PROVIDER_OWNED_OR_TERMINAL: readonly FiscalStatus[] = [
  "APPROVED",
  "REJECTED",
  "CANCELLED",
  "SUBMITTED",
];

/** Statuses a delivery may claim. */
const CLAIMABLE_STATUSES: readonly FiscalStatus[] = ["PENDING", "QUEUED", "ERROR"];

/**
 * How long a committed `SENDING` claim is honoured.
 *
 * The claim is committed before the provider call, so a worker that dies in
 * between — restart, OOM kill, container reschedule — leaves the row in
 * `SENDING` with no writer. The transition guard admits no other exit from
 * `SENDING`, and the reconciliation sweep is deferred technical debt, so without
 * a lease the document is stalled permanently and silently: every redelivered
 * job would no-op and report success.
 *
 * Past this age the claim is treated as abandoned and a delivery may take it
 * over, which is the only in-band recovery available until the sweep lands.
 */
const CLAIM_LEASE_MS = 5 * 60_000;

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

    if (PROVIDER_OWNED_OR_TERMINAL.includes(document.status)) {
      return;
    }
    if (document.status === "SENDING" && !this.isClaimAbandoned(document)) {
      // A fresh claim belongs to another worker, so this is a duplicate delivery
      // and must not call the provider again.
      return;
    }

    const attemptCount = document.attemptCount + 1;
    const startedAt = new Date();
    // A stale `SENDING` is re-claimed by compare-and-swap on the observed lease
    // timestamp, so two workers that both see the same abandoned claim cannot
    // both win it. A `SENDING` row is never claimed by status alone.
    const claimWhere =
      document.status === "SENDING"
        ? {
            id: document.id,
            tenantId: document.tenantId,
            status: "SENDING" as const,
            lastAttemptAt: document.lastAttemptAt,
          }
        : {
            id: document.id,
            tenantId: document.tenantId,
            status: { in: CLAIMABLE_STATUSES },
          };
    const claimed = await this.prisma.fiscalDocument.updateMany({
      where: claimWhere,
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
      document: null,
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
    // ADR-007 §4: `submitted_at` is set at the moment the hand-over happened,
    // which is the instant this result was produced. It comes from the same
    // provider-reported clock `resolvedAt` already comes from, so every
    // timestamp this method writes belongs to one clock domain instead of two.
    const submittedAt = result.outcome === "SUBMITTED" ? new Date(result.resolvedAt) : undefined;

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
          // ADR-007 §4/guardrail 3: the handle is written in the SAME
          // conditional update that enters SUBMITTED, so a restart between the
          // provider's answer and the next reconciliation pass cannot lose the
          // reference the query polls with. `resolvedAt` stays out on purpose:
          // SUBMITTED is not a resolution, and the guard requires `resolved_at`
          // only on entry to APPROVED or REJECTED.
          //
          // ADR-007 §2 makes the document's own identity a first-class query
          // identifier — the reference is the fast path and the CDC is the path
          // that survives losing the hand-over answer — so whatever the result
          // carries is persisted here too, and a result that carries none of the
          // three writes none of them: an absent value must never become a null
          // write, because the guard refuses to clear any of those columns and an
          // aborted transaction here is a retried submission of a document the
          // provider already holds. A hand-over answer that carries nothing
          // leaves the row SUBMITTED with no reconciliation identifier: that is
          // the provider's answer, recorded rather than invented, and the
          // reconciliation stage treats it as an operator case (FISC-012).
          ...(result.outcome === "SUBMITTED"
            ? {
                ...(result.providerReference === null
                  ? {}
                  : { providerReference: result.providerReference }),
                submittedAt,
                ...(result.cdc === null ? {} : { cdc: result.cdc }),
                ...(result.externalId === null ? {} : { externalId: result.externalId }),
              }
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

  private isClaimAbandoned(document: FiscalDocumentRecord): boolean {
    if (document.lastAttemptAt === null) return true;
    return Date.now() - document.lastAttemptAt.getTime() > CLAIM_LEASE_MS;
  }

  private truncate(value: string | null): string | null {
    return value === null ? null : value.replace(/[\r\n\t]+/g, " ").slice(0, MAX_ERROR_LENGTH);
  }

  private errorMessage(reason: string | null, fallback: string): string {
    return this.truncate(reason) ?? fallback;
  }
}
