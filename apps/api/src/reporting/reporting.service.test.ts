import { describe, expect, it } from "vitest";
import { Prisma } from "@newsaas/database";
import type { PermissionResolver } from "../rbac/permission-resolver.service.js";
import type { RequestContextService } from "../context/request-context.service.js";
import type { TenantSettingsService } from "../settings/tenant-settings.service.js";
import { REPORTING_PERMISSIONS } from "./reporting.permissions.js";
import {
  REPORT_ROW_LIMIT_EXCEEDED_MESSAGE,
  REPORT_SALE_ROW_LIMIT,
  ReportRepository,
  type ReportingReadPrisma,
  type ReportCatalogItemRow,
  type ReportSaleRow,
  type ReportSaleWithPaymentsRow,
} from "./reporting.repository.js";
import {
  REPORT_READ_FORBIDDEN_MESSAGE,
  ReportingService,
  reportCatalogItemMissingMessage,
} from "./reporting.service.js";

/**
 * The reporting service ([[REP-002]], [[REP-003]]). Every assertion is on VALUES
 * and on the ARGUMENTS the service passed to Prisma: the stub delegate returns
 * exactly the rows it is given, so an end-to-end assertion would pass whatever
 * range the service asked for.
 */

const TENANT = "11111111-1111-4111-8111-111111111111";

/** Asunción is `-03`, so 2026-06-10 00:00 local is 2026-06-10T03:00:00Z. */
const FROM_INSTANT = "2026-06-10T03:00:00.000Z";
const TO_INSTANT = "2026-06-11T03:00:00.000Z";

/** Catalog item identities the by-product fixtures reference. */
const ITEM_PRODUCT = "22222222-2222-4222-8222-222222222222";
const ITEM_SERVICE = "33333333-3333-4333-8333-333333333333";
const ITEM_MEDICATION = "44444444-4444-4444-8444-444444444444";

interface Harness {
  service: ReportingService;
  /** Every `sale.findMany` arg the repository built, in call order. */
  saleQueries: Prisma.SaleFindManyArgs[];
  /** Every `catalogItem.findMany` arg the repository built, in call order. */
  catalogQueries: Prisma.CatalogItemFindManyArgs[];
}

/** One seeded line. Identity and quantity default to values REP-002 never reads. */
interface SaleLineFixture {
  readonly lineTotal: string;
  readonly taxableBase: string;
  readonly taxAmount: string;
  readonly catalogItemId?: string;
  readonly quantity?: string;
}

function sale(completedAt: Date | null, lines: readonly SaleLineFixture[]): ReportSaleRow {
  return {
    id: `sale-${Math.random().toString(16).slice(2)}`,
    currency: "PYG",
    completedAt,
    lines: lines.map((line) => ({
      catalogItemId: line.catalogItemId ?? "item-not-read",
      quantity: line.quantity ?? "1.000",
      lineTotal: line.lineTotal,
      taxableBase: line.taxableBase,
      taxAmount: line.taxAmount,
    })),
  };
}

/** One completed sale as the PAYMENTS read returns it — no lines, by design. */
function paidSale(
  completedAt: Date | null,
  payments: readonly { method: string; amount: string }[]
): ReportSaleWithPaymentsRow {
  return {
    id: `sale-${Math.random().toString(16).slice(2)}`,
    currency: "PYG",
    completedAt,
    payments,
  };
}

/**
 * Builds the real repository (so the cap and the query shape under test are the
 * shipped ones) over a stub delegate, with a stub permission resolver and a
 * pinned clock.
 *
 * The ONE `sale.findMany` serves both reports, so the stub answers the relation
 * the query asked to `include` — lines by default, payments when requested —
 * exactly as Prisma would.
 */
