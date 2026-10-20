"use client";

import type { JSX } from "react";
import type { ReportResponse } from "./reports-api";
import {
  columnsFromRows,
  CASH_MOVEMENT_HEADERS,
  CASH_SESSION_HEADERS,
  CONSULTATION_DAY_HEADERS,
  DEWORMING_DUE_HEADERS,
  LOW_STOCK_HEADERS,
  NEW_PATIENT_DAY_HEADERS,
  PAYMENT_METHOD_HEADERS,
  PURCHASE_HEADERS,
  SALES_BY_PERIOD_HEADERS,
  SALES_BY_PRODUCT_SERVICE_HEADERS,
  STOCK_HEADERS,
  VACCINE_DUE_HEADERS,
  type ReportColumn,
} from "./report-columns";

/**
 * One report's rows, as a table ([[REP-008]]).
 *
 * The switch below is EXHAUSTIVE over the twelve responses: `ReportResponse` is a
 * union discriminated by `report`, and every arm hands the row type it narrows to
 * to the same generic table with that row type's header map. Adding a thirteenth
 * report is therefore a compile error here until its rows have a table, and an
 * arm cannot borrow another report's header map — `columnsFromRows` would reject
 * the missing fields.
 *
 * The columns themselves come from the PAYLOAD (see `report-columns.ts`): the
 * order is the API's own field order, and the headers are the typed maps. Nothing
 * here re-declares which fields a report has.
 */
export function ReportTable({ response }: { readonly response: ReportResponse }): JSX.Element {
  switch (response.report) {
    case "sales-by-period":
      return <RowsTable rows={response.rows} headers={SALES_BY_PERIOD_HEADERS} />;
    case "payment-methods":
      return <RowsTable rows={response.rows} headers={PAYMENT_METHOD_HEADERS} />;
    case "sales-by-product-service":
      return <RowsTable rows={response.rows} headers={SALES_BY_PRODUCT_SERVICE_HEADERS} />;
    case "cash-sessions":
      return <RowsTable rows={response.rows} headers={CASH_SESSION_HEADERS} />;
    case "cash-movements":
      return <RowsTable rows={response.rows} headers={CASH_MOVEMENT_HEADERS} />;
    case "purchases":
      return <RowsTable rows={response.rows} headers={PURCHASE_HEADERS} />;
    case "stock":
      return <RowsTable rows={response.rows} headers={STOCK_HEADERS} />;
    case "low-stock":
      return <RowsTable rows={response.rows} headers={LOW_STOCK_HEADERS} />;
    case "consultations":
      return <RowsTable rows={response.rows} headers={CONSULTATION_DAY_HEADERS} />;
    case "new-patients":
      return <RowsTable rows={response.rows} headers={NEW_PATIENT_DAY_HEADERS} />;
    case "vaccines-due":
      return <RowsTable rows={response.rows} headers={VACCINE_DUE_HEADERS} />;
    case "deworming-due":
      return <RowsTable rows={response.rows} headers={DEWORMING_DUE_HEADERS} />;
  }
}

/**
 * One cell, rendered from the raw value.
 *
 * A STRING is printed verbatim, which is the whole formatting rule of this
 * surface: every money and quantity value arrives as a fixed-scale decimal string
 * (`"1234.50"`, `"3.500"`) and `Number()` would turn it into `1234.5` — a
 * different value, at a scale the report never chose. A NUMBER is a count
 * (`saleCount`, `paymentCount`) and may be printed as one. `null` is the API's
 * "no value here" (a cash movement's `direction` on a type-owned kind) and prints
 * as an em dash rather than as the word "null" or as a zero it is not.
 */
function renderCell(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return JSON.stringify(value) ?? "";
}

function RowsTable<Row extends object>({
  rows,
  headers,
}: {
  readonly rows: readonly Row[];
  readonly headers: Readonly<Record<keyof Row, string>>;
}): JSX.Element {
  const columns: readonly ReportColumn<Row>[] = columnsFromRows(rows, headers);
  return (
    <div data-testid="report-table" className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead className="bg-secondary text-secondary-foreground">
          <tr>
            {columns.map((column) => (
              <th key={column.key} scope="col" className="px-3 py-2 text-left font-medium">
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            // The rows have no shared identifier across the twelve reports (a day
            // bucket has a date, a cash session has an id, a payment roll-up has
            // neither), so the position is the key — the table is re-rendered as a
            // whole whenever the query changes.
            <tr key={rowIndex} data-testid="report-row" className="border-t border-border">
              {columns.map((column) => (
                <td
                  key={column.key}
                  data-testid={`report-cell-${column.key}`}
                  className="whitespace-nowrap px-3 py-2 text-foreground"
                >
                  {renderCell(row[column.key])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
