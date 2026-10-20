import { describe, expect, it } from "vitest";
import type { PermissionResolver } from "../../rbac/permission-resolver.service.js";
import {
  REPORT_DUE_QUERY_INVALID_MESSAGE,
  REPORT_QUERY_NOT_ALLOWED_MESSAGE,
  REPORT_PERIOD_QUERY_INVALID_MESSAGE,
  type ReportPeriodDto,
} from "../reporting.dto.js";
import { REPORTING_PERMISSIONS } from "../reporting.permissions.js";
import type { ReportingService } from "../reporting.service.js";
import {
  REPORT_EXPORT_CODES,
  REPORT_EXPORT_DEFINITIONS,
  REPORT_EXPORT_UNKNOWN_CODE_MESSAGE,
  isReportExportCode,
  type ReportExportCode,
  type ReportExportQueryContract,
} from "./report-export.definitions.js";
import {
  REPORT_EXPORT_FORBIDDEN_MESSAGE,
  REPORT_EXPORT_ROW_LIMIT,
  REPORT_EXPORT_ROW_LIMIT_EXCEEDED_MESSAGE,
  ReportExportService,
} from "./report-export.service.js";

/**
 * The export contract table, the dispatcher, the cap and the permission
 * ([[REP-007]], [[DEC-062]], [[DEC-066]]).
 *
 * The reader here is a STUB of `ReportingService`, never a database: every
 * assertion is about what the export does with a response, and the report's own
 * rows are covered by their own suites. What the stub deliberately preserves is
 * the ONE thing this suite is about — which method is called, how many times and
 * with which parsed query.
 */

/** The period every stubbed period response echoes. */
const PERIOD: ReportPeriodDto = {
  preset: null,
  fromDate: "2026-06-10",
  toDate: "2026-06-11",
  timeZone: "America/Asuncion",
  fromInstant: "2026-06-10T03:00:00.000Z",
  toInstant: "2026-06-12T03:00:00.000Z",
};

/** The query every period case sends, and the object the period rule parses it into. */
const PERIOD_QUERY = { from: "2026-06-10", to: "2026-06-11" } as const;

/** The pinned clock: 2026-06-10 08:00 in Asunción (`-03`). */
const NOW = new Date("2026-06-10T11:00:00.000Z");

/**
 * The DOCUMENTED column order per report — the contract the header row must
 * reproduce. Written out rather than derived from the implementation, because a
 * test that read the implementation's own list would agree with any drift.
 */
const DOCUMENTED_COLUMNS: Readonly<Record<ReportExportCode, readonly string[]>> = {
  "sales-by-period": ["bucketDate", "saleCount", "net", "tax", "gross"],
  "payment-methods": ["method", "paymentCount", "amount", "shareOfGross"],
  "sales-by-product-service": ["catalogItemId", "name", "kind", "quantity", "net", "tax", "gross"],
  "cash-sessions": [
    "sessionId",
    "registerId",
    "openedAt",
    "closedAt",
    "openingAmount",
    "expectedAmount",
    "countedAmount",
    "differenceAmount",
  ],
  "cash-movements": ["type", "direction", "movementCount", "signedAmount"],
  purchases: [
    "purchaseId",
    "supplierId",
    "supplierName",
    "receivedAt",
    "lineCount",
    "totalQuantity",
  ],
  stock: ["catalogItemId", "name", "kind", "quantity", "inbound", "outbound", "net"],
  "low-stock": ["catalogItemId", "name", "quantity", "threshold", "shortfall"],
  consultations: ["bucketDate", "consultationCount"],
  "new-patients": ["bucketDate", "count"],
  "vaccines-due": ["patientId", "patientName", "vaccine", "administeredAt", "nextDueAt", "status"],
  "deworming-due": ["patientId", "patientName", "product", "administeredAt", "nextDueAt", "status"],
};