function harness(
  options: {
    rows?: ReportSaleRow[];
    paymentRows?: ReportSaleWithPaymentsRow[];
    catalogItems?: ReportCatalogItemRow[];
    permissions?: readonly string[];
    now?: Date;
    currency?: unknown;
  } = {}
): Harness {
  const saleQueries: Prisma.SaleFindManyArgs[] = [];
  const catalogQueries: Prisma.CatalogItemFindManyArgs[] = [];
  const prisma: ReportingReadPrisma = {
    sale: {
      findMany: (args) => {
        saleQueries.push(args);
        const include = args.include;
        const wantsPayments = include !== undefined && include !== null && "payments" in include;
        return Promise.resolve(wantsPayments ? (options.paymentRows ?? []) : (options.rows ?? []));
      },
    },
    catalogItem: {
      findMany: (args) => {
        catalogQueries.push(args);
        return Promise.resolve(options.catalogItems ?? []);
      },
      // The low-stock existence probe belongs to REP-005 and is not exercised by
      // this suite: it THROWS rather than answering `false`, so a REP-002/REP-003
      // case that reached it would fail loudly instead of silently reporting
      // "nobody configured anything".
      findFirst: () => {
        throw new Error("This suite must not run the low-stock threshold probe.");
      },
    },
    // REP-004's reads are not exercised by this suite: they THROW rather than
    // answer `[]`, so a REP-002/REP-003 case that reached one would fail loudly
    // instead of quietly aggregating an empty set. Their own suite supplies them.
    cashSession: {
      findMany: () => {
        throw new Error("REP-002/REP-003 must not read cash sessions.");
      },
    },
    cashMovement: {
      findMany: () => {
        throw new Error("REP-002/REP-003 must not read cash movements.");
      },
    },
    purchase: {
      findMany: () => {
        throw new Error("REP-002/REP-003 must not read purchases.");
      },
    },
    supplier: {
      findMany: () => {
        throw new Error("REP-002/REP-003 must not read suppliers.");
      },
    },
    // REP-005's inventory reads are supplied by their own suite, for the same
    // reason as REP-004's: they THROW here so a case that reached one fails loudly.
    stockBalance: {
      findMany: () => {
        throw new Error("REP-002/REP-003 must not read stock balances.");
      },
    },
    stockMovement: {
      findMany: () => {
        throw new Error("REP-002/REP-003 must not read stock movements.");
      },
    },
  };
  const requestContext = {
    requireTenantId: () => TENANT,
  } as unknown as RequestContextService;
  const permissionResolver = {
    resolveForActiveRequest: () => Promise.resolve(new Set(options.permissions ?? [])),
  } as unknown as PermissionResolver;
  const settings = {
    get: () => Promise.resolve({ defaultCurrency: options.currency ?? "PYG" }),
  } as unknown as TenantSettingsService;
  const repository = new ReportRepository(prisma, requestContext);
  const now = options.now ?? new Date("2026-06-10T12:00:00.000Z");
  const service = new ReportingService(repository, settings, permissionResolver, () => now);
  return { service, saleQueries, catalogQueries };
}

const READ_PERMISSION = [REPORTING_PERMISSIONS.read];

describe("ReportingService · Decimal summation ([[DEC-022]])", () => {
  it("sums exact decimals and emits fixed-scale strings, never floats", async () => {
    // 0.10 + 0.20 is 0.30000000000000004 as IEEE-754 doubles. The report must
    // answer "0.30", which a float accumulator cannot promise.
    const { service } = harness({
      permissions: READ_PERMISSION,
      rows: [
        sale(new Date("2026-06-10T12:00:00.000Z"), [
          { lineTotal: "0.10", taxableBase: "0.10", taxAmount: "0.00" },
        ]),
        sale(new Date("2026-06-10T13:00:00.000Z"), [
          { lineTotal: "0.20", taxableBase: "0.20", taxAmount: "0.00" },
        ]),
      ],
    });

    const response = await service.salesByPeriod({ from: "2026-06-10", to: "2026-06-10" });

    expect(response.totalGross).toBe("0.30");
    expect(response.totalNet).toBe("0.30");
    expect(response.totalTax).toBe("0.00");
    expect(response.rows).toEqual([
      { bucketDate: "2026-06-10", saleCount: 2, net: "0.30", tax: "0.00", gross: "0.30" },
    ]);
    expect((0.1 + 0.2).toFixed(2)).toBe("0.30");
    expect(String(0.1 + 0.2)).not.toBe("0.3");
  });

  it("sums a sale's several lines into the same day bucket", async () => {
    const { service } = harness({
      permissions: READ_PERMISSION,
      rows: [
        sale(new Date("2026-06-10T12:00:00.000Z"), [
          { lineTotal: "110.00", taxableBase: "100.00", taxAmount: "10.00" },
          { lineTotal: "55.00", taxableBase: "50.00", taxAmount: "5.00" },
        ]),
      ],
    });

    const response = await service.salesByPeriod({ from: "2026-06-10", to: "2026-06-10" });

    expect(response.saleCount).toBe(1);
    expect(response.totalNet).toBe("150.00");
    expect(response.totalTax).toBe("15.00");
    expect(response.totalGross).toBe("165.00");
    expect(response.rows[0]).toEqual({
      bucketDate: "2026-06-10",
      saleCount: 1,
      net: "150.00",
      tax: "15.00",
      gross: "165.00",
    });
  });
});

