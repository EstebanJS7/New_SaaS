import { Inject, Injectable } from "@nestjs/common";
import { PrismaService, Prisma, appendAuditLog, type AuditAppendTx } from "@newsaas/database";
import {
  defaultDteSchemaDirectory,
  DteSchemaError,
  FISCAL_PROVIDER,
  isRetryableOutcome,
  sanitizeProviderSnapshot,
  validateDeAgainstOfficialXsd,
  type FiscalIssueDocument,
  type FiscalIssueOutcome,
  type FiscalIssueRequest,
  type FiscalIssueResult,
  type FiscalProviderId,
  type FiscalProviderPort,
  type FiscalSubmissionJob,
} from "@newsaas/fiscal";
import {
  createOpaqueStorageKey,
  STORAGE_KEY_PREFIXES,
  STORAGE_PORT,
  type StoragePort,
} from "@newsaas/storage";
import { FISCAL_DOCUMENT_BUILDER, type FiscalDocumentBuilder } from "./fiscal-document-builder.js";

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
  /** Written with the stored signed XML; the `SENDING` recovery reads it back. */
  readonly xmlStorageKey: string | null;
  /** The built document's identity; written with the custody so a recovery resends it. */
  readonly cdc: string | null;
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
 * How long a committed `SIGNING` or `SENDING` claim is honoured.
 *
 * The claim is committed before the document stage runs and before the provider
 * call, so a worker that dies in between — restart, OOM kill, container
 * reschedule — leaves the row claimed with no writer. Past this age the claim
 * is treated as abandoned and a delivery may take it over, which is the only
 * in-band recovery available until the reconciliation sweep lands.
 */
const CLAIM_LEASE_MS = 5 * 60_000;

/** The stage's answer: a document (or `null` for a provider that needs none), or a recorded failure. */
type StageResult =
  | { readonly outcome: "READY"; readonly document: FiscalIssueDocument | null }
  | { readonly outcome: "FAILED" };

/** The first schema diagnostics, bounded. The document's bytes never enter a reason. */
function firstDiagnostics(errors: readonly string[]): string {
  return errors.slice(0, 3).join("; ") || "The document did not validate against the official XSD.";
}

@Injectable()
export class FiscalSubmissionHandler {
  constructor(
    @Inject(PrismaService) private readonly prisma: FiscalHandlerPrisma,
    @Inject(FISCAL_PROVIDER) private readonly provider: FiscalProviderPort,
    @Inject(FISCAL_DOCUMENT_BUILDER) private readonly documentBuilder: FiscalDocumentBuilder,
    @Inject(STORAGE_PORT) private readonly storage: StoragePort
  ) {}

