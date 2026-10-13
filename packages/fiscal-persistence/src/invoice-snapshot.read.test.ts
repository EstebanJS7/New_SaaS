/**
 * FISC-015 WU-D — the confirmed invoice and its lines to the mapper's snapshot.
 *
 * The suite is written against the mapper's own contract (`dte.mapper.ts`'s
 * `ConfirmedInvoiceSnapshot` and `ConfirmedInvoiceLineSnapshot` field comments),
 * §21.4's scales, NT 013's per-item arithmetic and the tenant classification
 * WU-C models. The fake client applies the filters Prisma would, so a read that
 * forgot the tenant or the invoice would answer the wrong row here.
 */

import type { Prisma, PrismaService } from "@newsaas/database";
import type { DteReceptor } from "@newsaas/fiscal";
import { describe, expect, it } from "vitest";
import type {
  StoredIvaAffectation,
  TenantTaxClassificationRow,
} from "./tax-classification.read.js";
import {
  createInvoiceSnapshotReader,
  InvoiceSnapshotReadError,
  type InvoiceItemRow,
  type InvoiceLineSnapshotRow,
  type InvoiceRateRow,
  type InvoiceSnapshotReadClient,
  type InvoiceSnapshotRefusal,
  type InvoiceSnapshotRow,
} from "./invoice-snapshot.read.js";

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";
const INVOICE_A = "44444444-4444-4444-8444-444444444444";
const ITEM_A = "55555555-5555-4555-8555-555555555555";

const RECEPTOR: DteReceptor = {
  iNatRec: 2,
  iTiOpe: 2,
  cPaisRec: "PRY",
  dDesPaisRe: "Paraguay",
  dNomRec: "Sin Nombre",
  iTipIDRec: 5,
  dDTipIDRec: "Innominado",
  dNumIDRec: "0",
};

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

interface InvoiceRow extends InvoiceSnapshotRow {
  readonly tenantId: string;
  readonly id: string;
}

interface LineRow extends InvoiceLineSnapshotRow {
  readonly tenantId: string;
  readonly invoiceId: string;
  readonly position: number;
}

interface ItemRow extends InvoiceItemRow {
  readonly tenantId: string;
}

interface RateRow extends InvoiceRateRow {
  readonly id: string;
}

interface ClassificationRow extends TenantTaxClassificationRow {
  readonly tenantId: string;
}

function invoice(overrides: Partial<InvoiceRow> = {}): InvoiceRow {
  return {
    tenantId: TENANT_A,
    id: INVOICE_A,
    currency: "PYG",
    confirmedAt: new Date("2026-10-10T14:02:26.123Z"),
    ...overrides,
  };
}

function line(overrides: Partial<LineRow> = {}): LineRow {
  return {
    tenantId: TENANT_A,
    invoiceId: INVOICE_A,
    position: 1,
    catalogItemId: ITEM_A,
    description: "Consulta veterinaria",
    rateCode: "EXEMPT",
    quantity: decimal("1.000"),
    unitPrice: decimal("100.00"),
    lineTotal: decimal("100.00"),
    taxableBase: decimal("100.00"),
    taxAmount: decimal("0.00"),
    ...overrides,
  };
}

function item(overrides: Partial<ItemRow> = {}): ItemRow {
  return { tenantId: TENANT_A, id: ITEM_A, unitOfMeasureCode: "77", ...overrides };
}

function rate(code: string, value: string): RateRow {
  return { id: `rate-${code}`, code, rate: decimal(value) };
}

function classification(
  rateCode: string,
  affectation: StoredIvaAffectation,
  proportionality: string | null = null
): ClassificationRow {
  return {
    tenantId: TENANT_A,
    rateCode,
    affectation,
    proportionality: proportionality === null ? null : decimal(proportionality),
  };
}

class ScopedInvoiceClient implements InvoiceSnapshotReadClient {
  readonly invoiceArgs: Prisma.InvoiceFindFirstArgs[] = [];
  readonly lineArgs: Prisma.InvoiceLineFindManyArgs[] = [];
  readonly itemArgs: Prisma.CatalogItemFindManyArgs[] = [];
  readonly rateArgs: Prisma.TaxRateFindManyArgs[] = [];
  readonly classificationArgs: Prisma.TenantTaxClassificationFindManyArgs[] = [];
  readonly invoice: InvoiceSnapshotReadClient["invoice"];
  readonly invoiceLine: InvoiceSnapshotReadClient["invoiceLine"];
  readonly catalogItem: InvoiceSnapshotReadClient["catalogItem"];
  readonly taxRate: InvoiceSnapshotReadClient["taxRate"];
  readonly tenantTaxClassification: InvoiceSnapshotReadClient["tenantTaxClassification"];