/** The reporting service method each code must dispatch to — the ONE query per export. */
const READER_METHOD_BY_CODE: Readonly<Record<ReportExportCode, keyof ReportingService>> = {
  "sales-by-period": "salesByPeriod",
  "payment-methods": "paymentMethods",
  "sales-by-product-service": "salesByProductService",
  "cash-sessions": "cashSessions",
  "cash-movements": "cashMovements",
  purchases: "purchases",
  stock: "stock",
  "low-stock": "lowStock",
  consultations: "consultations",
  "new-patients": "newPatients",
  "vaccines-due": "vaccinesDue",
  "deworming-due": "dewormingDue",
};

interface ReaderCall {
  readonly method: string;
  readonly query: unknown;
}

interface ReaderStub {
  readonly service: ReportingService;
  /** Every call the export made, in order — the "one query per export" evidence. */
  readonly calls: ReaderCall[];
}

/**
 * A `ReportingService` double that answers every report method with the same
 * rows.
 *
 * It carries only the fields the EXPORT reads — `rows`, and the `period` /
 * `asOfDate` the filename is built from. Filling in `currency`, `totals` or
 * `thresholdsConfigured` would assert nothing here and would only have to be
 * maintained alongside the report DTOs, which their own suites already pin.
 */
function stubReader(
  rows: readonly Record<string, unknown>[],
  options: { readonly asOfDate?: string; readonly period?: ReportPeriodDto } = {}
): ReaderStub {
  const calls: ReaderCall[] = [];
  const stubbed: Record<string, (query: unknown) => Promise<Record<string, unknown>>> = {};
  for (const method of Object.values(READER_METHOD_BY_CODE)) {
    stubbed[method] = (query: unknown) => {
      calls.push({ method, query });
      return Promise.resolve({
        report: method,
        rows,
        period: options.period ?? PERIOD,
        asOfDate: options.asOfDate ?? "2026-06-10",
      });
    };
  }
  return { service: stubbed as unknown as ReportingService, calls };
}

/** Builds the service over a stub reader, a permission set and the pinned clock. */
function harness(
  options: {
    readonly rows?: readonly Record<string, unknown>[];
    readonly asOfDate?: string;
    readonly period?: ReportPeriodDto;
    readonly permissions?: readonly string[];
    readonly now?: Date;
  } = {}
): { service: ReportExportService; reader: ReaderStub } {
  const reader = stubReader(options.rows ?? [], {
    asOfDate: options.asOfDate,
    period: options.period,
  });
  const permissionResolver = {
    resolveForActiveRequest: () => Promise.resolve(new Set(options.permissions ?? [])),
  } as unknown as PermissionResolver;
  const now = options.now ?? NOW;
  return {
    service: new ReportExportService(reader.service, permissionResolver, () => now),
    reader,
  };
}

/** The query each code is exercised with: a period, or nothing at all. */
function queryFor(code: ReportExportCode): unknown {
  const contract: ReportExportQueryContract = REPORT_EXPORT_DEFINITIONS[code].queryContract;
  return contract === "period" ? { ...PERIOD_QUERY } : {};
}

/** A rejection captured as `{ code, message }` so two conditions can be compared. */
async function rejection(run: () => Promise<unknown>): Promise<{ code: string; message: string }> {
  try {
    await run();
  } catch (error) {
    const shaped = error as { code?: unknown; message?: unknown };
    return { code: String(shaped.code), message: String(shaped.message) };
  }
  throw new Error("expected the export to refuse");
}

/** Export permissions as the two grants a role can hold, kept apart on purpose. */
const WITH_EXPORT = { permissions: [REPORTING_PERMISSIONS.export] };
const READ_ONLY = { permissions: [REPORTING_PERMISSIONS.read] };

