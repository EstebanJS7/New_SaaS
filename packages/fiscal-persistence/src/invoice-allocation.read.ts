import type { Prisma } from "@newsaas/database";

/**
 * FISC-015 WU-B — the authorisation a confirmed invoice's fiscal number came from.
 *
 * [[DEC-056]] decided that the fiscal number is allocated **at invoice
 * confirmation**, from the tenant's timbrado range, inside the confirmation
 * transaction, and that the range's identity is persisted beside the invoice —
 * so the worker's assembly READS the number and its authorisation instead of
 * reconstructing them. This is that read.
 *
 * **`null` is a state, not an error.** A tenant that has declared no issuance
 * point numbers its invoices with Billing's own `invoice_number_sequence`
 * counter, and an invoice confirmed that way has no allocation row. The worker's
 * assembly must not need to know which path produced a number, so the read
 * reports the absence and the caller decides what it can do with a number that
 * has no timbrado behind it.
 *
 * **The identity is the row's own columns, and nothing is joined.** The timbrado
 * number, the establishment, the point of expedition and the document type are a
 * snapshot of the authorisation taken at allocation time, which is what makes
 * this read a single statement and what keeps a later change to the range from
 * rewriting what a confirmed document was issued under.
 *
 * **The formatted number is `dNumDoc`.** Seven digits, zero-padded
 * (`SIFEN-BASELINE.md` §21.3; the CDC's own composition repeats the width,
 * §22.9). The invoice's `number` is the same value as an integer and stays
 * Billing's; this read answers the EMITTED form, which is what the DE carries.
 *
 * **`tenantId` is an argument, not ambient context.** The API resolves it from
 * `RequestContextService`; the worker has no request, so the tenant travels with
 * every call and sits in the `where` clause. A foreign invoice id can therefore
 * only produce `null`, never another tenant's row.
 */

/** The allocation's identity, the series and the emitted `dNumDoc`. */
export interface InvoiceFiscalAllocation {
  /** `fiscal_timbrado_range.id`: the authorisation the number was drawn from. */
  readonly rangeId: string;
  /** `dNumTim`, `tdNumTim`: eight digits, never all zero. */
  readonly timbradoNumber: string;
  /** `D107 dEst`, `tdEst`: three digits, zero-padded. */
  readonly establishmentId: string;
  /** `C006 dPunExp`, `tdPunExp`: three digits, zero-padded. */
  readonly expeditionPoint: string;
  /** `C002 iTiDE`, `tiTiDE`: 1 is Factura electrónica. */
  readonly documentType: number;
  /**
   * `dSerieNum`, `tdSerieNum`: `[A-Z]{2}`, or `null` for the initial range —
   * which the Manual consumes for each document type before `AA` starts (§13,
   * §10.5). This is the FISCAL series, NOT the invoice's own `series`.
   */
  readonly series: string | null;
  /** `C007 dNumDoc`, `tdNumDoc`: seven digits, zero-padded, never all zero. */
  readonly documentNumber: string;
}

/** One `invoice_fiscal_allocation` row, in the columns this read maps. */
export interface InvoiceFiscalAllocationRow {
  readonly rangeId: string;
  readonly timbradoNumber: string;
  readonly establishmentId: string;
  readonly expeditionPoint: string;
  readonly documentType: number;
  readonly series: string | null;
  readonly documentNumber: string;
}

/**
 * The delegate surface, in Prisma's own terms.
 *
 * Declared structurally so the Prisma client fits by construction and a test can
 * pass a fake that records the statements. The returned shape is the columns this
 * module maps, not Prisma's full row: a full payload is assignable to it because
 * the extra columns are simply not required.
 */
export interface InvoiceAllocationReadClient {
  invoiceFiscalAllocation: {
    findFirst(
      args: Prisma.InvoiceFiscalAllocationFindFirstArgs
    ): Promise<InvoiceFiscalAllocationRow | null>;
  };
}

export function createInvoiceAllocationReader(client: InvoiceAllocationReadClient): {
  /**
   * The allocation of one invoice, or `null` when the invoice was confirmed on
   * the counter path — or does not exist, or belongs to another tenant, which
   * are deliberately indistinguishable.
   */
  read(tenantId: string, invoiceId: string): Promise<InvoiceFiscalAllocation | null>;
} {
  return {
    async read(tenantId, invoiceId) {
      // `findFirst` with BOTH columns in the `where`, never `findUnique` on the
      // invoice id alone: the tenant is part of the identity, so a foreign
      // invoice id cannot match another tenant's row. `(tenant_id, invoice_id)`
      // is unique, so this answers at most one row.
      const row = await client.invoiceFiscalAllocation.findFirst({
        where: { tenantId, invoiceId },
      });
      if (row === null) {
        return null;
      }
      return {
        rangeId: row.rangeId,
        timbradoNumber: row.timbradoNumber,
        establishmentId: row.establishmentId,
        expeditionPoint: row.expeditionPoint,
        documentType: row.documentType,
        series: row.series,
        documentNumber: row.documentNumber,
      };
    },
  };
}
