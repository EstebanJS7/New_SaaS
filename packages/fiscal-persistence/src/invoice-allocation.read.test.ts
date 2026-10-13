/**
 * FISC-015 WU-B — the read the worker's assembly consumes.
 *
 * Two things matter here and nothing else does: the tenant is in the `where`
 * (a foreign invoice id answers `null`, never another tenant's row), and the
 * counter path is reported as ABSENCE rather than as an error or a default —
 * [[DEC-056]] kept Billing's `invoice_number_sequence` for a tenant that has
 * declared no issuance point, so "no allocation" is a real state the caller has
 * to handle rather than a bug to hide.
 */

import type { Prisma, PrismaService } from "@newsaas/database";
import { describe, expect, it } from "vitest";
import {
  createInvoiceAllocationReader,
  type InvoiceAllocationReadClient,
  type InvoiceFiscalAllocationRow,
} from "./invoice-allocation.read.js";

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";
const INVOICE_A = "33333333-3333-4333-8333-333333333333";
const RANGE_A = "44444444-4444-4444-8444-444444444444";
const ESTABLISHMENT_A = "55555555-5555-4555-8555-555555555555";

/** The row as it exists: the tenant and the invoice are what the query filters on. */
interface StoredAllocation extends InvoiceFiscalAllocationRow {
  readonly tenantId: string;
  readonly invoiceId: string;
}

function allocation(overrides: Partial<StoredAllocation> = {}): StoredAllocation {
  return {
    tenantId: TENANT_A,
    invoiceId: INVOICE_A,
    rangeId: RANGE_A,
    timbradoNumber: "12345678",
    establishmentId: ESTABLISHMENT_A,
    expeditionPoint: "001",
    documentType: 1,
    series: null,
    documentNumber: "0000007",
    ...overrides,
  };
}

/** Answers from the rows it holds, applying the same filters Prisma would. */
class ScopedAllocationClient implements InvoiceAllocationReadClient {
  readonly findFirstArgs: Prisma.InvoiceFiscalAllocationFindFirstArgs[] = [];
  readonly invoiceFiscalAllocation: InvoiceAllocationReadClient["invoiceFiscalAllocation"];

  constructor(private readonly rows: readonly StoredAllocation[]) {
    this.invoiceFiscalAllocation = {
      findFirst: (args) => {
        this.findFirstArgs.push(args);
        const where = args.where ?? {};
        const found = this.rows.find(
          (row) =>
            (where.tenantId === undefined || row.tenantId === where.tenantId) &&
            (where.invoiceId === undefined || row.invoiceId === where.invoiceId)
        );
        return Promise.resolve(found ?? null);
      },
    };
  }
}

describe("createInvoiceAllocationReader", () => {
  it("fits the real Prisma client by construction", () => {
    const fits: PrismaService extends InvoiceAllocationReadClient ? true : never = true;
    expect(fits).toBe(true);
  });

  it("answers the allocation's identity and its formatted number", async () => {
    const client = new ScopedAllocationClient([
      allocation({ series: "AA", documentNumber: "0000042" }),
    ]);

    const result = await createInvoiceAllocationReader(client).read(TENANT_A, INVOICE_A);

    expect(result).toEqual({
      rangeId: RANGE_A,
      timbradoNumber: "12345678",
      establishmentId: ESTABLISHMENT_A,
      expeditionPoint: "001",
      documentType: 1,
      series: "AA",
      documentNumber: "0000042",
    });
    // Both columns are in the `where`: the tenant is part of the identity.
    expect(client.findFirstArgs[0]?.where).toEqual({
      tenantId: TENANT_A,
      invoiceId: INVOICE_A,
    });
  });

  it("keeps the seriesless initial range a real state", async () => {
    const client = new ScopedAllocationClient([allocation({ series: null })]);

    const result = await createInvoiceAllocationReader(client).read(TENANT_A, INVOICE_A);

    // NULL is the initial range, not a missing value: the DE omits `dSerieNum`
    // there and the reader must not turn it into `""` or into a default series.
    expect(result?.series).toBeNull();
  });

  it("answers null for an invoice confirmed on the counter path", async () => {
    const client = new ScopedAllocationClient([]);

    const result = await createInvoiceAllocationReader(client).read(TENANT_A, INVOICE_A);

    // DEC-056 kept the counter as the non-fiscal path, so an invoice numbered by
    // it has no row here. The absence is the answer, not an error.
    expect(result).toBeNull();
  });

  it("answers null for another tenant's invoice, indistinguishably from an absent one", async () => {
    const client = new ScopedAllocationClient([allocation({ tenantId: TENANT_B })]);

    const result = await createInvoiceAllocationReader(client).read(TENANT_A, INVOICE_A);

    expect(result).toBeNull();
    expect(client.findFirstArgs[0]?.where).toEqual({
      tenantId: TENANT_A,
      invoiceId: INVOICE_A,
    });
  });
});
