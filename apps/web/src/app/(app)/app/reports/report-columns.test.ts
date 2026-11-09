/**
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";
import {
  columnsFromRows,
  CASH_MOVEMENT_HEADERS,
  CASH_SESSION_HEADERS,
  LOW_STOCK_HEADERS,
  PAYMENT_METHOD_HEADERS,
  PURCHASE_HEADERS,
  SALES_BY_PERIOD_HEADERS,
  SALES_BY_PRODUCT_SERVICE_HEADERS,
  STOCK_HEADERS,
  VACCINE_DUE_HEADERS,
  CASH_MOVEMENT_FORMATS,
  CASH_SESSION_FORMATS,
  LOW_STOCK_FORMATS,
  PAYMENT_METHOD_FORMATS,
  PURCHASE_FORMATS,
  SALES_BY_PERIOD_FORMATS,
  SALES_BY_PRODUCT_SERVICE_FORMATS,
  STOCK_FORMATS,
  VACCINE_DUE_FORMATS,
  formatReportCell,
  type ReportColumn,
} from "./report-columns";
import { formatEsPyDateOnly, formatEsPyInstant } from "@/lib/es-py-format";
import type { SalesByPeriodRow, StockReportRow } from "./reports-api";

/**
 * The table's columns, derived from the response type ([[REP-008]]).
 *
 * The property under test is the one that keeps a table honest: it shows the
 * fields the payload HAS, in the order the payload sends them, and its header map
 * cannot lag behind the DTO — a missing or extra key is a compile error, which is
 * why the runtime assertions here are about ORDER and COVERAGE rather than about a
 * list this module could have restated.
 */

const SALES_ROW: SalesByPeriodRow = {
  bucketDate: "2026-06-10",
  saleCount: 2,
  net: "1000.00",
  tax: "100.00",
  gross: "1100.00",
};

describe("the report table's columns", () => {
  it("takes the payload's own field order, not a list declared beside the type", () => {
    const columns = columnsFromRows(
      // Deliberately NOT the declaration order of `SalesByPeriodRow`: the payload
      // is what decides, so a reordered or extended response cannot leave the
      // table printing fields in an order the API never used.
      [{ gross: "1100.00", bucketDate: "2026-06-10", tax: "100.00", net: "1000.00", saleCount: 2 }],
      SALES_BY_PERIOD_HEADERS
    );

    expect(columns.map((column) => column.key)).toEqual([
      "gross",
      "bucketDate",
      "tax",
      "net",
      "saleCount",
    ]);
    expect(columns.map((column) => column.header)).toEqual([
      "Bruto",
      "Fecha",
      "Impuesto",
      "Neto",
      "Ventas",
    ]);
  });

  it("maps every field from the payload onto the header the type declares", () => {
    const columns: readonly ReportColumn<SalesByPeriodRow>[] = columnsFromRows(
      [SALES_ROW],
      SALES_BY_PERIOD_HEADERS
    );

    expect(columns.map((column) => column.key)).toEqual(Object.keys(SALES_ROW));
    for (const column of columns) {
      expect(column.header, column.key).toBe(SALES_BY_PERIOD_HEADERS[column.key]);
    }
  });

  it("keeps the complete column set when the period is empty", () => {
    // The empty period renders the empty state rather than a table, but the
    // derivation must still be total: with no row to inspect, the header map's own
    // keys — which ARE the DTO's fields — decide the column set.
    const columns = columnsFromRows<SalesByPeriodRow>([], SALES_BY_PERIOD_HEADERS);

    expect(columns.map((column) => column.key)).toEqual(Object.keys(SALES_BY_PERIOD_HEADERS));
    expect(columns).toHaveLength(5);
  });

  it("shows a field it has no header for under its raw name instead of dropping it", () => {
    // A drift in the OTHER direction: the API sends a field this client's mirror
    // does not know yet. Rendering it under its own key makes the drift visible;
    // dropping it would make the column silently disappear.
    const drifted = { ...SALES_ROW, shortfall: "2.000" };
    const columns = columnsFromRows<SalesByPeriodRow>([drifted], SALES_BY_PERIOD_HEADERS);

    expect(columns.map((column) => column.key)).toEqual([
      "bucketDate",
      "saleCount",
      "net",
      "tax",
      "gross",
      "shortfall",
    ]);
    expect(columns.at(-1)).toEqual({ key: "shortfall", header: "shortfall" });
  });

  it("covers every field of every row DTO exactly once", () => {
    // The header maps are typed `Record<keyof Row, string>`, so this is already a
    // compile-time guarantee; pinning the keys here keeps a reordering or a
    // renamed header from passing unnoticed.
    expect(Object.keys(SALES_BY_PERIOD_HEADERS)).toEqual([
      "bucketDate",
      "saleCount",
      "net",
      "tax",
      "gross",
    ]);
    expect(Object.keys(PAYMENT_METHOD_HEADERS)).toEqual([
      "method",
      "paymentCount",
      "amount",
      "shareOfGross",
    ]);
    expect(Object.keys(SALES_BY_PRODUCT_SERVICE_HEADERS)).toEqual([
      "catalogItemId",
      "name",
      "kind",
      "quantity",
      "net",
      "tax",
      "gross",
    ]);
    expect(Object.keys(CASH_SESSION_HEADERS)).toEqual([
      "sessionId",
      "registerId",
      "openedAt",
      "closedAt",
      "openingAmount",
      "expectedAmount",
      "countedAmount",
      "differenceAmount",
    ]);
    expect(Object.keys(CASH_MOVEMENT_HEADERS)).toEqual([
      "type",
      "direction",
      "movementCount",
      "signedAmount",
    ]);
    expect(Object.keys(PURCHASE_HEADERS)).toEqual([
      "purchaseId",
      "supplierId",
      "supplierName",
      "receivedAt",
      "lineCount",
      "totalQuantity",
    ]);
    expect(Object.keys(STOCK_HEADERS)).toEqual([
      "catalogItemId",
      "name",
      "kind",
      "quantity",
      "inbound",
      "outbound",
      "net",
    ]);
    expect(Object.keys(LOW_STOCK_HEADERS)).toEqual([
      "catalogItemId",
      "name",
      "quantity",
      "threshold",
      "shortfall",
    ]);
    expect(Object.keys(VACCINE_DUE_HEADERS)).toEqual([
      "patientId",
      "patientName",
      "vaccine",
      "administeredAt",
      "nextDueAt",
      "status",
    ]);
  });

  it("labels the stock balance as a snapshot, not as the period's net", () => {
    // `quantity` is a CURRENT BALANCE and `net` is the PERIOD'S FLOW. The header is
    // the only place a reader learns that, so it is asserted rather than assumed.
    const row: StockReportRow = {
      catalogItemId: "11111111-1111-4111-8111-111111111111",
      name: "Vaccine",
      kind: "MEDICATION",
      quantity: "12.500",
      inbound: "3.000",
      outbound: "1.000",
      net: "2.000",
    };
    const columns = columnsFromRows([row], STOCK_HEADERS);

    expect(columns.find((column) => column.key === "quantity")?.header).toBe("Saldo actual");
    expect(columns.find((column) => column.key === "net")?.header).toBe("Neto (período)");
  });
});