  async handle(job: FiscalSubmissionJob): Promise<void> {
    const document = await this.prisma.fiscalDocument.findFirst({
      where: { tenantId: job.tenantId, id: job.fiscalDocumentId },
    });
    if (!document) return;

    if (PROVIDER_OWNED_OR_TERMINAL.includes(document.status)) {
      return;
    }
    // `SIGNING` and `SENDING` are committed claims; a fresh one belongs to
    // another worker, so this is a duplicate delivery and must not touch it.
    const reclaiming = document.status === "SIGNING" || document.status === "SENDING";
    if (reclaiming && !this.isClaimAbandoned(document)) {
      return;
    }

    const attemptCount = document.attemptCount + 1;
    const startedAt = new Date();
    // The transition guard admits `PENDING|QUEUED|ERROR -> SIGNING`,
    // `SIGNING -> SENDING` and `SIGNING -> ERROR`, and it does NOT admit
    // `SENDING -> SIGNING`. A re-claim of an abandoned row therefore KEEPS the
    // status it observed — `SIGNING` re-claims as `SIGNING`, `SENDING` as
    // `SENDING` — which is why the re-claim is a compare-and-swap on the
    // observed lease timestamp rather than a status write; only a row claimed
    // from `CLAIMABLE_STATUSES` moves to `SIGNING`.
    const claimWhere = reclaiming
      ? {
          id: document.id,
          tenantId: document.tenantId,
          status: document.status,
          lastAttemptAt: document.lastAttemptAt,
        }
      : {
          id: document.id,
          tenantId: document.tenantId,
          status: { in: CLAIMABLE_STATUSES },
        };
    const claimed = await this.prisma.fiscalDocument.updateMany({
      where: claimWhere,
      data: {
        ...(reclaiming ? {} : { status: "SIGNING" }),
        attemptCount: { increment: 1 },
        lastAttemptAt: startedAt,
      },
    });
    if (claimed.count !== 1) return;

    const invoice = await this.prisma.invoice.findFirst({
      where: { id: document.invoiceId, tenantId: document.tenantId },
      include: { lines: { orderBy: { position: "asc" } } },
    });
    if (!invoice?.confirmedAt || invoice.number === null) {
      // A stage failure, and terminal: a confirmed invoice is a precondition of
      // the claim, so a retry cannot conjure one. The sweep re-drives `ERROR`
      // only when an operator has fixed the data.
      await this.failStage(
        document,
        "INVOICE_SNAPSHOT_UNAVAILABLE",
        "The fiscal submission's confirmed invoice snapshot is unavailable.",
        attemptCount
      );
      return;
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

    const staged = await this.stageDocument(document, document.status === "SENDING", attemptCount);
    if (staged.outcome === "FAILED") return;

    const request: FiscalIssueRequest = {
      fiscalDocumentId: document.id,
      tenantId: document.tenantId,
      provider: document.provider,
      document: staged.document,
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

  /**
   * The stage between the claim and the provider call (ADR-009 §4):
   *
   * ```text
   * build -> store -> xml_storage_key -> XSD gate -> SIGNING -> SENDING
   * ```
   *
   * It runs only when the provider requires a document. With the fake — or any
   * provider that requires none — the stage is a pass-through: the assembly is
   * never asked, nothing is stored and no gate runs.
   *
   * A re-claimed `SENDING` row does not rebuild: the previous attempt already
   * stored and gated the document, so the recovery resends the stored bytes —
   * the same CDC, the same signed XML — because the guard admits no
   * `SENDING -> SIGNING` and a regenerated document would be a second identity
   * for one submission.
   */
  private async stageDocument(
    document: FiscalDocumentRecord,
    resumingSubmission: boolean,
    attemptCount: number
  ): Promise<StageResult> {
    if (!this.provider.requiresSignedDocument) {
      return { outcome: "READY", document: null };
    }
    if (resumingSubmission) {
      return this.resumeStoredDocument(document, attemptCount);
    }

    const built = await this.documentBuilder.build({
      tenantId: document.tenantId,
      fiscalDocumentId: document.id,
    });
    if (built.outcome === "UNAVAILABLE") {
      await this.failStage(document, built.reasonCode, built.reason, attemptCount);
      return { outcome: "FAILED" };
    }

    // Store-then-validate: the bytes reach storage before the gate can refuse
    // the document, so a refused document stays inspectable, and
    // `xml_storage_key` is written only after the put succeeded — a document
    // that was never stored has no key.
    let storageKey: string;
    try {
      const stored = await this.storage.put({
        key: createOpaqueStorageKey(STORAGE_KEY_PREFIXES.fiscalDocument),
        body: Buffer.from(built.document.signedXml, "utf8"),
        contentType: "application/xml",
      });
      storageKey = stored.key;
    } catch {
      // No raw driver message: it cannot be proven free of the stored bytes.
      await this.failStage(
        document,
        "DOCUMENT_STORAGE_WRITE_FAILED",
        "The signed document could not be stored; nothing was submitted.",
        attemptCount
      );
      return { outcome: "FAILED" };
    }

    // The CDC goes with the key: both are read back by a `SENDING` recovery,
    // and the CDC is the identity the reconciliation asks with when the
    // hand-over answer is lost (ADR-007 §2).
    const keyed = await this.prisma.fiscalDocument.updateMany({
      where: { id: document.id, tenantId: document.tenantId, status: "SIGNING" },
      data: { xmlStorageKey: storageKey, cdc: built.document.cdc },
    });
    if (keyed.count !== 1) {
      // The claim was stolen; the stored object is an orphan, and this worker
      // must not submit anything.
      return { outcome: "FAILED" };
    }

    try {
      const validation = await validateDeAgainstOfficialXsd(
        built.document.signedXml,
        defaultDteSchemaDirectory()
      );
      if (!validation.valid) {
        await this.failStage(
          document,
          "XSD_VALIDATION_FAILED",
          firstDiagnostics(validation.errors),
          attemptCount
        );
        return { outcome: "FAILED" };
      }
    } catch (error) {
      if (!(error instanceof DteSchemaError)) {
        throw error;
      }
      // ADR-010 §3: fail closed and name the directory; a path is not secret.
      await this.failStage(document, error.failure, error.message, attemptCount);
      return { outcome: "FAILED" };
    }

    const advanced = await this.prisma.fiscalDocument.updateMany({
      where: { id: document.id, tenantId: document.tenantId, status: "SIGNING" },
      data: { status: "SENDING" },
    });
    if (advanced.count !== 1) {
      return { outcome: "FAILED" };
    }
    return { outcome: "READY", document: built.document };
  }

  /**
   * The `SENDING` recovery: the document was stored and gated before the
   * transition, so this resends exactly those bytes rather than building a
   * second document for one fiscal number.
   */
  private async resumeStoredDocument(
    document: FiscalDocumentRecord,
    attemptCount: number
  ): Promise<StageResult> {
    if (document.xmlStorageKey === null || document.cdc === null) {
      await this.failStage(
        document,
        "DOCUMENT_CUSTODY_INCOMPLETE",
        "The claimed document has no stored signed XML to resubmit.",
        attemptCount
      );
      return { outcome: "FAILED" };
    }
    try {
      const stored = await this.storage.get({ key: document.xmlStorageKey });
      return {
        outcome: "READY",
        document: { cdc: document.cdc, signedXml: stored.body.toString("utf8") },
      };
    } catch {
      await this.failStage(
        document,
        "DOCUMENT_STORAGE_READ_FAILED",
        "The stored signed document could not be read; nothing was submitted.",
        attemptCount
      );
      return { outcome: "FAILED" };
    }
  }

  /**
   * Lands a stage failure on `ERROR` with a sanitized reason.
   *
   * The claim is either `SIGNING` (a fresh claim or a signing recovery) or
   * `SENDING` (a submission recovery), and the guard admits both to `ERROR`.
   * The reason is truncated and newline-flattened by {@link truncate}, and the
   * document's bytes never enter it.
   */
  private async failStage(
    document: FiscalDocumentRecord,
    reasonCode: string,
    reason: string,
    attemptCount: number
  ): Promise<void> {
    const code = this.truncate(reasonCode);
    const message = this.truncate(reason);
    await this.prisma.$transaction(async (tx) => {
      await tx.fiscalDocument.updateMany({
        where: {
          id: document.id,
          tenantId: document.tenantId,
          status: { in: ["SIGNING", "SENDING"] },
        },
        data: { status: "ERROR", lastErrorCode: code, lastErrorMessage: message },
      });
      await appendAuditLog(tx, {
        action: "fiscal.document.submission_failed",
        actorType: "SYSTEM",
        tenantId: document.tenantId,
        targetType: "fiscal_document",
        targetId: document.id,
        metadata: { outcome: "CONFIGURATION_ERROR", attemptCount },
      });
    });
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
