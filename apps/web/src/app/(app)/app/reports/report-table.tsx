"use client";

import type { JSX } from "react";
import { DEFAULT_CLINIC_TIME_ZONE } from "@/lib/es-py-format";
import type { ReportResponse } from "./reports-api";
import {
  columnsFromRows,
  formatReportCell,
  CASH_MOVEMENT_FORMATS,
  CASH_MOVEMENT_HEADERS,
  CASH_SESSION_FORMATS,
  CASH_SESSION_HEADERS,
  CONSULTATION_DAY_FORMATS,
  CONSULTATION_DAY_HEADERS,
  DEWORMING_DUE_FORMATS,
  DEWORMING_DUE_HEADERS,
  LOW_STOCK_FORMATS,
  LOW_STOCK_HEADERS,
  NEW_PATIENT_DAY_FORMATS,
  NEW_PATIENT_DAY_HEADERS,
  PAYMENT_METHOD_FORMATS,
  PAYMENT_METHOD_HEADERS,
  PURCHASE_FORMATS,
  PURCHASE_HEADERS,
  SALES_BY_PERIOD_FORMATS,
  SALES_BY_PERIOD_HEADERS,
  SALES_BY_PRODUCT_SERVICE_FORMATS,
  SALES_BY_PRODUCT_SERVICE_HEADERS,
  STOCK_FORMATS,
  STOCK_HEADERS,
  VACCINE_DUE_FORMATS,
  VACCINE_DUE_HEADERS,
  type ReportCellFormat,
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
  const timeZone = reportTimeZone(response);
  switch (response.report) {
    case "sales-by-period":
      return (
        <RowsTable
          rows={response.rows}
          headers={SALES_BY_PERIOD_HEADERS}
          formats={SALES_BY_PERIOD_FORMATS}
          timeZone={timeZone}
        />
      );
    case "payment-methods":
      return (
        <RowsTable
          rows={response.rows}
          headers={PAYMENT_METHOD_HEADERS}
          formats={PAYMENT_METHOD_FORMATS}
          timeZone={timeZone}
        />
      );
    case "sales-by-product-service":
      return (
        <RowsTable
          rows={response.rows}
          headers={SALES_BY_PRODUCT_SERVICE_HEADERS}
          formats={SALES_BY_PRODUCT_SERVICE_FORMATS}
          timeZone={timeZone}
        />
      );
    case "cash-sessions":
      return (
        <RowsTable
          rows={response.rows}
          headers={CASH_SESSION_HEADERS}
          formats={CASH_SESSION_FORMATS}
          timeZone={timeZone}
        />
      );
    case "cash-movements":
      return (
        <RowsTable
          rows={response.rows}
          headers={CASH_MOVEMENT_HEADERS}
          formats={CASH_MOVEMENT_FORMATS}
          timeZone={timeZone}
        />
      );
    case "purchases":
      return (
        <RowsTable
          rows={response.rows}
          headers={PURCHASE_HEADERS}
          formats={PURCHASE_FORMATS}
          timeZone={timeZone}
        />
      );
    case "stock":
      return (
        <RowsTable
          rows={response.rows}
          headers={STOCK_HEADERS}
          formats={STOCK_FORMATS}
          timeZone={timeZone}
        />
      );
    case "low-stock":
      return (
        <RowsTable
          rows={response.rows}
          headers={LOW_STOCK_HEADERS}
          formats={LOW_STOCK_FORMATS}
          timeZone={timeZone}
        />
      );
    case "consultations":
      return (
        <RowsTable
          rows={response.rows}
          headers={CONSULTATION_DAY_HEADERS}
          formats={CONSULTATION_DAY_FORMATS}
          timeZone={timeZone}
        />
      );
    case "new-patients":
      return (
        <RowsTable
          rows={response.rows}
          headers={NEW_PATIENT_DAY_HEADERS}
          formats={NEW_PATIENT_DAY_FORMATS}
          timeZone={timeZone}
        />
      );
    case "vaccines-due":
      return (
        <RowsTable
          rows={response.rows}
          headers={VACCINE_DUE_HEADERS}
          formats={VACCINE_DUE_FORMATS}
          timeZone={timeZone}
        />
      );
    case "deworming-due":
      return (
        <RowsTable
          rows={response.rows}
          headers={DEWORMING_DUE_HEADERS}
          formats={DEWORMING_DUE_FORMATS}
          timeZone={timeZone}
        />
      );
  }
}

/**
 * The zone the API resolved the report in, so an instant cell reads on the same
 * local day the API used to bucket or classify it. `low-stock` carries no zone
 * and no instant; the clinic default only keeps the signature total.
 */
function reportTimeZone(response: ReportResponse): string {
  if ("period" in response) return response.period.timeZone;
  if ("timeZone" in response) return response.timeZone;
  return DEFAULT_CLINIC_TIME_ZONE;
}

/**
 * One report's rows. Each cell is DISPLAYED through its column's format
 * ({@link formatReportCell}): decimal strings are grouped for es-PY textually,
 * never through `Number()`, so `"1234.50"` reads `1.234,50` and keeps its scale.
 * The CSV export is the API's own file and never passes through here.
 */
function RowsTable<Row extends object>({
  rows,
  headers,
  formats,
  timeZone,
}: {
  readonly rows: readonly Row[];
  readonly headers: Readonly<Record<keyof Row, string>>;
  readonly formats: Readonly<Record<keyof Row, ReportCellFormat>>;
  readonly timeZone: string;
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
                  {formatReportCell(row[column.key], formatOf(formats, column.key), timeZone)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The column's format, or none for a field this client has no map entry for. */
function formatOf<Row extends object>(
  formats: Readonly<Record<keyof Row, ReportCellFormat>>,
  key: keyof Row & string
): ReportCellFormat | undefined {
  // `columnsFromRows` passes through unknown payload keys under their raw name,
  // so the typed map may genuinely lack this key at runtime.
  return Object.prototype.hasOwnProperty.call(formats, key) ? formats[key] : undefined;
}