describe("ReportingService · the tenant's day ([[DEC-063]])", () => {
  it("buckets a sale by its LOCAL day, not its UTC day", async () => {
    // 2026-06-11T02:00Z is 2026-06-10T23:00 in Asunción (-03): the sale belongs to
    // the 10th locally and to the 11th in UTC. A UTC bucketer answers "2026-06-11".
    const localLateSale = new Date("2026-06-11T02:00:00.000Z");
    expect(localLateSale.toISOString().slice(0, 10)).toBe("2026-06-11");

    const { service } = harness({
      permissions: READ_PERMISSION,
      rows: [
        sale(localLateSale, [{ lineTotal: "10.00", taxableBase: "10.00", taxAmount: "0.00" }]),
      ],
    });

    const response = await service.salesByPeriod({ from: "2026-06-10", to: "2026-06-10" });

    expect(response.rows).toEqual([
      { bucketDate: "2026-06-10", saleCount: 1, net: "10.00", tax: "0.00", gross: "10.00" },
    ]);
  });

  it("keeps each local day in its own bucket, ascending", async () => {
    const { service } = harness({
      permissions: READ_PERMISSION,
      rows: [
        sale(new Date("2026-06-10T12:00:00.000Z"), [
          { lineTotal: "1.00", taxableBase: "1.00", taxAmount: "0.00" },
        ]),
        sale(new Date("2026-06-11T12:00:00.000Z"), [
          { lineTotal: "2.00", taxableBase: "2.00", taxAmount: "0.00" },
        ]),
      ],
    });

    const response = await service.salesByPeriod({ from: "2026-06-10", to: "2026-06-11" });

    expect(response.rows.map((row) => row.bucketDate)).toEqual(["2026-06-10", "2026-06-11"]);
    expect(response.saleCount).toBe(2);
    expect(response.totalGross).toBe("3.00");
  });
});

describe("ReportingService · the half-open range", () => {
  it("queries exactly [fromInstant, toInstant) for the resolved period", async () => {
    const { service, saleQueries } = harness({ permissions: READ_PERMISSION });

    await service.salesByPeriod({ from: "2026-06-10", to: "2026-06-10" });

    expect(saleQueries).toHaveLength(1);
    expect(saleQueries[0]).toMatchObject({
      where: {
        tenantId: TENANT,
        status: "COMPLETED",
        completedAt: { gte: new Date(FROM_INSTANT), lt: new Date(TO_INSTANT) },
      },
      include: { lines: true },
      orderBy: [{ completedAt: "asc" }, { id: "asc" }],
    });
    // The repository asks for one row past the cap so it can PROVE the period is
    // over the limit instead of truncating it.
    expect(saleQueries[0]?.take).toBe(REPORT_SALE_ROW_LIMIT + 1);
  });

  it("declares a HALF-OPEN range: `completedAt >= fromInstant` and `< toInstant`", async () => {
    // The stub returns what it is given, so this asserts WHAT THE REPORT ASKS FOR:
    // the start bound is inclusive (`gte`) and the end bound is exclusive (`lt`),
    // which is what puts a sale completed exactly at `fromInstant` inside the
    // period and a sale completed exactly at `toInstant` in the NEXT one. The
    // row-level proof of both edges runs against the in-memory boundary in
    // `reporting.integration.test.ts`, where the predicate is actually applied.
    const { service, saleQueries } = harness({ permissions: READ_PERMISSION });

    await service.salesByPeriod({ from: "2026-06-10", to: "2026-06-10" });

    const where = saleQueries[0]?.where as { completedAt: { gte: Date; lt: Date } };
    expect(where.completedAt.gte.getTime()).toBe(new Date(FROM_INSTANT).getTime());
    expect(where.completedAt.lt.getTime()).toBe(new Date(TO_INSTANT).getTime());
  });

  it("returns an empty row set and zero totals for an empty period", async () => {
    const { service } = harness({ permissions: READ_PERMISSION, rows: [] });

    const response = await service.salesByPeriod({ preset: "today" });

    expect(response).toEqual({
      report: "sales-by-period",
      period: {
        preset: "today",
        fromDate: "2026-06-10",
        toDate: "2026-06-10",
        timeZone: "America/Asuncion",
        fromInstant: FROM_INSTANT,
        toInstant: TO_INSTANT,
      },
      currency: "PYG",
      saleCount: 0,
      totalNet: "0.00",
      totalTax: "0.00",
      totalGross: "0.00",
      rows: [],
    });
  });
});

