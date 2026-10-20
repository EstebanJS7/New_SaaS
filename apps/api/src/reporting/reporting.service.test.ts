import { describe, expect, it } from "vitest";
import type { Prisma } from "@newsaas/database";
import type { PermissionResolver } from "../rbac/permission-resolver.service.js";
import type { RequestContextService } from "../context/request-context.service.js";
import type { TenantSettingsService } from "../settings/tenant-settings.service.js";
import { REPORTING_PERMISSIONS } from "./reporting.permissions.js";
import {
  REPORT_ROW_LIMIT_EXCEEDED_MESSAGE,
  REPORT_SALE_ROW_LIMIT,
  ReportRepository,
  type ReportingReadPrisma,
  type ReportSaleRow,
} from "./reporting.repository.js";
import { REPORT_READ_FORBIDDEN_MESSAGE, ReportingService } from "./reporting.service.js";

/**
 * The sales-by-period service ([[REP-002]], [[DEC-063]]). Every assertion is on
 * VALUES and on the ARGUMENTS the service passed to Prisma: the stub delegate
 * returns exactly the rows it is given, so an end-to-end assertion would pass
 * whatever range the service asked for.
 */

const TENANT = "11111111-1111-4111-8111-111111111111";

/** Asunción is `-03`, so 2026-06-10 00:00 local is 2026-06-10T03:00:00Z. */
const FROM_INSTANT = "2026-06-10T03:00:00.000Z";
const TO_INSTANT = "2026-06-11T03:00:00.000Z";

interface Harness {
  service: ReportingService;
  /** Every `findMany` arg the repository built, in call order. */
  saleQueries: Prisma.SaleFindManyArgs[];
}

function sale(
  completedAt: Date | null,
  lines: readonly { lineTotal: string; taxableBase: string; taxAmount: string }[]
): ReportSaleRow {
  return { id: `sale-${Math.random().toString(16).slice(2)}`, currency: "PYG", completedAt, lines };
}

/**
 * Builds the real repository (so the cap and the query shape under test are the
 * shipped ones) over a stub delegate, with a stub permission resolver and a
 * pinned clock.
 */
function harness(
  options: {
    rows?: ReportSaleRow[];
    permissions?: readonly string[];
    now?: Date;
    currency?: unknown;
  } = {}
): Harness {
  const saleQueries: Prisma.SaleFindManyArgs[] = [];
  const prisma: ReportingReadPrisma = {
    sale: {
      findMany: (args) => {
        saleQueries.push(args);
        return Promise.resolve(options.rows ?? []);
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
  return { service, saleQueries };
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
