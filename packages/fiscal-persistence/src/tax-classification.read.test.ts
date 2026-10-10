/**
 * FISC-015 WU-C — the tenant's classification of a rate code.
 *
 * The adapter's content is the SHAPE of its statements and the mapping of each
 * column, so that is what this suite asserts: the tenant is in every `where`, a
 * declaration becomes the protocol's `iAfecIVA` code, the proportionality becomes
 * a decimal string, and a code the tenant has not classified is absent from the
 * answer rather than defaulted. The fake client records what it was asked to do
 * and answers from rows that carry extra columns, so a mapping that passed
 * Prisma's row through untouched would fail here.
 */

import type { Prisma, PrismaService } from "@newsaas/database";
import { describe, expect, it } from "vitest";
import {
  createTaxClassificationReader,
  type StoredIvaAffectation,
  type TaxClassificationReadClient,
  type TenantTaxClassificationRow,
} from "./tax-classification.read.js";

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";

/** A Prisma-like `Decimal`: it records the scale it was asked for. */
interface DecimalDouble {
  readonly scales: number[];
  toFixed(digits: number): string;
}

function decimal(value: string): DecimalDouble {
  const scales: number[] = [];
  return {
    scales,
    toFixed(digits: number): string {
      scales.push(digits);
      return value;
    },
  };
}

/** A row as it exists: tenant and id are what the query filters on. */
interface ClassificationRow extends TenantTaxClassificationRow {
  readonly tenantId: string;
}

function classification(
  tenantId: string,
  rateCode: string,
  affectation: StoredIvaAffectation,
  proportionality: DecimalDouble | null = null
): ClassificationRow {
  return { tenantId, rateCode, affectation, proportionality };
}

/** Answers from the rows it holds, applying the same filters Prisma would. */
class ScopedClassificationClient implements TaxClassificationReadClient {
  readonly findFirstArgs: Prisma.TenantTaxClassificationFindFirstArgs[] = [];
  readonly findManyArgs: Prisma.TenantTaxClassificationFindManyArgs[] = [];
  readonly tenantTaxClassification: TaxClassificationReadClient["tenantTaxClassification"];

  constructor(private readonly rows: readonly ClassificationRow[]) {
    this.tenantTaxClassification = {
      findFirst: (args) => {
        this.findFirstArgs.push(args);
        const where = args.where ?? {};
        const found = this.rows.find(
          (row) =>
            (where.tenantId === undefined || row.tenantId === where.tenantId) &&
            (where.rateCode === undefined || row.rateCode === where.rateCode)
        );
        return Promise.resolve(found ?? null);
      },
      findMany: (args) => {
        this.findManyArgs.push(args);
        const where = args.where ?? {};
        const rateCodeFilter = where.rateCode;
        const codes: readonly string[] =
          typeof rateCodeFilter === "object" &&
          rateCodeFilter !== null &&
          Array.isArray(rateCodeFilter.in)
            ? rateCodeFilter.in
            : [];
        const found = this.rows.filter(
          (row) =>
            (where.tenantId === undefined || row.tenantId === where.tenantId) &&
            codes.includes(row.rateCode)
        );
        const ordered = [...found].sort((left, right) =>
          left.rateCode.localeCompare(right.rateCode)
        );
        return Promise.resolve(ordered);
      },
    };
  }
}

