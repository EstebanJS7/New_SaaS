import type { Prisma } from "@newsaas/database";

/**
 * FISC-015 WU-C — the customer's declared fiscal operation type.
 *
 * [[DEC-057]] Q2 decided that the receptor is **derived where the sources pin it
 * and declared where they do not**: `iTiOpe` (`D202`) is the one the code cannot
 * derive, because `B2G` depends on the DNIT's own registry of state entities and
 * `B2B`/`B2C`/`B2F` on facts only the tenant knows. This is the read of that
 * declaration.
 *
 * **The declaration is answered as the name the tenant chose, not as a numeric
 * code.** The vault's record of `iTiOpe`'s code-to-name pairing is NOT
 * consistent — SIFEN-BASELINE.md §22.3 reads `D202 = 4` as B2C while NT 010's
 * validation `D202`/`1300` reads `4` as B2F and `2` as B2C — so resolving it
 * here would freeze one of two conflicting readings into a reader. The
 * assembly resolves the code from a source that decides it; this read reports
 * what the tenant declared.
 *
 * **`tenantId` is an argument, not ambient context.** A customer of another
 * tenant and a customer that does not exist both answer `null`, and that is the
 * point: a cross-tenant id must be indistinguishable from an absent one, and a
 * customer whose declaration is absent is not issuable either way.
 *
 * **Absence is a state, not an error.** `null` means "not declared" — [[DEC-057]]
 * invented no default for any of the four values — and the caller refuses.
 */

/** `iTiOpe`'s four names, as `customer.fiscal_operation_type` stores them. */
export type FiscalOperationType = "B2B" | "B2C" | "B2G" | "B2F";

/** One `customer` row, in the column this read needs. */
export interface CustomerFiscalRow {
  readonly fiscalOperationType: FiscalOperationType | null;
}

/**
 * The delegate surface, in Prisma's own terms.
 *
 * Declared structurally so the Prisma client fits by construction and a test can
 * pass a fake that records the statements.
 */
export interface CustomerFiscalReadClient {
  customer: {
    findFirst(args: Prisma.CustomerFindFirstArgs): Promise<CustomerFiscalRow | null>;
  };
}

export function createCustomerFiscalReader(client: CustomerFiscalReadClient): {
  /** The customer's declared `iTiOpe`, or `null` when it is not declared. */
  readFiscalOperationType(
    tenantId: string,
    customerId: string
  ): Promise<FiscalOperationType | null>;
} {
  return {
    async readFiscalOperationType(tenantId, customerId) {
      // `findFirst` with both columns in the `where`, never `findUnique` on the
      // id alone: the tenant is part of the identity, so a foreign customer id
      // cannot match another tenant's row.
      const row = await client.customer.findFirst({ where: { tenantId, id: customerId } });
      return row?.fiscalOperationType ?? null;
    },
  };
}