describe("ReportingService · refusals", () => {
  it("refuses a period over the row cap instead of truncating the aggregate", async () => {
    const rows = Array.from({ length: REPORT_SALE_ROW_LIMIT + 1 }, () =>
      sale(new Date("2026-06-10T12:00:00.000Z"), [
        { lineTotal: "1.00", taxableBase: "1.00", taxAmount: "0.00" },
      ])
    );
    const { service } = harness({ permissions: READ_PERMISSION, rows });

    await expect(
      service.salesByPeriod({ from: "2026-06-10", to: "2026-06-10" })
    ).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      message: REPORT_ROW_LIMIT_EXCEEDED_MESSAGE,
    });
  });

  it("accepts exactly the row cap", async () => {
    const rows = Array.from({ length: REPORT_SALE_ROW_LIMIT }, () =>
      sale(new Date("2026-06-10T12:00:00.000Z"), [
        { lineTotal: "1.00", taxableBase: "1.00", taxAmount: "0.00" },
      ])
    );
    const { service } = harness({ permissions: READ_PERMISSION, rows });

    const response = await service.salesByPeriod({ from: "2026-06-10", to: "2026-06-10" });

    expect(response.saleCount).toBe(REPORT_SALE_ROW_LIMIT);
    expect(response.totalGross).toBe(`${REPORT_SALE_ROW_LIMIT}.00`);
  });

  it("refuses a missing reports.read BEFORE any query runs", async () => {
    const { service, saleQueries } = harness({ permissions: ["sales.read"] });

    await expect(service.salesByPeriod({ preset: "today" })).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: REPORT_READ_FORBIDDEN_MESSAGE,
    });
    // The gate precedes data access: not one query reached the client.
    expect(saleQueries).toEqual([]);
  });
});

/** The pinned period echo every `from=2026-06-10&to=2026-06-10` response carries. */
const ONE_DAY_PERIOD = {
  preset: null,
  fromDate: "2026-06-10",
  toDate: "2026-06-10",
  timeZone: "America/Asuncion",
  fromInstant: FROM_INSTANT,
  toInstant: TO_INSTANT,
} as const;