describe("createTaxClassificationReader", () => {
  it("fits the real Prisma client by construction", () => {
    // Compile-time: the client is declared with Prisma's own argument types, so
    // `PrismaService` is assignable without a cast. A Prisma upgrade that stops
    // matching breaks HERE rather than in the composition root.
    const fits: PrismaService extends TaxClassificationReadClient ? true : never = true;
    expect(fits).toBe(true);
  });

  it("answers each declaration as the protocol's own iAfecIVA code", async () => {
    const client = new ScopedClassificationClient([
      classification(TENANT_A, "EXEMPT", "EXENTO"),
      classification(TENANT_A, "IVA_5", "GRAVADO_IVA"),
      classification(TENANT_A, "IVA_10", "GRAVADO_PARCIAL", decimal("50.00")),
    ]);
    const reader = createTaxClassificationReader(client);

    // §21.5: 1 Gravado IVA, 2 Exonerado, 3 Exento, 4 Gravado parcial. The four
    // declarations are exercised together so a swap between two of them cannot
    // pass unnoticed.
    await expect(reader.readClassification(TENANT_A, "EXEMPT")).resolves.toEqual({
      rateCode: "EXEMPT",
      affectation: 3,
      proportionality: null,
    });
    await expect(reader.readClassification(TENANT_A, "IVA_5")).resolves.toEqual({
      rateCode: "IVA_5",
      affectation: 1,
      proportionality: null,
    });
    await expect(reader.readClassification(TENANT_A, "IVA_10")).resolves.toEqual({
      rateCode: "IVA_10",
      affectation: 4,
      proportionality: "50.00",
    });
  });

  it("covers the two affectations the other cases do not reach", async () => {
    const client = new ScopedClassificationClient([
      classification(TENANT_A, "EXEMPT", "EXONERADO"),
      classification(TENANT_A, "IVA_5", "GRAVADO_PARCIAL", decimal("25.50")),
    ]);
    const reader = createTaxClassificationReader(client);

    expect((await reader.readClassification(TENANT_A, "EXEMPT"))?.affectation).toBe(2);
    expect(await reader.readClassification(TENANT_A, "IVA_5")).toEqual({
      rateCode: "IVA_5",
      affectation: 4,
      proportionality: "25.50",
    });
  });

  it("formats the proportionality at the column's own scale", async () => {
    const proportionality = decimal("50.00");
    const client = new ScopedClassificationClient([
      classification(TENANT_A, "IVA_10", "GRAVADO_PARCIAL", proportionality),
    ]);

    await createTaxClassificationReader(client).readClassification(TENANT_A, "IVA_10");

    // `proportionality` is DECIMAL(5,2); the reader asks for that scale rather
    // than echoing the object, so the assembly gets a plain decimal string.
    expect(proportionality.scales).toEqual([2]);
  });

  it("scopes the read to the tenant and the rate code", async () => {
    const client = new ScopedClassificationClient([
      classification(TENANT_A, "IVA_5", "GRAVADO_IVA"),
    ]);

    await createTaxClassificationReader(client).readClassification(TENANT_A, "IVA_5");

    expect(client.findFirstArgs[0]?.where).toEqual({ tenantId: TENANT_A, rateCode: "IVA_5" });
  });

  it("returns null for a rate code the tenant has not classified", async () => {
    const client = new ScopedClassificationClient([
      classification(TENANT_A, "IVA_5", "GRAVADO_IVA"),
    ]);

    const result = await createTaxClassificationReader(client).readClassification(
      TENANT_A,
      "EXEMPT"
    );

    // No default, no inference from the rate: DEC-057 Q1 made the declaration
    // the only source, and absence means the caller must refuse.
    expect(result).toBeNull();
    expect(client.findFirstArgs[0]?.where).toEqual({ tenantId: TENANT_A, rateCode: "EXEMPT" });
  });

  it("does not answer another tenant's declaration", async () => {
    const client = new ScopedClassificationClient([
      classification(TENANT_B, "IVA_5", "GRAVADO_IVA"),
    ]);

    const result = await createTaxClassificationReader(client).readClassification(
      TENANT_A,
      "IVA_5"
    );

    expect(result).toBeNull();
    expect(client.findFirstArgs[0]?.where).toMatchObject({ tenantId: TENANT_A });
  });

  it("reads a batch in one statement, scoped to the tenant and the code set", async () => {
    const client = new ScopedClassificationClient([
      classification(TENANT_A, "EXEMPT", "EXENTO"),
      classification(TENANT_A, "IVA_5", "GRAVADO_IVA"),
      classification(TENANT_A, "IVA_10", "GRAVADO_PARCIAL", decimal("50.00")),
      classification(TENANT_B, "IVA_10", "EXENTO"),
    ]);

    const result = await createTaxClassificationReader(client).readClassifications(TENANT_A, [
      "IVA_10",
      "IVA_5",
    ]);

    // `orderBy: { rateCode: "asc" }` is the database's collation order, so
    // `IVA_10` precedes `IVA_5` — the answer is deterministic, not sorted by a
    // numeric suffix nobody declared.
    expect(result).toEqual([
      { rateCode: "IVA_10", affectation: 4, proportionality: "50.00" },
      { rateCode: "IVA_5", affectation: 1, proportionality: null },
    ]);
    expect(client.findManyArgs).toHaveLength(1);
    expect(client.findManyArgs[0]?.where).toEqual({
      tenantId: TENANT_A,
      rateCode: { in: ["IVA_10", "IVA_5"] },
    });
    expect(client.findManyArgs[0]?.orderBy).toEqual({ rateCode: "asc" });
  });

  it("answers a batch with only the declared codes, leaving the rest absent", async () => {
    const client = new ScopedClassificationClient([
      classification(TENANT_A, "IVA_5", "GRAVADO_IVA"),
    ]);

    const result = await createTaxClassificationReader(client).readClassifications(TENANT_A, [
      "EXEMPT",
      "IVA_5",
      "IVA_10",
    ]);

    // The requested-but-undeclared codes are the caller's to detect: an answer
    // that carried a placeholder would be a default, which DEC-057 forbids.
    expect(result.map((entry) => entry.rateCode)).toEqual(["IVA_5"]);
  });

  it("answers an empty batch without asking the database", async () => {
    const client = new ScopedClassificationClient([]);

    const result = await createTaxClassificationReader(client).readClassifications(TENANT_A, []);

    expect(result).toEqual([]);
    expect(client.findManyArgs).toEqual([]);
  });
});
