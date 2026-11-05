import { createHash } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { Prisma, PrismaService } from "@newsaas/database";
import { DomainError } from "@newsaas/shared";
import { AuditWriter } from "../audit/audit-writer.service.js";
import { CashRepository, type CashSessionRow } from "../cash/cash.repository.js";
import { RequestContextService } from "../context/request-context.service.js";
import { EntitlementsService } from "../entitlements/entitlements.service.js";
import {
  FiscalCreditNoteService,
  type CreditNoteTx,
} from "../fiscal/fiscal-credit-note.service.js";
import { InventoryRepository } from "../inventory/inventory.repository.js";
import { PermissionResolver } from "../rbac/permission-resolver.service.js";
import { SALES_PERMISSIONS } from "./sales.permissions.js";
import { SaleRepository, type PaymentRow } from "./sales.repository.js";
import type { SalesWriteTx } from "./sales.service.js";

/**
 * Reversal of a COMPLETED sale ([[SAL-REV-001]], DEC-089, PRD §40, TD-018).
 *
 * The whole sale is reversed in ONE transaction, and nothing the completion wrote is
 * edited: the lines, the payments and the original `SALE` movements stay as they were.
 * The reversal ADDS, each pointing back at what it compensates:
 *
 * - one `sale_reversal` row (reason, actor, instant; UNIQUE per sale);
 * - one signed POSITIVE `SALE_REVERSAL` stock movement per original `SALE` movement,
 *   under the same per-(tenant, item) advisory lock and in the same ascending order
 *   the completion uses, with the projection rewritten as an absolute value;
 * - one `REFUND` cash movement per CASH payment, against the tenant's CURRENT open
 *   session (money leaves the drawer that is open now, not the one it entered);
 * - one `payment_refund` row per payment, whatever its method;
 * - the `COMPLETED -> CANCELLED` status write, conditional on `COMPLETED`;
 * - the idempotency record (when a key is supplied) and exactly one audit row.
 *
 * A sale with an invoice that is not cancelled is refused: reversing it needs an
 * electronic credit note (NCE), which is a separate Story. A draft invoice must be
 * cancelled first so it cannot be confirmed for a sale that no longer stands.
 */

export const SALE_REVERSE_OPERATION = "sale.reverse";
export const SALE_REVERSED_ACTION = "sale.reversed";
export const SALE_REVERSAL_MOVEMENT_REASON = "Anulación de venta";

export const SALE_NOT_REVERSIBLE_MESSAGE = "Solo se puede anular una venta cobrada.";
export const SALE_ALREADY_REVERSED_MESSAGE = "La venta ya fue anulada.";
export const SALE_HAS_DRAFT_INVOICE_MESSAGE =
  "La venta tiene un borrador de factura: cancelalo antes de anular la venta.";
export const SALE_REVERSAL_KEY_CONFLICT_MESSAGE =
  "La clave de idempotencia ya se usó para otra anulación.";
export const SALE_REVERSAL_NOT_FOUND_MESSAGE = "La venta no tiene una anulación registrada.";

export interface ReverseSaleInput {
  readonly reason: string;
}

export interface PaymentRefundView {
  readonly paymentId: string;
  readonly method: string;
  readonly amount: string;
}

export interface SaleReversalView {
  readonly id: string;
  readonly saleId: string;
  readonly reason: string;
  readonly reversedAt: string;
  readonly reversedByUserProfileId: string;
  readonly cashSessionId: string | null;
  readonly refunds: readonly PaymentRefundView[];
  /** NCE-001: the credit note issued because the sale was invoiced, if any. */
  readonly creditNote: CreditNoteView | null;
}

export interface CreditNoteView {
  readonly id: string;
  /** `dEst-dPunExp-dNumDoc`, the number printed on the KuDE. */
  readonly number: string;
  readonly issuedAt: string;
  /** The note's fiscal document status (QUEUED, SUBMITTED, APPROVED, REJECTED, ...). */
  readonly fiscalStatus: string | null;
}

/** The extra delegates a reversal needs beyond the completion's transaction shape. */
type ReversalTx = SalesWriteTx &
  CreditNoteTx &
  Pick<Prisma.TransactionClient, "saleReversal" | "paymentRefund" | "invoice"> & {
    stockMovement: Pick<Prisma.TransactionClient["stockMovement"], "findMany">;
  };