describe("ReportingService · payment methods ([[REP-003]])", () => {
  it("sums each tender exactly and orders them by amount descending", async () => {
    const { service } = harness({
      permissions: READ_PERMISSION,
      paymentRows: [
        // A sale paid with TWO methods (DEC-029 allows it) and an amount whose
        // binary floating-point representation is inexact.
        paidSale(new Date("2026-06-10T12:00:00.000Z"), [
          { method: "CASH", amount: "1000.55" },
          { method: "CARD", amount: "249.45" },
        ]),
        paidSale(new Date("2026-06-10T13:00:00.000Z"), [
          { method: "BANK_TRANSFER", amount: "850.00" },
        ]),
        paidSale(new Date("2026-06-10T14:00:00.000Z"), [{ method: "CARD", amount: "100.00" }]),
      ],
    });

    const response = await service.paymentMethods({ from: "2026-06-10", to: "2026-06-10" });

    expect(response).toEqual({
      report: "payment-methods",
      period: ONE_DAY_PERIOD,
      currency: "PYG",
      totalGross: "2200.00",
      rows: [
        // CARD has TWO payments (249.45 + 100.00 = 349.45) and still sorts last:
        // the order is the summed amount, never the number of payments.
        { method: "CASH", paymentCount: 1, amount: "1000.55", shareOfGross: "0.4548" },
        { method: "BANK_TRANSFER", paymentCount: 1, amount: "850.00", shareOfGross: "0.3864" },
        { method: "CARD", paymentCount: 2, amount: "349.45", shareOfGross: "0.1588" },
      ],
    });
    // `1000.55` is not exactly representable as an IEEE-754 double; the report
    // still emits the decimal the tenant charged, because nothing here is a float.
    expect((1000.55).toPrecision(20)).not.toBe("1000.5500000000000000000");
  });

  it("counts every payment of one method and sums them on the money scale", async () => {
    const { service } = harness({
      permissions: READ_PERMISSION,
      paymentRows: [
        paidSale(new Date("2026-06-10T12:00:00.000Z"), [
          { method: "CASH", amount: "0.10" },
          { method: "CASH", amount: "0.20" },
        ]),
      ],
    });

    const response = await service.paymentMethods({ from: "2026-06-10", to: "2026-06-10" });

    // 0.1 + 0.2 is 0.30000000000000004 as doubles; the report answers "0.30".
    expect(response.rows).toEqual([
      { method: "CASH", paymentCount: 2, amount: "0.30", shareOfGross: "1.0000" },
    ]);
    expect(String(0.1 + 0.2)).not.toBe("0.3");
  });

  it("orders equal tenders by method ascending", async () => {
    const { service } = harness({
      permissions: READ_PERMISSION,
      paymentRows: [
        paidSale(new Date("2026-06-10T12:00:00.000Z"), [
          { method: "QR", amount: "50.00" },
          { method: "CHECK", amount: "50.00" },
          { method: "CASH", amount: "100.00" },
        ]),
      ],
    });

    const response = await service.paymentMethods({ from: "2026-06-10", to: "2026-06-10" });

    expect(response.rows.map((row) => row.method)).toEqual(["CASH", "CHECK", "QR"]);
    expect(response.rows.map((row) => row.shareOfGross)).toEqual(["0.5000", "0.2500", "0.2500"]);
  });

  it("omits every method with no payment in the period", async () => {
    const { service } = harness({
      permissions: READ_PERMISSION,
      paymentRows: [
        paidSale(new Date("2026-06-10T12:00:00.000Z"), [{ method: "CARD", amount: "10.00" }]),
      ],
    });

    const response = await service.paymentMethods({ from: "2026-06-10", to: "2026-06-10" });

    // Exactly one row: the five methods with no payment are absent, never zeroes.
    expect(response.rows).toHaveLength(1);
    expect(response.rows[0]?.method).toBe("CARD");
  });

  it("answers a zero period gross with a zero share instead of dividing by zero", async () => {
    // A zero payment cannot be stored (`amount > 0` CHECK), so this guards the
    // arithmetic rather than a reachable row: a NaN share would travel as JSON.
    const { service } = harness({
      permissions: READ_PERMISSION,
      paymentRows: [
        paidSale(new Date("2026-06-10T12:00:00.000Z"), [{ method: "OTHER", amount: "0.00" }]),
      ],
    });

    const response = await service.paymentMethods({ from: "2026-06-10", to: "2026-06-10" });

    expect(response.totalGross).toBe("0.00");
    expect(response.rows).toEqual([
      { method: "OTHER", paymentCount: 1, amount: "0.00", shareOfGross: "0.0000" },
    ]);
  });

  it("cuts the period on the SALE's business instant and reads payments without lines", async () => {
    const { service, saleQueries } = harness({ permissions: READ_PERMISSION, paymentRows: [] });

    await service.paymentMethods({ from: "2026-06-10", to: "2026-06-10" });

    expect(saleQueries).toHaveLength(1);
    expect(saleQueries[0]).toMatchObject({
      where: {
        tenantId: TENANT,
        status: "COMPLETED",
        completedAt: { gte: new Date(FROM_INSTANT), lt: new Date(TO_INSTANT) },
      },
      orderBy: [{ completedAt: "asc" }, { id: "asc" }],
    });
    // `payments` in, `lines` out: the report reads no line, so it loads none.
    expect(saleQueries[0]?.include).toEqual({ payments: true });
    expect(saleQueries[0]?.take).toBe(REPORT_SALE_ROW_LIMIT + 1);
  });

  it("returns an empty row set and a zero gross for an empty period", async () => {
    const { service } = harness({ permissions: READ_PERMISSION, paymentRows: [] });

    const response = await service.paymentMethods({ from: "2026-06-10", to: "2026-06-10" });

    expect(response).toEqual({
      report: "payment-methods",
      period: ONE_DAY_PERIOD,
      currency: "PYG",
      totalGross: "0.00",
      rows: [],
    });
  });

  it("refuses a period over the row cap instead of aggregating a truncated one", async () => {
    const paymentRows = Array.from({ length: REPORT_SALE_ROW_LIMIT + 1 }, () =>
      paidSale(new Date("2026-06-10T12:00:00.000Z"), [{ method: "CASH", amount: "1.00" }])
    );
    const { service } = harness({ permissions: READ_PERMISSION, paymentRows });

    await expect(
      service.paymentMethods({ from: "2026-06-10", to: "2026-06-10" })
    ).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      message: REPORT_ROW_LIMIT_EXCEEDED_MESSAGE,
    });
  });

  it("refuses a missing reports.read BEFORE any query runs", async () => {
    const { service, saleQueries } = harness({ permissions: ["sales.read"] });

    await expect(service.paymentMethods({ preset: "today" })).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: REPORT_READ_FORBIDDEN_MESSAGE,
    });
    expect(saleQueries).toEqual([]);
  });
});