describe("the report table's cell display (UX-036)", () => {
  it("declares a format for every field of every row DTO, in the header map's own order", () => {
    // The format maps are typed by the DTO like the header maps, so the compiler
    // already refuses a missing or extra key; this pins that the two maps of one
    // report describe the same fields.
    const pairs: readonly (readonly [object, object])[] = [
      [SALES_BY_PERIOD_HEADERS, SALES_BY_PERIOD_FORMATS],
      [PAYMENT_METHOD_HEADERS, PAYMENT_METHOD_FORMATS],
      [SALES_BY_PRODUCT_SERVICE_HEADERS, SALES_BY_PRODUCT_SERVICE_FORMATS],
      [CASH_SESSION_HEADERS, CASH_SESSION_FORMATS],
      [CASH_MOVEMENT_HEADERS, CASH_MOVEMENT_FORMATS],
      [PURCHASE_HEADERS, PURCHASE_FORMATS],
      [STOCK_HEADERS, STOCK_FORMATS],
      [LOW_STOCK_HEADERS, LOW_STOCK_FORMATS],
      [VACCINE_DUE_HEADERS, VACCINE_DUE_FORMATS],
    ];
    for (const [headers, formats] of pairs) {
      expect(Object.keys(formats)).toEqual(Object.keys(headers));
    }
  });

  it("groups a decimal string textually, keeping a significant fraction and its sign", () => {
    expect(formatReportCell("1234.50", "decimal")).toBe("1.234,50");
    expect(formatReportCell("3.500", "decimal")).toBe("3,500");
    expect(formatReportCell("-1234567.00", "decimal")).toBe("-1.234.567");
    expect(formatReportCell("0.0000", "decimal")).toBe("0");
    // Beyond a float's precision: proof that no Number() round trip happens.
    expect(formatReportCell("12345678901234567.25", "decimal")).toBe("12.345.678.901.234.567,25");
  });

  it("groups counts, and prints dates and instants with the es-PY helpers", () => {
    expect(formatReportCell(1250, "count")).toBe("1.250");
    expect(formatReportCell(0, "count")).toBe("0");
    expect(formatReportCell("2026-06-10", "date")).toBe(formatEsPyDateOnly("2026-06-10"));
    expect(formatReportCell("2026-06-10T15:00:00.000Z", "instant", "America/Asuncion")).toBe(
      formatEsPyInstant("2026-06-10T15:00:00.000Z", "America/Asuncion")
    );
  });

  it("labels the pinned enum literals and leaves an unknown one visible", () => {
    expect(formatReportCell("CASH", "paymentMethod")).toBe("Efectivo");
    expect(formatReportCell("MEDICATION", "catalogKind")).toBe("Medicamento");
    expect(formatReportCell("SALE", "cashMovementType")).toBe("Venta");
    expect(formatReportCell("DECREASE", "cashMovementDirection")).toBe("Disminución");
    expect(formatReportCell("upcoming", "dueStatus")).toBe("Próxima");
    expect(formatReportCell("NEW_KIND", "catalogKind")).toBe("NEW_KIND");
  });

  it("prints no-value as an em dash and an unformatted field verbatim", () => {
    expect(formatReportCell(null, "cashMovementDirection")).toBe("—");
    expect(formatReportCell(undefined, "decimal")).toBe("—");
    // A field the API added that this client has no format for is shown raw.
    expect(formatReportCell("1234.50", undefined)).toBe("1234.50");
    expect(formatReportCell("ACME 1234.50", "text")).toBe("ACME 1234.50");
    // A value that is not a decimal string is never mangled by the decimal format.
    expect(formatReportCell("n/a", "decimal")).toBe("n/a");
  });
});
