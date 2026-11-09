import { Inject, Injectable, Logger } from "@nestjs/common";
import type { Prisma } from "@newsaas/database";
import { DomainError } from "@newsaas/shared";
import { FISCAL_PROVIDER, type FiscalProviderPort } from "@newsaas/fiscal";
import { AuditWriter, type AuditAppendTx } from "../audit/audit-writer.service.js";
import { RequestContextService } from "../context/request-context.service.js";
import {
  FiscalAllocationService,
  FISCAL_ALLOCATION_AMBIGUOUS_RANGE_MESSAGE,
  FISCAL_ALLOCATION_NO_ACTIVE_RANGE_MESSAGE,
  type FiscalAllocationTx,
} from "./fiscal-allocation.service.js";
import {
  FISCAL_SUBMISSION_PRODUCER,
  type FiscalSubmissionProducer,
} from "./fiscal-submission.producer.js";

/**
 * NCE-001 / DEC-090 — the Nota de Crédito Electrónica a sale reversal issues
 * when the sale's invoice was approved by SIFEN.
 *
 * It runs INSIDE the reversal's transaction, so the stock and cash
 * compensations, the note, its fiscal number and its fiscal document commit
 * together or not at all. The submission itself is the existing pipeline: the
 * document is written `QUEUED`, and {@link enqueue} hands it to the worker after
 * the commit. A lost enqueue is re-driven by the recovery sweep, which picks up
 * stale `QUEUED` rows.
 *
 * The credit is TOTAL (DEC-089 §1): the worker builds the note's items from the
 * credited invoice's frozen lines.
 */

/** `E401 iMotEmi = 2`, "Devolución": a reversed sale returns the whole operation. */
export const CREDIT_NOTE_REVERSAL_MOTIVE = 2;
/** `iTiDE` of a Nota de Crédito Electrónica. */
export const CREDIT_NOTE_DOCUMENT_TYPE = 5;
export const FISCAL_CREDIT_NOTE_ISSUED_ACTION = "fiscal.credit_note.issued";

export const CREDIT_NOTE_INVOICE_NOT_ELECTRONIC_MESSAGE =
  "La factura de esta venta no tiene un documento electrónico: cancelá la factura antes de anular la venta.";
export const CREDIT_NOTE_INVOICE_PENDING_MESSAGE =
  "La factura electrónica todavía no fue aprobada por SIFEN: esperá la aprobación para anular la venta.";
export const CREDIT_NOTE_INVOICE_NOT_APPROVED_MESSAGE =
  "SIFEN no aprobó la factura electrónica: cancelá la factura antes de anular la venta.";
export const CREDIT_NOTE_INVOICE_CANCELLING_MESSAGE =
  "La factura electrónica tiene una cancelación en curso: esperá su resultado.";
export const CREDIT_NOTE_NO_ISSUANCE_POINT_MESSAGE =
  "El perfil fiscal no declara un establecimiento y punto de expedición: declaralo en Configuración › Configuración fiscal para emitir la nota de crédito.";
export const CREDIT_NOTE_NO_RANGE_MESSAGE =
  "No hay un timbrado activo para notas de crédito en el punto de expedición declarado: cargalo en Configuración › Configuración fiscal.";
export const CREDIT_NOTE_AMBIGUOUS_RANGE_MESSAGE =
  "Hay más de un timbrado activo para notas de crédito en el punto de expedición declarado.";
export const CREDIT_NOTE_ALREADY_ISSUED_MESSAGE = "La factura ya tiene una nota de crédito.";

const PENDING_STATUSES = new Set(["PENDING", "QUEUED", "SIGNING", "SENDING", "SUBMITTED"]);

/** The transaction handle the issue needs: the allocation's, plus its own writes. */
export type CreditNoteTx = FiscalAllocationTx &
  Pick<Prisma.TransactionClient, "creditNote" | "fiscalDocument" | "$queryRaw"> & {
    auditLog: AuditAppendTx["auditLog"];
  };

export interface IssuedCreditNote {
  readonly creditNoteId: string;
  readonly fiscalDocumentId: string;
  readonly documentNumber: string;
}

@Injectable()
export class FiscalCreditNoteService {
  private readonly logger = new Logger(FiscalCreditNoteService.name);

  constructor(
    private readonly context: RequestContextService,
    private readonly allocation: FiscalAllocationService,
    private readonly audit: AuditWriter,
    @Inject(FISCAL_PROVIDER) private readonly provider: FiscalProviderPort,
    @Inject(FISCAL_SUBMISSION_PRODUCER) private readonly producer: FiscalSubmissionProducer
  ) {}

