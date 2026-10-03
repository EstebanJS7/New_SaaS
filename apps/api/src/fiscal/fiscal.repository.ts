import { Inject, Injectable } from "@nestjs/common";
import { PrismaService } from "@newsaas/database";
import { DomainError } from "@newsaas/shared";
import { RequestContextService } from "../context/request-context.service.js";

export type FiscalDocumentStatus =
  | "PENDING"
  | "QUEUED"
  | "SENDING"
  | "SUBMITTED"
  | "APPROVED"
  | "REJECTED"
  | "ERROR"
  | "CANCEL_PENDING"
  | "CANCELLED";
export interface FiscalInvoiceRow {
  id: string;
  tenantId: string;
  status: string;
  lines: readonly { position: number }[];
}
export interface FiscalDocumentRow {
  id: string;
  tenantId: string;
  invoiceId: string;
  provider: string;
  status: FiscalDocumentStatus;
  attemptCount: number;
  externalId: string | null;
  cdc: string | null;
  lastErrorCode: string | null;
  createdAt: Date;
  updatedAt: Date;
  cancelledAt?: Date | null;
  requestSnapshot?: unknown;
  responseSnapshot?: unknown;
}
interface FiscalWhere {
  id?: string;
  tenantId: string;
  invoiceId?: string;
  status?: FiscalDocumentStatus | { in: readonly FiscalDocumentStatus[] } | { not: "CANCELLED" };
}
export interface FiscalDocumentReadTx {
  fiscalDocument: {
    findFirst(args: {
      where: { tenantId: string; invoiceId: string; status: { not: "CANCELLED" } };
    }): Promise<{ id: string } | null>;
  };
}
export interface FiscalRepositoryTx extends FiscalDocumentReadTx {
  $queryRaw: (query: TemplateStringsArray, ...values: unknown[]) => Promise<unknown[]>;
  invoice: {
    findFirst(args: {
      where: { id: string; tenantId: string };
      include: { lines: { orderBy: { position: "asc" } } };
    }): Promise<FiscalInvoiceRow | null>;
  };
  fiscalDocument: {
    findFirst(args: { where: FiscalWhere }): Promise<FiscalDocumentRow | null>;
    findMany(args: {
      where: { tenantId: string; status?: FiscalDocumentStatus };
      orderBy: { createdAt: "desc" };
    }): Promise<FiscalDocumentRow[]>;
    create(args: {
      data: { tenantId: string; invoiceId: string; provider: string; status: "PENDING" };
    }): Promise<FiscalDocumentRow>;
    updateMany(args: {
      where: FiscalWhere;
      data: {
        status?: FiscalDocumentStatus;
        cancelledAt?: Date;
        lastErrorCode?: string | null;
        lastErrorMessage?: string | null;
      };
    }): Promise<{ count: number }>;
  };
}
export const FISCAL_DOCUMENT_TARGET_NOT_FOUND_MESSAGE = "Fiscal document was not found.";
export const FISCAL_DOCUMENT_NOT_FOUND_MESSAGE = "Fiscal document source invoice was not found.";
export const FISCAL_DOCUMENT_ALREADY_ISSUED_MESSAGE =
  "A fiscal document has already been issued for this invoice.";
const UNIQUE_INDEX = "fiscal_document_tenant_id_invoice_id_key";

function isLiveDocumentConflict(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const candidate = error as { code?: unknown; meta?: { target?: unknown } };
  if (candidate.code !== "P2002") return false;
  const target = candidate.meta?.target;
  const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (typeof target === "string") return normalize(target) === normalize(UNIQUE_INDEX);
  if (Array.isArray(target)) {
    const fields = target.filter((item): item is string => typeof item === "string").map(normalize);
    return fields.length === 2 && fields.includes("tenantid") && fields.includes("invoiceid");
  }
  return false;
}

@Injectable()
export class FiscalRepository {
  constructor(
    @Inject(PrismaService) private readonly prisma: FiscalRepositoryTx,
    private readonly context: RequestContextService
  ) {}

