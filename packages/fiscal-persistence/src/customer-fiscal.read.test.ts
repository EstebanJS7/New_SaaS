/**
 * FISC-015 WU-C — the customer's declared fiscal operation type.
 *
 * The read is one column behind one `where`, so this suite pins the two things
 * that matter: the tenant is in that `where` (a foreign customer id answers
 * "not declared", never another tenant's row), and an undeclared customer
 * answers `null` rather than a default — DEC-057 Q2 chose the declaration over a
 * derivation.
 */

import type { Prisma, PrismaService } from "@newsaas/database";
import { describe, expect, it } from "vitest";
import {
  createCustomerFiscalReader,
  type CustomerFiscalReadClient,
  type FiscalOperationType,
} from "./customer-fiscal.read.js";

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";
const CUSTOMER_A = "33333333-3333-4333-8333-333333333333";

/** A row as it exists: the tenant and the id are what the query filters on. */
interface CustomerRow {
  readonly id: string;
  readonly tenantId: string;
  readonly fiscalOperationType: FiscalOperationType | null;
}

function customer(
  tenantId: string,
  id: string,
  fiscalOperationType: FiscalOperationType | null
): CustomerRow {
  return { id, tenantId, fiscalOperationType };
}

/** Answers from the rows it holds, applying the same filters Prisma would. */
class ScopedCustomerClient implements CustomerFiscalReadClient {
  readonly findFirstArgs: Prisma.CustomerFindFirstArgs[] = [];
  readonly customer: CustomerFiscalReadClient["customer"];

  constructor(private readonly rows: readonly CustomerRow[]) {
    this.customer = {
      findFirst: (args) => {
        this.findFirstArgs.push(args);
        const where = args.where ?? {};
        const found = this.rows.find(
          (row) =>
            (where.tenantId === undefined || row.tenantId === where.tenantId) &&
            (where.id === undefined || row.id === where.id)
        );
        return Promise.resolve(found ?? null);
      },
    };
  }
}

describe("createCustomerFiscalReader", () => {
  it("fits the real Prisma client by construction", () => {
    const fits: PrismaService extends CustomerFiscalReadClient ? true : never = true;
    expect(fits).toBe(true);
  });

  it("answers the declared operation type", async () => {
    const client = new ScopedCustomerClient([customer(TENANT_A, CUSTOMER_A, "B2G")]);

    const result = await createCustomerFiscalReader(client).readFiscalOperationType(
      TENANT_A,
      CUSTOMER_A
    );

    expect(result).toBe("B2G");
    expect(client.findFirstArgs[0]?.where).toEqual({ tenantId: TENANT_A, id: CUSTOMER_A });
  });

  it("answers each of the four declarations", async () => {
    // The four are exercised together so a reader that answered a constant, or
    // that swapped two of them, cannot pass.
    for (const declared of ["B2B", "B2C", "B2G", "B2F"] as const) {
      const client = new ScopedCustomerClient([customer(TENANT_A, CUSTOMER_A, declared)]);
      await expect(
        createCustomerFiscalReader(client).readFiscalOperationType(TENANT_A, CUSTOMER_A)
      ).resolves.toBe(declared);
    }
  });

  it("answers null when the tenant has not declared the customer's operation type", async () => {
    const client = new ScopedCustomerClient([customer(TENANT_A, CUSTOMER_A, null)]);

    const result = await createCustomerFiscalReader(client).readFiscalOperationType(
      TENANT_A,
      CUSTOMER_A
    );

    // No default is invented for any of the four (DEC-057 Q2), so absence is
    // reported as absence and issuance is the caller's refusal.
    expect(result).toBeNull();
    expect(client.findFirstArgs[0]?.where).toEqual({ tenantId: TENANT_A, id: CUSTOMER_A });
  });

  it("answers null for a customer that does not exist", async () => {
    const client = new ScopedCustomerClient([]);

    await expect(
      createCustomerFiscalReader(client).readFiscalOperationType(TENANT_A, CUSTOMER_A)
    ).resolves.toBeNull();
  });

  it("answers null for another tenant's customer, and does not distinguish it from an absent one", async () => {
    const client = new ScopedCustomerClient([customer(TENANT_B, CUSTOMER_A, "B2B")]);

    const result = await createCustomerFiscalReader(client).readFiscalOperationType(
      TENANT_A,
      CUSTOMER_A
    );

    // The tenant is in the `where`, so the foreign id cannot match; the answer
    // is the same as for a customer that does not exist, which is what keeps a
    // cross-tenant probe from learning anything.
    expect(result).toBeNull();
    expect(client.findFirstArgs[0]?.where).toEqual({ tenantId: TENANT_A, id: CUSTOMER_A });
  });
});