interface ReversalPrisma {
  $transaction: <T>(work: (tx: ReversalTx) => Promise<T>) => Promise<T>;
  saleReversal: Pick<Prisma.TransactionClient["saleReversal"], "findFirst">;
}

const SALE_MONEY_SCALE = 2;

function reversalFingerprint(saleId: string, reason: string): string {
  return createHash("sha256").update(`${saleId}\n${reason}`).digest("hex");
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

const REVERSAL_INCLUDE = {
  refunds: true,
  creditNote: {
    include: {
      range: { include: { establishment: true } },
      fiscalDocuments: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  },
} as const;

type ReversalRecord = Prisma.SaleReversalGetPayload<{ include: typeof REVERSAL_INCLUDE }>;

function toView(record: ReversalRecord): SaleReversalView {
  return {
    id: record.id,
    saleId: record.saleId,
    reason: record.reason,
    reversedAt: record.createdAt.toISOString(),
    reversedByUserProfileId: record.reversedByUserProfileId,
    cashSessionId: record.cashSessionId,
    refunds: [...record.refunds]
      .sort((left, right) => left.paymentId.localeCompare(right.paymentId))
      .map((refund) => ({
        paymentId: refund.paymentId,
        method: refund.method,
        amount: new Prisma.Decimal(refund.amount).toFixed(SALE_MONEY_SCALE),
      })),
    creditNote: record.creditNote
      ? {
          id: record.creditNote.id,
          number: `${record.creditNote.range.establishment.code}-${record.creditNote.expeditionPoint}-${record.creditNote.documentNumber}`,
          issuedAt: record.creditNote.issuedAt.toISOString(),
          fiscalStatus: record.creditNote.fiscalDocuments[0]?.status ?? null,
        }
      : null,
  };
}

@Injectable()
export class SaleReversalService {
  constructor(
    private readonly sales: SaleRepository,
    private readonly inventory: InventoryRepository,
    private readonly cash: CashRepository,
    @Inject(PrismaService) private readonly prisma: ReversalPrisma,
    private readonly entitlements: EntitlementsService,
    private readonly requestContext: RequestContextService,
    private readonly permissionResolver: PermissionResolver,
    private readonly audit: AuditWriter,
    private readonly creditNotes: FiscalCreditNoteService
  ) {}

  async reverse(
    saleId: string,
    input: ReverseSaleInput,
    idempotencyKey?: string
  ): Promise<{ reversal: SaleReversalView; replay: boolean }> {
    const tenantId = await this.assertAllowed();
    const actorUserProfileId = this.requestContext.requireUserProfileId();
    const reason = input.reason.trim();
    const fingerprint = reversalFingerprint(saleId, reason);

    let noteDocumentId: string | null = null;
    try {
      const result = await this.prisma.$transaction(async (tx) => {
        // Same primary serialization as the completion: the sale header row lock.
        await this.sales.lockById(saleId, tx);

        if (idempotencyKey !== undefined) {
          const record = await this.sales.findIdempotencyRecord(
            SALE_REVERSE_OPERATION,
            idempotencyKey,
            tx
          );
          if (record) {
            if (record.fingerprint !== fingerprint) {
              throw new DomainError("CONFLICT", SALE_REVERSAL_KEY_CONFLICT_MESSAGE);
            }
            return { reversal: await this.readReversal(record.resultSaleId, tx), replay: true };
          }
        }

        // Post-lock authoritative read: unknown/foreign ids are the shared 404.
        const sale = await this.sales.findById(saleId, tx);
        if (sale.status === "CANCELLED") {
          const existing = await tx.saleReversal.findFirst({ where: { tenantId, saleId } });
          throw new DomainError(
            "CONFLICT",
            existing ? SALE_ALREADY_REVERSED_MESSAGE : SALE_NOT_REVERSIBLE_MESSAGE
          );
        }
        if (sale.status !== "COMPLETED") {
          throw new DomainError("CONFLICT", SALE_NOT_REVERSIBLE_MESSAGE);
        }

        // The Billing/Fiscal gate (REVERSALS-CORRECTIONS "Sale"). A draft blocks;
        // a CONFIRMED invoice is compensated by a credit note (NCE-001), issued
        // below once the reversal row exists, and refused there unless SIFEN
        // approved the factura.
        const invoices = await tx.invoice.findMany({
          where: { tenantId, saleId, status: { in: ["DRAFT", "CONFIRMED"] } },
          select: { id: true, status: true },
        });
        const confirmed = invoices.find((invoice) => invoice.status === "CONFIRMED");
        if (confirmed === undefined && invoices.length > 0) {
          throw new DomainError("CONFLICT", SALE_HAS_DRAFT_INVOICE_MESSAGE);
        }

        const payments = await this.sales.listPayments(saleId, tx);
        const hasCash = payments.some((payment) => payment.method === "CASH");
        // Zero or several open sessions are the completion's own stable 409s.
        const session: CashSessionRow | undefined = hasCash
          ? await this.cash.resolveSingleOpenSession(sale.branchId, tx)
          : undefined;

        await this.compensateStock(tenantId, saleId, sale.branchId, sale.lines, tx);

        const reversal = await tx.saleReversal.create({
          data: {
            tenantId,
            saleId,
            reason,
            reversedByUserProfileId: actorUserProfileId,
            cashSessionId: session?.id ?? null,
          },
        });

        await this.refundPayments(tenantId, saleId, reversal.id, payments, session, tx);

        const note =
          confirmed === undefined
            ? null
            : await this.creditNotes.issueForReversal({
                invoiceId: confirmed.id,
                saleReversalId: reversal.id,
                saleId,
                reason,
                tx,
              });

        const applied = await tx.sale.updateMany({
          where: { id: saleId, tenantId, status: "COMPLETED" },
          data: { status: "CANCELLED" },
        });
        if (applied.count !== 1) {
          throw new DomainError("CONFLICT", SALE_NOT_REVERSIBLE_MESSAGE);
        }

        if (idempotencyKey !== undefined) {
          await this.sales.createIdempotencyRecord(
            {
              operation: SALE_REVERSE_OPERATION,
              key: idempotencyKey,
              fingerprint,
              resultSaleId: saleId,
            },
            tx
          );
        }

        await this.audit.append(
          {
            action: SALE_REVERSED_ACTION,
            tenantId,
            actorUserProfileId,
            targetType: "sale",
            targetId: saleId,
            // Counts and kinds only: the reason is free text and stays in its row.
            metadata: {
              saleReversalId: reversal.id,
              refunds: payments.length,
              cashRefund: hasCash,
              creditNoteId: note?.creditNoteId ?? null,
            },
          },
          tx
        );

        noteDocumentId = note?.fiscalDocumentId ?? null;
        return { reversal: await this.readReversal(saleId, tx), replay: false };
      });
      // After the commit: the worker sends the note through the existing pipeline.
      if (noteDocumentId !== null) await this.creditNotes.enqueue(noteDocumentId);
      return result;
    } catch (error) {
      // A concurrent first attempt with the SAME key won the unique race: replay it.
      if (idempotencyKey !== undefined && isUniqueViolation(error)) {
        const record = await this.sales.findIdempotencyRecord(
          SALE_REVERSE_OPERATION,
          idempotencyKey
        );
        if (record?.fingerprint === fingerprint) {
          return { reversal: await this.readReversal(record.resultSaleId), replay: true };
        }
      }
      // A concurrent reversal WITHOUT a key lost the `sale_reversal` unique.
      if (isUniqueViolation(error)) {
        throw new DomainError("CONFLICT", SALE_ALREADY_REVERSED_MESSAGE);
      }
      throw error;
    }
  }

  /** The reversal of a sale in the caller's tenant, or the shared 404. */
  async getReversal(saleId: string): Promise<SaleReversalView> {
    await this.assertAllowed(SALES_PERMISSIONS.read);
    return this.readReversal(saleId);
  }

  private async readReversal(saleId: string, tx?: ReversalTx): Promise<SaleReversalView> {
    const tenantId = this.requestContext.requireTenantId();
    const client = tx ?? this.prisma;
    const record = await client.saleReversal.findFirst({
      where: { tenantId, saleId },
      include: REVERSAL_INCLUDE,
    });
    if (!record) throw new DomainError("NOT_FOUND", SALE_REVERSAL_NOT_FOUND_MESSAGE);
    return toView(record);
  }

  /**
   * One positive `SALE_REVERSAL` per original `SALE` movement of this sale. A sale
   * completed before DEC-089 has no stamped movements; its tracked lines are then
   * compensated from the line quantities, without a `reversesMovementId`.
   */
  private async compensateStock(
    tenantId: string,
    saleId: string,
    saleBranchId: string,
    lines: readonly { catalogItemId: string; quantity: Prisma.Decimal | string }[],
    tx: ReversalTx
  ): Promise<void> {
    const originals = await tx.stockMovement.findMany({
      where: { tenantId, saleId, type: "SALE" },
      select: { id: true, catalogItemId: true, quantity: true, branchId: true },
    });

    // MB-003 (DEC-094 §10): the stock goes back to the branch it left.
    let plan: {
      catalogItemId: string;
      branchId: string;
      quantity: Prisma.Decimal;
      reverses: string | null;
    }[];
    if (originals.length > 0) {
      plan = originals.map((movement) => ({
        catalogItemId: movement.catalogItemId,
        branchId: movement.branchId,
        quantity: new Prisma.Decimal(movement.quantity).abs(),
        reverses: movement.id,
      }));
    } else {
      plan = [];
      for (const line of lines) {
        const item = await this.inventory.findItem(line.catalogItemId, tx);
        if (!item.tracksStock) continue;
        plan.push({
          catalogItemId: line.catalogItemId,
          branchId: saleBranchId,
          quantity: new Prisma.Decimal(line.quantity).abs(),
          reverses: null,
        });
      }
    }

    // The completion's lock order: ascending catalogItemId.
    plan.sort((left, right) => left.catalogItemId.localeCompare(right.catalogItemId));
    for (const entry of plan) {
      await this.inventory.lockItemStock(entry.catalogItemId, entry.branchId, tx);
      const balance = await this.inventory.findBalance(entry.catalogItemId, entry.branchId, tx);
      const projected = new Prisma.Decimal(balance?.quantity ?? 0).plus(entry.quantity);
      await this.inventory.createMovement(
        {
          catalogItemId: entry.catalogItemId,
          type: "SALE_REVERSAL",
          quantity: entry.quantity,
          reason: SALE_REVERSAL_MOVEMENT_REASON,
          saleId,
          reversesMovementId: entry.reverses,
          branchId: entry.branchId,
        },
        tx
      );
      await this.inventory.upsertBalance(entry.catalogItemId, entry.branchId, projected, tx);
    }
  }

  private async refundPayments(
    tenantId: string,
    saleId: string,
    saleReversalId: string,
    payments: readonly PaymentRow[],
    session: CashSessionRow | undefined,
    tx: ReversalTx
  ): Promise<void> {
    const ordered = [...payments].sort((left, right) => left.id.localeCompare(right.id));
    for (const payment of ordered) {
      let cashMovementId: string | null = null;
      if (payment.method === "CASH") {
        if (session === undefined) {
          throw new DomainError("CONFLICT", SALE_NOT_REVERSIBLE_MESSAGE);
        }
        const movement = await this.cash.createRefundMovement(
          {
            registerId: session.registerId,
            sessionId: session.id,
            amount: payment.amount,
            reason: SALE_REVERSAL_MOVEMENT_REASON,
            saleId,
          },
          tx
        );
        cashMovementId = movement.id;
      }
      await tx.paymentRefund.create({
        data: {
          tenantId,
          paymentId: payment.id,
          saleReversalId,
          method: payment.method,
          amount: payment.amount,
          cashMovementId,
        },
      });
    }
  }

  private async assertAllowed(permission: string = SALES_PERMISSIONS.reverse): Promise<string> {
    const tenantId = this.requestContext.requireTenantId();
    if (!(await this.entitlements.has(tenantId, "sales"))) {
      throw new DomainError("FEATURE_NOT_ENTITLED", "The sales feature is not enabled.");
    }
    const permissions = await this.permissionResolver.resolveForActiveRequest();
    if (!permissions.has(permission)) {
      throw new DomainError("FORBIDDEN", "The required sale permission is missing.");
    }
    return tenantId;
  }
}