describe("ReportingService · sales by product/service ([[REP-003]])", () => {
  it("groups lines by catalog item at the quantity and money scales", async () => {
    const { service, catalogQueries } = harness({
      permissions: READ_PERMISSION,
      rows: [
        sale(new Date("2026-06-10T12:00:00.000Z"), [
          {
            catalogItemId: ITEM_PRODUCT,
            quantity: "1.500",
            lineTotal: "150.00",
            taxableBase: "150.00",
            taxAmount: "0.00",
          },
          {
            catalogItemId: ITEM_SERVICE,
            quantity: "2.000",
            lineTotal: "60.00",
            taxableBase: "55.00",
            taxAmount: "5.00",
          },
        ]),
        sale(new Date("2026-06-11T02:00:00.000Z"), [
          {
            catalogItemId: ITEM_PRODUCT,
            quantity: "0.250",
            lineTotal: "25.00",
            taxableBase: "25.00",
            taxAmount: "0.00",
          },
        ]),
      ],
      catalogItems: [
        // REP-003 reads only identity, name and `kind`; the two inventory columns
        // are REQUIRED on the row so "not selected" can never pass for a NULL
        // threshold (DEC-065) — see `ReportCatalogItemRow`.
        {
          id: ITEM_PRODUCT,
          name: "Vacuna",
          kind: "PRODUCT",
          tracksStock: true,
          lowStockThreshold: null,
        },
        {
          id: ITEM_SERVICE,
          name: "Consulta",
          kind: "SERVICE",
          tracksStock: false,
          lowStockThreshold: null,
        },
      ],
    });

    const response = await service.salesByProductService({
      from: "2026-06-10",
      to: "2026-06-10",
    });

    expect(response).toEqual({
      report: "sales-by-product-service",
      period: ONE_DAY_PERIOD,
      currency: "PYG",
      totalsByKind: {
        PRODUCT: { net: "175.00", tax: "0.00", gross: "175.00", quantity: "1.750" },
        SERVICE: { net: "55.00", tax: "5.00", gross: "60.00", quantity: "2.000" },
      },
      rows: [
        {
          catalogItemId: ITEM_PRODUCT,
          name: "Vacuna",
          kind: "PRODUCT",
          quantity: "1.750",
          net: "175.00",
          tax: "0.00",
          gross: "175.00",
        },
        {
          catalogItemId: ITEM_SERVICE,
          name: "Consulta",
          kind: "SERVICE",
          quantity: "2.000",
          net: "55.00",
          tax: "5.00",
          gross: "60.00",
        },
      ],
    });
    // ONE catalog read for both items: the identity, name and kind of a whole
    // period never cost a query per item.
    expect(catalogQueries).toHaveLength(1);
  });

  it("merges one item sold in two lines of the same sale", async () => {
    // The `(tenant_id, sale_id, catalog_item_id)` unique index forbids this shape
    // in PostgreSQL; the grouping still merges rather than assuming the index.
    const { service } = harness({
      permissions: READ_PERMISSION,
      rows: [
        sale(new Date("2026-06-10T12:00:00.000Z"), [
          {
            catalogItemId: ITEM_PRODUCT,
            quantity: "1.000",
            lineTotal: "10.00",
            taxableBase: "10.00",
            taxAmount: "0.00",
          },
          {
            catalogItemId: ITEM_PRODUCT,
            quantity: "2.000",
            lineTotal: "20.00",
            taxableBase: "20.00",
            taxAmount: "0.00",
          },
        ]),
      ],
      catalogItems: [
        {
          id: ITEM_PRODUCT,
          name: "Vacuna",
          kind: "PRODUCT",
          tracksStock: true,
          lowStockThreshold: null,
        },
      ],
    });

    const response = await service.salesByProductService({
      from: "2026-06-10",
      to: "2026-06-10",
    });

    expect(response.rows).toEqual([
      {
        catalogItemId: ITEM_PRODUCT,
        name: "Vacuna",
        kind: "PRODUCT",
        quantity: "3.000",
        net: "30.00",
        tax: "0.00",
        gross: "30.00",
      },
    ]);
    expect(response.totalsByKind).toEqual({
      PRODUCT: { net: "30.00", tax: "0.00", gross: "30.00", quantity: "3.000" },
    });
  });

  it("orders items by gross descending, then name ascending", async () => {
    const item = (catalogItemId: string, name: string): ReportCatalogItemRow => ({
      id: catalogItemId,
      name,
      kind: "PRODUCT",
      tracksStock: true,
      lowStockThreshold: null,
    });
    const line = (catalogItemId: string, total: string): SaleLineFixture => ({
      catalogItemId,
      quantity: "1.000",
      lineTotal: total,
      taxableBase: total,
      taxAmount: "0.00",
    });

    const { service } = harness({
      permissions: READ_PERMISSION,
      rows: [
        sale(new Date("2026-06-10T12:00:00.000Z"), [
          line("item-zeta", "500.00"),
          line("item-alfa", "500.00"),
          line("item-beta", "100.00"),
        ]),
      ],
      catalogItems: [
        item("item-zeta", "Zeta"),
        item("item-alfa", "Alfa"),
        item("item-beta", "Beta"),
      ],
    });

    const response = await service.salesByProductService({
      from: "2026-06-10",
      to: "2026-06-10",
    });

    // The equal-gross tie is broken by NAME, not by the map's insertion order.
    expect(response.rows.map((row) => row.name)).toEqual(["Alfa", "Zeta", "Beta"]);
  });

  it("refuses LOUDLY when a referenced catalog item is missing, naming its id", async () => {
    const { service } = harness({
      permissions: READ_PERMISSION,
      rows: [
        sale(new Date("2026-06-10T12:00:00.000Z"), [
          {
            catalogItemId: ITEM_MEDICATION,
            quantity: "1.000",
            lineTotal: "10.00",
            taxableBase: "10.00",
            taxAmount: "0.00",
          },
        ]),
      ],
      // The catalog read returns nothing: the composite RESTRICT FK makes this
      // unreachable, and a silently dropped revenue line would be worse than a 500.
      catalogItems: [],
    });

    // One execution, two assertions: the stable `INTERNAL` code with the named
    // id, and the id itself in the message a human will read.
    const refusal = service.salesByProductService({ from: "2026-06-10", to: "2026-06-10" });
    await expect(refusal).rejects.toMatchObject({
      code: "INTERNAL",
      message: reportCatalogItemMissingMessage(ITEM_MEDICATION),
    });
    await expect(refusal).rejects.toThrow(ITEM_MEDICATION);
  });

  it("reads the catalog with the tenant predicate and the referenced ids only", async () => {
    const { service, catalogQueries } = harness({
      permissions: READ_PERMISSION,
      rows: [
        sale(new Date("2026-06-10T12:00:00.000Z"), [
          {
            catalogItemId: ITEM_PRODUCT,
            quantity: "1.000",
            lineTotal: "10.00",
            taxableBase: "10.00",
            taxAmount: "0.00",
          },
          {
            catalogItemId: ITEM_SERVICE,
            quantity: "1.000",
            lineTotal: "20.00",
            taxableBase: "20.00",
            taxAmount: "0.00",
          },
        ]),
      ],
      catalogItems: [
        {
          id: ITEM_PRODUCT,
          name: "Vacuna",
          kind: "PRODUCT",
          tracksStock: true,
          lowStockThreshold: null,
        },
        {
          id: ITEM_SERVICE,
          name: "Consulta",
          kind: "SERVICE",
          tracksStock: false,
          lowStockThreshold: null,
        },
      ],
    });

    await service.salesByProductService({ from: "2026-06-10", to: "2026-06-10" });

    const where = catalogQueries[0]?.where as { tenantId: string; id: { in: string[] } };
    expect(where.tenantId).toBe(TENANT);
    expect([...where.id.in].sort()).toEqual([ITEM_PRODUCT, ITEM_SERVICE].sort());
  });

  it("returns an empty row set and empty kind totals for an empty period, reading no catalog", async () => {
    const { service, catalogQueries } = harness({ permissions: READ_PERMISSION, rows: [] });

    const response = await service.salesByProductService({
      from: "2026-06-10",
      to: "2026-06-10",
    });

    expect(response).toEqual({
      report: "sales-by-product-service",
      period: ONE_DAY_PERIOD,
      currency: "PYG",
      totalsByKind: {},
      rows: [],
    });
    // Nothing to identify, so nothing is asked: an empty id set is not a query.
    expect(catalogQueries).toEqual([]);
  });

  it("refuses a missing reports.read BEFORE any query runs", async () => {
    const { service, saleQueries, catalogQueries } = harness({ permissions: ["sales.read"] });

    await expect(service.salesByProductService({ preset: "today" })).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: REPORT_READ_FORBIDDEN_MESSAGE,
    });
    expect(saleQueries).toEqual([]);
    expect(catalogQueries).toEqual([]);
  });
});