describe("REPORT_EXPORT_DEFINITIONS · the closed allowlist", () => {
  it("exports exactly the twelve shipped reports, in delivery order", () => {
    expect(REPORT_EXPORT_CODES).toEqual([
      "sales-by-period",
      "payment-methods",
      "sales-by-product-service",
      "cash-sessions",
      "cash-movements",
      "purchases",
      "stock",
      "low-stock",
      "consultations",
      "new-patients",
      "vaccines-due",
      "deworming-due",
    ]);
  });

  it("accepts every shipped code and refuses anything else", () => {
    for (const code of REPORT_EXPORT_CODES) {
      expect(isReportExportCode(code), code).toBe(true);
      expect(REPORT_EXPORT_DEFINITIONS[code].code).toBe(code);
    }
    // Not a report: a near-miss of one, an empty segment and a path attempt.
    expect(isReportExportCode("reports")).toBe(false);
    expect(isReportExportCode("")).toBe(false);
    expect(isReportExportCode("sales-by-period/../../cash")).toBe(false);
  });

  it("maps each code to the query contract its report actually has", () => {
    const period = REPORT_EXPORT_CODES.filter(
      (code) => REPORT_EXPORT_DEFINITIONS[code].queryContract === "period"
    );
    const due = REPORT_EXPORT_CODES.filter(
      (code) => REPORT_EXPORT_DEFINITIONS[code].queryContract === "due"
    );
    const none = REPORT_EXPORT_CODES.filter(
      (code) => REPORT_EXPORT_DEFINITIONS[code].queryContract === "none"
    );

    expect(period).toEqual([
      "sales-by-period",
      "payment-methods",
      "sales-by-product-service",
      "cash-sessions",
      "cash-movements",
      "purchases",
      "stock",
      "consultations",
      "new-patients",
    ]);
    expect(due).toEqual(["vaccines-due", "deworming-due"]);
    // The ONE current-state report: no period, no horizon, no query at all.
    expect(none).toEqual(["low-stock"]);
  });
});

describe("the export document · headers and columns", () => {
  it("emits the documented header row for EVERY report, and every column reads its own field", async () => {
    for (const code of REPORT_EXPORT_CODES) {
      const headers = DOCUMENTED_COLUMNS[code];
      // A row whose every field carries its own NAME, upper-cased. A column that
      // reads a different field — or reads nothing — cannot produce this line,
      // so the table below pins the header order AND the projection in one go.
      const row = Object.fromEntries(headers.map((header) => [header, header.toUpperCase()]));
      const { service } = harness({ rows: [row], ...WITH_EXPORT });

      const exported = await service.exportReport(code, queryFor(code));

      expect(exported.csv.split("\n"), code).toEqual([
        headers.join(","),
        headers.map((header) => header.toUpperCase()).join(","),
        "",
      ]);
      // The table's own declared order is the emitted one, not a second opinion.
      expect(REPORT_EXPORT_DEFINITIONS[code].headers, code).toEqual(headers);
    }
  });

  it("produces a header-only document for an empty report", async () => {
    const { service } = harness({ rows: [], ...WITH_EXPORT });

    const exported = await service.exportReport("sales-by-period", { ...PERIOD_QUERY });

    expect(exported.csv).toBe("bucketDate,saleCount,net,tax,gross\n");
  });

  it("renders a null column as an empty field, which is what a cash movement's direction is", async () => {
    const { service } = harness({
      rows: [
        { type: "SALE", direction: null, movementCount: 3, signedAmount: "300.00" },
        {
          type: "ADJUSTMENT",
          direction: "DECREASE",
          movementCount: 1,
          signedAmount: "-5.00",
        },
      ],
      ...WITH_EXPORT,
    });

    const exported = await service.exportReport("cash-movements", { ...PERIOD_QUERY });

    expect(exported.csv.split("\n")).toEqual([
      "type,direction,movementCount,signedAmount",
      "SALE,,3,300.00",
      "ADJUSTMENT,DECREASE,1,-5.00",
      "",
    ]);
    expect(exported.csv).not.toContain("null");
  });
});