  /**
   * Issues the total credit note for a CONFIRMED invoice whose factura SIFEN
   * approved. MUST run inside the caller's transaction, after the caller has
   * locked the sale. Refuses with a Spanish `409` for every state in which a
   * note cannot be issued, so the reversal rolls back untouched.
   */
  async issueForReversal(args: {
    readonly invoiceId: string;
    readonly saleReversalId: string;
    /** MB-002: the credited sale, whose branch decides the issuance point. */
    readonly saleId?: string;
    readonly reason: string;
    readonly tx: CreditNoteTx;
  }): Promise<IssuedCreditNote> {
    const { tx, invoiceId } = args;
    const tenantId = this.context.requireTenantId();
    const actorUserProfileId = this.context.requireUserProfileId();

    // Serializes against a concurrent factura cancellation of the same invoice.
    await tx.$queryRaw`SELECT "id" FROM "invoice" WHERE "tenant_id" = ${tenantId}::uuid AND "id" = ${invoiceId}::uuid FOR UPDATE`;

    const factura = await tx.fiscalDocument.findFirst({
      where: { tenantId, invoiceId, creditNoteId: null, status: { not: "CANCELLED" } },
    });
    if (factura === null) {
      throw new DomainError("CONFLICT", CREDIT_NOTE_INVOICE_NOT_ELECTRONIC_MESSAGE);
    }
    if (factura.status === "CANCEL_PENDING") {
      throw new DomainError("CONFLICT", CREDIT_NOTE_INVOICE_CANCELLING_MESSAGE);
    }
    if (PENDING_STATUSES.has(factura.status)) {
      throw new DomainError("CONFLICT", CREDIT_NOTE_INVOICE_PENDING_MESSAGE);
    }
    // H004a/H004b: the referenced CDC must exist in SIFEN and not be cancelled.
    if (factura.status !== "APPROVED" || factura.cdc === null) {
      throw new DomainError("CONFLICT", CREDIT_NOTE_INVOICE_NOT_APPROVED_MESSAGE);
    }

    const existing = await tx.creditNote.findFirst({ where: { tenantId, invoiceId } });
    if (existing !== null) {
      throw new DomainError("CONFLICT", CREDIT_NOTE_ALREADY_ISSUED_MESSAGE);
    }

    const allocated = await this.allocateNumber(tx, args.saleId);
    const issuedAt = new Date();
    const note = await tx.creditNote.create({
      data: {
        tenantId,
        invoiceId,
        saleReversalId: args.saleReversalId,
        motive: CREDIT_NOTE_REVERSAL_MOTIVE,
        reason: args.reason,
        associatedCdc: factura.cdc,
        rangeId: allocated.rangeId,
        timbradoNumber: allocated.timbradoNumber,
        establishmentId: allocated.establishmentId,
        expeditionPoint: allocated.expeditionPoint,
        documentType: allocated.documentType,
        series: allocated.series,
        documentNumber: allocated.documentNumber,
        issuedByUserProfileId: actorUserProfileId,
        issuedAt,
      },
    });

    // Written QUEUED directly: the reversal IS the issue command for the note,
    // and the recovery sweep re-drives a QUEUED row whose enqueue was lost.
    const document = await tx.fiscalDocument.create({
      data: {
        tenantId,
        invoiceId,
        creditNoteId: note.id,
        provider: this.provider.provider,
        status: "PENDING",
      },
    });
    await tx.fiscalDocument.updateMany({
      where: { id: document.id, tenantId, status: "PENDING" },
      data: { status: "QUEUED" },
    });

    await this.audit.append(
      {
        action: FISCAL_CREDIT_NOTE_ISSUED_ACTION,
        tenantId,
        actorUserProfileId,
        targetType: "credit_note",
        targetId: note.id,
        metadata: {
          invoiceId,
          saleReversalId: args.saleReversalId,
          fiscalDocumentId: document.id,
          motive: CREDIT_NOTE_REVERSAL_MOTIVE,
        },
      },
      tx
    );

    return {
      creditNoteId: note.id,
      fiscalDocumentId: document.id,
      documentNumber: allocated.documentNumber,
    };
  }

  /**
   * Hands the committed note's document to the worker. Never throws: the
   * reversal is already committed, and the recovery sweep re-drives a QUEUED
   * document whose enqueue did not happen.
   */
  async enqueue(fiscalDocumentId: string): Promise<void> {
    const tenantId = this.context.requireTenantId();
    try {
      await this.producer.enqueue({ fiscalDocumentId, tenantId });
    } catch (error) {
      this.logger.warn(
        `Credit note document ${fiscalDocumentId} stays QUEUED for the recovery sweep: ${
          error instanceof Error ? error.name : "unknown error"
        }`
      );
    }
  }

  private async allocateNumber(tx: CreditNoteTx, saleId?: string) {
    try {
      const allocated = await this.allocation.allocateForDocumentType({
        documentType: CREDIT_NOTE_DOCUMENT_TYPE,
        tx,
        ...(saleId === undefined ? {} : { saleId }),
      });
      if (allocated === null) {
        throw new DomainError("CONFLICT", CREDIT_NOTE_NO_ISSUANCE_POINT_MESSAGE);
      }
      return allocated;
    } catch (error) {
      if (
        error instanceof DomainError &&
        error.message === FISCAL_ALLOCATION_NO_ACTIVE_RANGE_MESSAGE
      ) {
        throw new DomainError("CONFLICT", CREDIT_NOTE_NO_RANGE_MESSAGE);
      }
      if (
        error instanceof DomainError &&
        error.message === FISCAL_ALLOCATION_AMBIGUOUS_RANGE_MESSAGE
      ) {
        throw new DomainError("CONFLICT", CREDIT_NOTE_AMBIGUOUS_RANGE_MESSAGE);
      }
      throw error;
    }
  }
}