  constructor(
    private readonly invoices: readonly InvoiceRow[],
    private readonly lines: readonly LineRow[],
    private readonly items: readonly ItemRow[],
    private readonly rates: readonly RateRow[],
    private readonly classifications: readonly ClassificationRow[] = []
  ) {
    this.invoice = {
      findFirst: (args) => {
        this.invoiceArgs.push(args);
        const where = args.where ?? {};
        return Promise.resolve(
          this.invoices.find(
            (row) =>
              (where.tenantId === undefined || row.tenantId === where.tenantId) &&
              (where.id === undefined || row.id === where.id)
          ) ?? null
        );
      },
    };
    this.invoiceLine = {
      findMany: (args) => {
        this.lineArgs.push(args);
        const where = args.where ?? {};
        const found = this.lines.filter(
          (row) =>
            (where.tenantId === undefined || row.tenantId === where.tenantId) &&
            (where.invoiceId === undefined || row.invoiceId === where.invoiceId)
        );
        return Promise.resolve([...found].sort((left, right) => left.position - right.position));
      },
    };
    this.catalogItem = {
      findMany: (args) => {
        this.itemArgs.push(args);
        const where = args.where ?? {};
        const filter = where.id;
        const ids: readonly string[] =
          typeof filter === "object" && filter !== null && Array.isArray(filter.in)
            ? filter.in
            : [];
        return Promise.resolve(
          this.items.filter(
            (row) =>
              (where.tenantId === undefined || row.tenantId === where.tenantId) &&
              ids.includes(row.id)
          )
        );
      },
    };
    this.taxRate = {
      findMany: (args) => {
        this.rateArgs.push(args);
        const where = args.where ?? {};
        const filter = where.code;
        const codes: readonly string[] =
          typeof filter === "object" && filter !== null && Array.isArray(filter.in)
            ? filter.in
            : [];
        // `tax_rate` is GLOBAL: no tenant filter, by design.
        return Promise.resolve(this.rates.filter((row) => codes.includes(row.code)));
      },
    };
    this.tenantTaxClassification = {
      findFirst: () => Promise.resolve(null),
      findMany: (args) => {
        this.classificationArgs.push(args);
        const where = args.where ?? {};
        const filter = where.rateCode;
        const codes: readonly string[] =
          typeof filter === "object" && filter !== null && Array.isArray(filter.in)
            ? filter.in
            : [];
        return Promise.resolve(
          this.classifications.filter(
            (row) =>
              (where.tenantId === undefined || row.tenantId === where.tenantId) &&
              codes.includes(row.rateCode)
          )
        );
      },
    };
  }
}

function readFrom(
  invoices: readonly InvoiceRow[],
  lines: readonly LineRow[],
  classifications: readonly ClassificationRow[] = [],
  items: readonly ItemRow[] = [item()],
  // `tax_rate` is platform-seeded and GLOBAL, so the three rows below stand in
  // for the seeded ones; a case that needs another code passes its own list.
  rates: readonly RateRow[] = [
    rate("EXEMPT", "0.00"),
    rate("IVA_5", "5.00"),
    rate("IVA_10", "10.00"),
  ]
) {
  const client = new ScopedInvoiceClient(invoices, lines, items, rates, classifications);
  return {
    client,
    read: (overrides: { tenantId?: string; invoiceId?: string } = {}) =>
      createInvoiceSnapshotReader(client).readInvoiceSnapshot({
        tenantId: overrides.tenantId ?? TENANT_A,
        invoiceId: overrides.invoiceId ?? INVOICE_A,
        receptor: RECEPTOR,
      }),
  };
}

async function refusalOf(answer: Promise<unknown>): Promise<InvoiceSnapshotRefusal> {
  try {
    await answer;
  } catch (error) {
    if (error instanceof InvoiceSnapshotReadError) {
      return error.refusal;
    }
    throw error;
  }
  throw new Error("expected the call to refuse");
}

