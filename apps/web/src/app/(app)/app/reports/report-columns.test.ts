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
  type ReportColumn,
} from "./report-columns";
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
      "Gross",
      "Date",
      "Tax",
      "Net",
      "Sales",
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

    expect(columns.find((column) => column.key === "quantity")?.header).toBe("Current balance");
    expect(columns.find((column) => column.key === "net")?.header).toBe("Net (period)");
  });
});