describe("ReportingService · the cross-report invariant ([[REP-003]])", () => {
  it("sums the tenders to the period gross EXACTLY, with no epsilon", async () => {
    // Several days, several methods, one sale paid with two methods (including
    // an amount no double can hold exactly), and payments that match each sale's
    // line totals — the property Sales.md promises and this test asserts.
    const sales = [
      {
        completedAt: new Date("2026-06-10T12:00:00.000Z"),
        lines: [{ lineTotal: "1000.55", taxableBase: "1000.55", taxAmount: "0.00" }],
        payments: [
          { method: "CASH", amount: "700.55" },
          { method: "CARD", amount: "300.00" },
        ],
      },
      {
        completedAt: new Date("2026-06-11T02:00:00.000Z"),
        lines: [{ lineTotal: "850.00", taxableBase: "800.00", taxAmount: "50.00" }],
        payments: [{ method: "BANK_TRANSFER", amount: "850.00" }],
      },
      {
        completedAt: new Date("2026-06-11T14:00:00.000Z"),
        lines: [
          { lineTotal: "300.00", taxableBase: "300.00", taxAmount: "0.00" },
          { lineTotal: "49.45", taxableBase: "49.45", taxAmount: "0.00" },
        ],
        payments: [{ method: "CARD", amount: "349.45" }],
      },
    ];

    const { service } = harness({
      permissions: READ_PERMISSION,
      rows: sales.map((entry) => sale(entry.completedAt, entry.lines)),
      paymentRows: sales.map((entry) => paidSale(entry.completedAt, entry.payments)),
    });

    const byPeriod = await service.salesByPeriod({ from: "2026-06-10", to: "2026-06-11" });
    const methods = await service.paymentMethods({ from: "2026-06-10", to: "2026-06-11" });

    const tenderTotal = methods.rows.reduce(
      (sum, row) => sum.plus(new Prisma.Decimal(row.amount)),
      new Prisma.Decimal(0)
    );

    expect(byPeriod.totalGross).toBe("2200.00");
    expect(methods.totalGross).toBe(byPeriod.totalGross);
    // Exact string equality — no `toBeCloseTo`, because "almost the same money"
    // is not a state this system has.
    expect(tenderTotal.toFixed(2)).toBe(byPeriod.totalGross);
  });
});