describe("the export filename", () => {
  it("names a period report after the period it actually aggregated", async () => {
    const { service } = harness({ ...WITH_EXPORT });

    const exported = await service.exportReport("sales-by-period", { ...PERIOD_QUERY });

    expect(exported.filename).toBe("sales-by-period-2026-06-10-2026-06-11.csv");
  });

  it("names a due report after the as-of date the split was made against", async () => {
    const { service } = harness({ asOfDate: "2026-06-10", ...WITH_EXPORT });

    const exported = await service.exportReport("vaccines-due", {});

    // No period to name: a due report answers "what is due", not "what happened".
    expect(exported.filename).toBe("vaccines-due-2026-06-10.csv");
  });

  it("names low-stock after the TENANT's calendar day, not the UTC one", async () => {
    // 2026-06-11T02:00Z is 23:00 on the 10th in Asunción: the tenant's day is the
    // 10th, and a filename built from the UTC date would say the 11th.
    const { service } = harness({
      now: new Date("2026-06-11T02:00:00.000Z"),
      ...WITH_EXPORT,
    });

    const exported = await service.exportReport("low-stock", {});

    expect(exported.filename).toBe("low-stock-2026-06-10.csv");
  });
});

describe("the single-query invariant", () => {
  it("calls the report's OWN service method, exactly once, with the parsed query", async () => {
    const { service, reader } = harness({ ...WITH_EXPORT });

    await service.exportReport("sales-by-period", { ...PERIOD_QUERY });

    // One call, the report's own method, the query the period SCHEMA produced —
    // never a second query of the export's own and never the raw route object.
    expect(reader.calls).toEqual([
      { method: "salesByPeriod", query: { from: "2026-06-10", to: "2026-06-11" } },
    ]);
  });

  it("dispatches every code to its own report method, one call each", async () => {
    const { service, reader } = harness({ ...WITH_EXPORT });

    for (const code of REPORT_EXPORT_CODES) {
      await service.exportReport(code, queryFor(code));
    }

    expect(reader.calls.map((call) => call.method)).toEqual(
      REPORT_EXPORT_CODES.map((code) => READER_METHOD_BY_CODE[code])
    );
  });
});

describe("the row cap ([[DEC-066]])", () => {
  /**
   * `count` rows whose every field is accessor-backed and reports each read.
   *
   * This is how "no partial file" is observable without mocking the serializer:
   * if any row were rendered, a field would have been read.
   */
  function watchedRows(count: number, reads: { count: number }): Record<string, unknown>[] {
    const rows: Record<string, unknown>[] = [];
    for (let index = 0; index < count; index += 1) {
      const row: Record<string, unknown> = {};
      for (const header of DOCUMENTED_COLUMNS["sales-by-period"]) {
        Object.defineProperty(row, header, {
          enumerable: true,
          get: () => {
            reads.count += 1;
            return header === "saleCount" ? 1 : "2026-06-10";
          },
        });
      }
      rows.push(row);
    }
    return rows;
  }

  it("exports a report of exactly the cap", async () => {
    const reads = { count: 0 };
    const { service } = harness({
      rows: watchedRows(REPORT_EXPORT_ROW_LIMIT, reads),
      ...WITH_EXPORT,
    });

    const exported = await service.exportReport("sales-by-period", { ...PERIOD_QUERY });

    // The header line plus one line per data row plus the trailing empty split.
    expect(exported.csv.split("\n")).toHaveLength(REPORT_EXPORT_ROW_LIMIT + 2);
    expect(reads.count).toBeGreaterThan(0);
  });

  it("refuses ONE row over the cap, and serializes nothing at all", async () => {
    const reads = { count: 0 };
    const { service } = harness({
      rows: watchedRows(REPORT_EXPORT_ROW_LIMIT + 1, reads),
      ...WITH_EXPORT,
    });

    expect(
      await rejection(() => service.exportReport("sales-by-period", { ...PERIOD_QUERY }))
    ).toEqual({
      code: "VALIDATION_FAILED",
      message: REPORT_EXPORT_ROW_LIMIT_EXCEEDED_MESSAGE,
    });
    // Not one field of not one row was read: the refusal precedes the renderer,
    // so no partial document exists even transiently.
    expect(reads.count).toBe(0);
  });
});

