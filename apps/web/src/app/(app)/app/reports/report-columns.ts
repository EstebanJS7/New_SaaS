import type {
  CashMovementRow,
  CashSessionRow,
  ConsultationDayRow,
  DewormingDueRow,
  LowStockReportRow,
  NewPatientDayRow,
  PaymentMethodRow,
  PurchaseRow,
  SalesByPeriodRow,
  SalesByProductServiceRow,
  StockReportRow,
  VaccineDueRow,
} from "./reports-api";

/**
 * The table's columns, derived from the RESPONSE TYPE ([[REP-008]]).
 *
 * The failure this module exists to prevent is a hand-maintained column list that
 * drifts from the payload: the API adds `shortfall` to a row and the table keeps
 * showing four columns, or the table keeps a header for a field the API stopped
 * sending, and nobody notices because both halves still "work".
 *
 * So the derivation has two halves, and each one is enforced where it can be:
 *
 * 1. **The header map's KEYS are the row's fields.** Every map below is declared
 *    as `Readonly<Record<keyof Row, string>>`, which is a COMPILE error the moment
 *    a field is added to, renamed in, or removed from the mirrored row DTO. The
 *    table cannot silently miss a field, and it cannot invent one.
 * 2. **The COLUMN ORDER is the payload's own key order**, read from the first row
 *    the API returned — not a second list of field names. A field the API sends
 *    that this client does not know about still reaches the table under its raw
 *    key name (see {@link columnsFromRows}) instead of being dropped, which is what
 *    makes an unexpected field visible rather than invisible.
 *
 * What this deliberately does NOT do is declare a `columns = ["a", "b", …]` array
 * next to each report: that array IS the drifting list, and it is exactly the
 * thing the type-derived map replaces.
 */

/** One rendered column: the row field it reads, and the header it prints. */
export interface ReportColumn<Row> {
  readonly key: keyof Row & string;
  readonly header: string;
}

/**
 * The columns of a set of rows.
 *
 * The key list comes from `Object.keys(rows[0])` — the response's own field order
 * — and the header from the map, falling back to the raw key so an unknown field
 * is shown rather than silently swallowed. When there are no rows there is
 * nothing to read an order from, and the map's own declaration order is used, so
 * the caller still gets the complete column set.
 */
export function columnsFromRows<Row extends object>(
  rows: readonly Row[],
  headers: Readonly<Record<keyof Row, string>>
): readonly ReportColumn<Row>[] {
  const sample: Row | undefined = rows[0];
  const keys: readonly string[] = sample === undefined ? Object.keys(headers) : Object.keys(sample);
  return keys.map((key) => {
    const typed = key as keyof Row & string;
    return { key: typed, header: headers[typed] ?? key };
  });
}

// ---------------------------------------------------------------------------
// One header map per row DTO. The keys ARE the DTO's fields.
// ---------------------------------------------------------------------------

export const SALES_BY_PERIOD_HEADERS: Readonly<Record<keyof SalesByPeriodRow, string>> = {
  bucketDate: "Date",
  saleCount: "Sales",
  net: "Net",
  tax: "Tax",
  gross: "Gross",
};

export const PAYMENT_METHOD_HEADERS: Readonly<Record<keyof PaymentMethodRow, string>> = {
  method: "Method",
  paymentCount: "Payments",
  amount: "Amount",
  shareOfGross: "Share of gross",
};

export const SALES_BY_PRODUCT_SERVICE_HEADERS: Readonly<
  Record<keyof SalesByProductServiceRow, string>
> = {
  catalogItemId: "Item id",
  name: "Item",
  kind: "Kind",
  quantity: "Quantity",
  net: "Net",
  tax: "Tax",
  gross: "Gross",
};

export const CASH_SESSION_HEADERS: Readonly<Record<keyof CashSessionRow, string>> = {
  sessionId: "Session id",
  registerId: "Register id",
  openedAt: "Opened",
  closedAt: "Closed",
  openingAmount: "Opening",
  expectedAmount: "Expected",
  countedAmount: "Counted",
  differenceAmount: "Difference",
};

export const CASH_MOVEMENT_HEADERS: Readonly<Record<keyof CashMovementRow, string>> = {
  type: "Type",
  direction: "Direction",
  movementCount: "Movements",
  signedAmount: "Signed amount",
};

export const PURCHASE_HEADERS: Readonly<Record<keyof PurchaseRow, string>> = {
  purchaseId: "Purchase id",
  supplierId: "Supplier id",
  supplierName: "Supplier",
  receivedAt: "Received",
  lineCount: "Lines",
  totalQuantity: "Total quantity",
};

export const STOCK_HEADERS: Readonly<Record<keyof StockReportRow, string>> = {
  catalogItemId: "Item id",
  name: "Item",
  kind: "Kind",
  // The label carries the distinction the DTO insists on: this is a SNAPSHOT,
  // not the period's net, and no period narrows it.
  quantity: "Current balance",
  inbound: "In (period)",
  outbound: "Out (period)",
  net: "Net (period)",
};

export const LOW_STOCK_HEADERS: Readonly<Record<keyof LowStockReportRow, string>> = {
  catalogItemId: "Item id",
  name: "Item",
  quantity: "Current balance",
  threshold: "Threshold",
  shortfall: "Shortfall",
};

export const CONSULTATION_DAY_HEADERS: Readonly<Record<keyof ConsultationDayRow, string>> = {
  bucketDate: "Date",
  consultationCount: "Consultations",
};

export const NEW_PATIENT_DAY_HEADERS: Readonly<Record<keyof NewPatientDayRow, string>> = {
  bucketDate: "Date",
  count: "Patients",
};

export const VACCINE_DUE_HEADERS: Readonly<Record<keyof VaccineDueRow, string>> = {
  patientId: "Patient id",
  patientName: "Patient",
  vaccine: "Vaccine",
  administeredAt: "Administered",
  nextDueAt: "Due",
  status: "Status",
};

export const DEWORMING_DUE_HEADERS: Readonly<Record<keyof DewormingDueRow, string>> = {
  patientId: "Patient id",
  patientName: "Patient",
  product: "Product",
  administeredAt: "Administered",
  nextDueAt: "Due",
  status: "Status",
};