describe("createInvoiceSnapshotReader", () => {
  it("fits the real Prisma client by construction", () => {
    const fits: PrismaService extends InvoiceSnapshotReadClient ? true : never = true;
    expect(fits).toBe(true);
  });

  it("maps a confirmed PYG invoice and its lines to the mapper's snapshot", async () => {
    const { read } = readFrom([invoice()], [line()], [classification("EXEMPT", "EXENTO")]);

    await expect(read()).resolves.toEqual({
      // `dFeEmiDE` is `fecHhmmss`: no timezone suffix and no fractional seconds,
      // taken from the instant `confirmed_at` stores.
      issuedAt: "2026-10-10T14:02:26",
      currency: "PYG",
      // `dDesMoneOpe` from Monedas_v150.xsd, never a caller's default.
      currencyDescription: "Guarani",
      receptor: RECEPTOR,
      lines: [
        {
          // `dCodInt`: the catalog item's own identity. `CatalogItem` has NO code
          // column (see the case below), so the item's `id` is what the DE
          // carries — 36 characters, inside `tdCodInt`'s 1..50.
          itemCode: ITEM_A,
          description: "Consulta veterinaria",
          unitOfMeasureCode: "77",
          unitOfMeasureDescription: "UNI",
          quantity: "1.000",
          unitPrice: "100.00",
          lineTotal: "100.00",
          taxableBase: "100.00",
          taxAmount: "0.00",
          affectation: 3,
          ivaRate: 0,
          // `E733` is NULL for the three non-partial affectations by WU-C's own
          // CHECK, and the mapper's documented default (full proportionality) is
          // what the DE then carries.
          proportionality: undefined,
          // NT 013: `E737` is 0 for E731 = 1, 2 and 3.
          exemptBase: "0",
        },
      ],
    });
  });

  it("reads the nine money and quantity columns at their own scales", async () => {
    const quantity = decimal("2.500");
    const unitPrice = decimal("100.00");
    const { read } = readFrom(
      [invoice()],
      [line({ quantity, unitPrice, rateCode: "IVA_5" })],
      [classification("IVA_5", "GRAVADO_IVA")],
      [item()],
      [rate("IVA_5", "5.00")]
    );

    const snapshot = await read();

    // `invoice_line`'s columns: money is Decimal(14,2), quantity Decimal(10,3).
    // The mapper pads to 8; it never rounds, so the read asks for the column's
    // own scale and lets the mapper do the one formatting step it owns.
    expect(snapshot?.lines[0]?.quantity).toBe("2.500");
    expect(snapshot?.lines[0]?.unitPrice).toBe("100.00");
    expect(quantity.scales).toEqual([3]);
    expect(unitPrice.scales).toEqual([2]);
  });

  it("scopes both statements to the tenant and the invoice, in position order", async () => {
    const { client, read } = readFrom([invoice()], [line()], [classification("EXEMPT", "EXENTO")]);

    await read();

    expect(client.invoiceArgs[0]?.where).toEqual({ tenantId: TENANT_A, id: INVOICE_A });
    expect(client.lineArgs[0]?.where).toEqual({ tenantId: TENANT_A, invoiceId: INVOICE_A });
    // `position` is the invoice-local reading order, unique per invoice.
    expect(client.lineArgs[0]?.orderBy).toEqual({ position: "asc" });
    expect(client.classificationArgs[0]?.where).toEqual({
      tenantId: TENANT_A,
      rateCode: { in: ["EXEMPT"] },
    });
  });

  it("keeps the lines in the order the document must carry them", async () => {
    const { client, read } = readFrom(
      [invoice()],
      [
        line({ position: 2, description: "Segunda", rateCode: "IVA_5" }),
        line({ position: 1, description: "Primera" }),
      ],
      [classification("EXEMPT", "EXENTO"), classification("IVA_5", "GRAVADO_IVA")]
    );

    const snapshot = await read();

    expect(snapshot?.lines.map((entry) => entry.description)).toEqual(["Primera", "Segunda"]);
    expect(client.lineArgs).toHaveLength(1);
  });

  it("answers null for an invoice this tenant does not have", async () => {
    const foreign = invoice({ tenantId: TENANT_B });
    const { read } = readFrom([foreign], [line({ tenantId: TENANT_B, invoiceId: INVOICE_A })]);

    // Absence is a state, not an error: an unknown id and another tenant's id are
    // deliberately indistinguishable, and the tenant is in the `where`.
    await expect(read()).resolves.toBeNull();
    await expect(read({ invoiceId: "99999999-9999-4999-8999-999999999999" })).resolves.toBeNull();
  });

  it("refuses an invoice that is not confirmed", async () => {
    // `issuedAt` is `D002 dFeEmiDE` and comes from `confirmed_at`, which the
    // migration ties to the number: a DRAFT has neither.
    await expect(refusalOf(readFrom([invoice({ confirmedAt: null })], []).read())).resolves.toBe(
      "INVOICE_NOT_CONFIRMED"
    );
  });

  it("refuses a line whose rate code the tenant has not classified", async () => {
    const { read } = readFrom([invoice()], [line({ rateCode: "IVA_10" })]);

    // DEC-057 Q1: the classification is the tenant's declaration, and a rate code
    // without one is not a document with a guessed treatment.
    await expect(refusalOf(read())).resolves.toBe("RATE_NOT_CLASSIFIED");
  });

  it("refuses the innominado's exempt base when NT 013's formula does not divide exactly", async () => {
    // NT 013, E737: [100 * EA008 * (100 - E733)] / [10000 + (E734 * E733)]. With
    // E733 = 100 (the partial affectation at full proportionality) the numerator
    // is 0; with E733 = 0 it is EA008. Both divide exactly, and both are pinned.
    const full = readFrom(
      [invoice()],
      [line({ rateCode: "IVA_10" })],
      [classification("IVA_10", "GRAVADO_PARCIAL", "100.00")],
      [item()],
      [rate("IVA_10", "10.00")]
    );
    await expect(full.read()).resolves.toMatchObject({
      lines: [{ affectation: 4, ivaRate: 10, proportionality: "100.00", exemptBase: "0.00000000" }],
    });

    const zero = readFrom(
      [invoice()],
      [line({ rateCode: "IVA_10" })],
      [classification("IVA_10", "GRAVADO_PARCIAL", "0.00")],
      [item()],
      [rate("IVA_10", "10.00")]
    );
    await expect(zero.read()).resolves.toMatchObject({
      lines: [{ exemptBase: "100.00000000" }],
    });

    // A partial proportionality gives [100 * 100 * 50] / [10000 + 10 * 50] =
    // 47.6190476190... and `tMontoBase` carries 8 fraction digits with no
    // rounding rule stated anywhere: the read refuses rather than choosing one.
    const partial = readFrom(
      [invoice()],
      [line({ rateCode: "IVA_10" })],
      [classification("IVA_10", "GRAVADO_PARCIAL", "50.00")],
      [item()],
      [rate("IVA_10", "10.00")]
    );
    await expect(refusalOf(partial.read())).resolves.toBe("EXEMPT_BASE_UNAVAILABLE");
  });

  it("refuses an IVA rate the DE cannot carry", async () => {
    const { read } = readFrom(
      [invoice()],
      [line({ rateCode: "IVA_7" })],
      [classification("IVA_7", "GRAVADO_IVA")],
      [item()],
      [rate("IVA_7", "7.00")]
    );

    // `dTasaIVA` is a two-digit integer and the protocol's rates are 0, 5 and 10
    // (NT 013's formulas are keyed on 5 and 10).
    await expect(refusalOf(read())).resolves.toBe("INVALID_IVA_RATE");
  });

  it("refuses a line whose catalog item cannot be read", async () => {
    // `invoice_line.catalog_item_id` is a composite tenant-ownership FK, so the
    // row exists; a client that cannot see it is a defect this read names rather
    // than emitting an item with no identity or no unit.
    await expect(
      refusalOf(readFrom([invoice()], [line()], [classification("EXEMPT", "EXENTO")], []).read())
    ).resolves.toBe("ITEM_NOT_READABLE");
  });

  it("refuses an item that declares no unit of measure", async () => {
    const { read } = readFrom(
      [invoice()],
      [line()],
      [classification("EXEMPT", "EXENTO")],
      [item({ unitOfMeasureCode: null })]
    );

    // WU-C's column is nullable on purpose: WHICH unit an item is, is tenant
    // data, and the assembly refuses rather than guessing one (DEC-057).
    await expect(refusalOf(read())).resolves.toBe("ITEM_UNIT_NOT_DECLARED");
  });

  it("refuses a unit code the artifact does not publish", async () => {
    const { read } = readFrom(
      [invoice()],
      [line()],
      [classification("EXEMPT", "EXENTO")],
      [item({ unitOfMeasureCode: "9999" })]
    );

    await expect(refusalOf(read())).resolves.toBe("UNKNOWN_UNIT_OF_MEASURE");
  });

  it("refuses a currency the artifact does not publish, or one dDesMoneOpe cannot carry", async () => {
    const unknown = readFrom([invoice({ currency: "ZZZ" })], [line()]);
    await expect(refusalOf(unknown.read())).resolves.toBe("INVALID_CURRENCY");

    // `ANG` is published as "Netherlands Antillian Guilder", 28 characters, and
    // `dDesMoneOpe`'s type is `tdDMoneTiPag` (3..20).
    const tooLong = readFrom([invoice({ currency: "ANG" })], [line()]);
    await expect(refusalOf(tooLong.read())).resolves.toBe("INVALID_CURRENCY");
  });

  it("reports its own refusal type, not the catalogue's", async () => {
    const { read } = readFrom([invoice({ currency: "ZZZ" })], [line()]);

    try {
      await read();
      throw new Error("expected the call to refuse");
    } catch (error) {
      expect(error).toBeInstanceOf(InvoiceSnapshotReadError);
      expect((error as InvoiceSnapshotReadError).refusal).toBe("INVALID_CURRENCY");
      // The table's own message is carried through, so a reader sees which code
      // was refused and how many the artifact publishes.
      expect((error as Error).message).toContain("ZZZ");
    }
  });
});