  async lockDocument(id: string, tx: FiscalRepositoryTx): Promise<void> {
    const tenantId = this.context.requireTenantId();
    await tx.$queryRaw`SELECT "id" FROM "fiscal_document" WHERE "tenant_id" = ${tenantId}::uuid AND "id" = ${id}::uuid FOR UPDATE`;
  }
  async list(
    status: FiscalDocumentStatus | undefined,
    tx: FiscalRepositoryTx
  ): Promise<FiscalDocumentRow[]> {
    return tx.fiscalDocument.findMany({
      where: {
        tenantId: this.context.requireTenantId(),
        ...(status !== undefined ? { status } : {}),
      },
      orderBy: { createdAt: "desc" },
    });
  }
  async findDocument(id: string, tx: FiscalRepositoryTx): Promise<FiscalDocumentRow | null> {
    return tx.fiscalDocument.findFirst({
      where: { tenantId: this.context.requireTenantId(), id },
    });
  }
  async applyCancellation(
    id: string,
    observedStatus: FiscalDocumentStatus,
    write: {
      status?: FiscalDocumentStatus;
      cancelledAt?: Date;
      lastErrorCode?: string | null;
      lastErrorMessage?: string | null;
    },
    tx: FiscalRepositoryTx
  ): Promise<number> {
    const result = await tx.fiscalDocument.updateMany({
      where: { id, tenantId: this.context.requireTenantId(), status: observedStatus },
      data: write,
    });
    return result.count;
  }
  async lockInvoice(id: string, tx: FiscalRepositoryTx): Promise<void> {
    const tenantId = this.context.requireTenantId();
    await tx.$queryRaw`SELECT "id" FROM "invoice" WHERE "tenant_id" = ${tenantId}::uuid AND "id" = ${id}::uuid FOR UPDATE`;
  }
  async findInvoice(id: string, tx: FiscalRepositoryTx): Promise<FiscalInvoiceRow> {
    const row = await tx.invoice.findFirst({
      where: { id, tenantId: this.context.requireTenantId() },
      include: { lines: { orderBy: { position: "asc" } } },
    });
    if (!row) throw new DomainError("NOT_FOUND", FISCAL_DOCUMENT_NOT_FOUND_MESSAGE);
    return row;
  }
  async findLiveDocument(
    invoiceId: string,
    tx: FiscalRepositoryTx
  ): Promise<FiscalDocumentRow | null> {
    return tx.fiscalDocument.findFirst({
      where: { tenantId: this.context.requireTenantId(), invoiceId, status: { not: "CANCELLED" } },
    });
  }
  /**
   * Tenant-scoped "does this invoice have a live (non-CANCELLED) document?"
   * read for a caller that owns its own transaction handle (Billing, DEC-051).
   * Accepts the minimal {@link FiscalDocumentReadTx} so the caller never imports
   * the Fiscal persistence surface.
   */
  async hasLiveDocument(invoiceId: string, tx: FiscalDocumentReadTx): Promise<boolean> {
    const row = await tx.fiscalDocument.findFirst({
      where: { tenantId: this.context.requireTenantId(), invoiceId, status: { not: "CANCELLED" } },
    });
    return row !== null;
  }
  async create(
    data: { invoiceId: string; provider: string },
    tx: FiscalRepositoryTx
  ): Promise<FiscalDocumentRow> {
    try {
      return await tx.fiscalDocument.create({
        data: {
          tenantId: this.context.requireTenantId(),
          invoiceId: data.invoiceId,
          provider: data.provider,
          status: "PENDING",
        },
      });
    } catch (error) {
      if (isLiveDocumentConflict(error))
        throw new DomainError("CONFLICT", FISCAL_DOCUMENT_ALREADY_ISSUED_MESSAGE);
      throw error;
    }
  }
  async markQueued(
    id: string,
    expected: FiscalDocumentStatus,
    tx: FiscalRepositoryTx
  ): Promise<boolean> {
    const result = await tx.fiscalDocument.updateMany({
      where: { id, tenantId: this.context.requireTenantId(), status: expected },
      data: { status: "QUEUED" },
    });
    return result.count === 1;
  }
  get client(): FiscalRepositoryTx {
    return this.prisma;
  }
}