describe("the export permission ([[DEC-062]])", () => {
  it("refuses a caller holding reports.read WITHOUT reports.export", async () => {
    const { service, reader } = harness({ ...READ_ONLY });

    expect(
      await rejection(() => service.exportReport("sales-by-period", { ...PERIOD_QUERY }))
    ).toEqual({ code: "FORBIDDEN", message: REPORT_EXPORT_FORBIDDEN_MESSAGE });
    // The denial reaches no report at all.
    expect(reader.calls).toEqual([]);
  });

  it("accepts a caller holding reports.export alone — at THIS boundary the read key is not required", async () => {
    // Scoped deliberately: this asserts the EXPORT boundary's own requirement.
    // End to end an export still needs `reports.read`, because the report method
    // it renders re-asserts that key as defense in depth — the integration suite
    // pins that second gate explicitly, and neither suite may contradict the
    // other about it.
    const { service, reader } = harness({ ...WITH_EXPORT });

    const exported = await service.exportReport("sales-by-period", { ...PERIOD_QUERY });

    expect(exported.filename).toBe("sales-by-period-2026-06-10-2026-06-11.csv");
    expect(reader.calls).toHaveLength(1);
  });

  it("refuses a caller with no report grant at all", async () => {
    const { service } = harness();

    expect(
      await rejection(() => service.exportReport("sales-by-period", { ...PERIOD_QUERY }))
    ).toEqual({ code: "FORBIDDEN", message: REPORT_EXPORT_FORBIDDEN_MESSAGE });
  });
});

describe("the export refusals", () => {
  it("refuses an unknown report code with 404 and reads nothing", async () => {
    const { service, reader } = harness({ ...WITH_EXPORT });

    expect(await rejection(() => service.exportReport("profit-and-loss", {}))).toEqual({
      code: "NOT_FOUND",
      message: REPORT_EXPORT_UNKNOWN_CODE_MESSAGE,
    });
    expect(reader.calls).toEqual([]);
  });

  it("refuses a malformed period shape on a period report", async () => {
    const { service, reader } = harness({ ...WITH_EXPORT });

    expect(await rejection(() => service.exportReport("sales-by-period", { from: 2026 }))).toEqual({
      code: "VALIDATION_FAILED",
      message: REPORT_PERIOD_QUERY_INVALID_MESSAGE,
    });
    expect(reader.calls).toEqual([]);
  });

  it("forwards the period SHAPE and leaves its semantics to the report's own resolver", async () => {
    const { service, reader } = harness({ ...WITH_EXPORT });

    // Half a range passes the shape schema and is forwarded verbatim: the export
    // deliberately does not re-implement the period rule, so the `400` with
    // `REPORT_PERIOD_INCOMPLETE_RANGE_MESSAGE` comes from the report's own
    // `resolveReportPeriod` call (proven end to end in the integration suite).
    await service.exportReport("sales-by-period", { from: "2026-06-10" });

    expect(reader.calls).toEqual([{ method: "salesByPeriod", query: { from: "2026-06-10" } }]);
  });

  it("refuses a period key on a due report's export", async () => {
    const { service, reader } = harness({ ...WITH_EXPORT });

    expect(
      await rejection(() =>
        service.exportReport("vaccines-due", { from: "2026-06-10", to: "2026-06-11" })
      )
    ).toEqual({ code: "VALIDATION_FAILED", message: REPORT_DUE_QUERY_INVALID_MESSAGE });
    expect(reader.calls).toEqual([]);
  });

  it("refuses ANY query key on low-stock's export", async () => {
    const { service, reader } = harness({ ...WITH_EXPORT });

    expect(await rejection(() => service.exportReport("low-stock", { period: "today" }))).toEqual({
      code: "VALIDATION_FAILED",
      message: REPORT_QUERY_NOT_ALLOWED_MESSAGE,
    });
    expect(reader.calls).toEqual([]);
  });
});
