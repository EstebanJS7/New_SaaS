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
import {
  DEFAULT_CLINIC_TIME_ZONE,
  formatEsPyDateOnly,
  formatEsPyDecimal,
  formatEsPyInstant,
} from "@/lib/es-py-format";

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
  bucketDate: "Fecha",
  saleCount: "Ventas",
  net: "Neto",
  tax: "Impuesto",
  gross: "Bruto",
};

export const PAYMENT_METHOD_HEADERS: Readonly<Record<keyof PaymentMethodRow, string>> = {
  method: "Medio de pago",
  paymentCount: "Pagos",
  amount: "Monto",
  shareOfGross: "Proporción del bruto",
};

export const SALES_BY_PRODUCT_SERVICE_HEADERS: Readonly<
  Record<keyof SalesByProductServiceRow, string>
> = {
  catalogItemId: "ID del ítem",
  name: "Ítem",
  kind: "Tipo",
  quantity: "Cantidad",
  net: "Neto",
  tax: "Impuesto",
  gross: "Bruto",
};

export const CASH_SESSION_HEADERS: Readonly<Record<keyof CashSessionRow, string>> = {
  sessionId: "ID de sesión",
  registerId: "ID de caja",
  openedAt: "Apertura",
  closedAt: "Cierre",
  openingAmount: "Monto inicial",
  expectedAmount: "Esperado",
  countedAmount: "Contado",
  differenceAmount: "Diferencia",
};

export const CASH_MOVEMENT_HEADERS: Readonly<Record<keyof CashMovementRow, string>> = {
  type: "Tipo",
  direction: "Sentido",
  movementCount: "Movimientos",
  signedAmount: "Monto con signo",
};

export const PURCHASE_HEADERS: Readonly<Record<keyof PurchaseRow, string>> = {
  purchaseId: "ID de compra",
  supplierId: "ID de proveedor",
  supplierName: "Proveedor",
  receivedAt: "Recibida",
  lineCount: "Líneas",
  totalQuantity: "Cantidad total",
};

export const STOCK_HEADERS: Readonly<Record<keyof StockReportRow, string>> = {
  catalogItemId: "ID del ítem",
  name: "Ítem",
  kind: "Tipo",
  // The label carries the distinction the DTO insists on: this is a SNAPSHOT,
  // not the period's net, and no period narrows it.
  quantity: "Saldo actual",
  inbound: "Entradas (período)",
  outbound: "Salidas (período)",
  net: "Neto (período)",
};

export const LOW_STOCK_HEADERS: Readonly<Record<keyof LowStockReportRow, string>> = {
  catalogItemId: "ID del ítem",
  name: "Ítem",
  quantity: "Saldo actual",
  threshold: "Umbral",
  shortfall: "Faltante",
};

export const CONSULTATION_DAY_HEADERS: Readonly<Record<keyof ConsultationDayRow, string>> = {
  bucketDate: "Fecha",
  consultationCount: "Consultas",
};

export const NEW_PATIENT_DAY_HEADERS: Readonly<Record<keyof NewPatientDayRow, string>> = {
  bucketDate: "Fecha",
  count: "Pacientes",
};

export const VACCINE_DUE_HEADERS: Readonly<Record<keyof VaccineDueRow, string>> = {
  patientId: "ID del paciente",
  patientName: "Paciente",
  vaccine: "Vacuna",
  administeredAt: "Aplicada",
  nextDueAt: "Vence",
  status: "Estado",
};

export const DEWORMING_DUE_HEADERS: Readonly<Record<keyof DewormingDueRow, string>> = {
  patientId: "ID del paciente",
  patientName: "Paciente",
  product: "Producto",
  administeredAt: "Aplicada",
  nextDueAt: "Vence",
  status: "Estado",
};

// ---------------------------------------------------------------------------
// How each cell is DISPLAYED (UX-036). One map per row DTO, keyed — like the
// header maps — by the DTO's own fields, so a new field is a compile error until
// it says how it reads. Display only: the CSV export is built by the API and
// never passes through these formats.
// ---------------------------------------------------------------------------

/**
 * - `text`: printed verbatim (names, identifiers).
 * - `decimal`: a fixed-scale decimal STRING, grouped for es-PY without a
 *   `Number()` round trip ({@link formatEsPyDecimal}).
 * - `count`: an integer count, grouped for es-PY.
 * - `date`: a `YYYY-MM-DD` tenant calendar day.
 * - `instant`: an ISO 8601 instant, shown in the report's own time zone.
 * - the rest: a pinned enum literal shown with its es-PY label.
 */
export type ReportCellFormat =
  | "text"
  | "decimal"
  | "count"
  | "date"
  | "instant"
  | "paymentMethod"
  | "catalogKind"
  | "cashMovementType"
  | "cashMovementDirection"
  | "dueStatus";

export const SALES_BY_PERIOD_FORMATS: Readonly<Record<keyof SalesByPeriodRow, ReportCellFormat>> = {
  bucketDate: "date",
  saleCount: "count",
  net: "decimal",
  tax: "decimal",
  gross: "decimal",
};

export const PAYMENT_METHOD_FORMATS: Readonly<Record<keyof PaymentMethodRow, ReportCellFormat>> = {
  method: "paymentMethod",
  paymentCount: "count",
  amount: "decimal",
  shareOfGross: "decimal",
};

export const SALES_BY_PRODUCT_SERVICE_FORMATS: Readonly<
  Record<keyof SalesByProductServiceRow, ReportCellFormat>
> = {
  catalogItemId: "text",
  name: "text",
  kind: "catalogKind",
  quantity: "decimal",
  net: "decimal",
  tax: "decimal",
  gross: "decimal",
};

export const CASH_SESSION_FORMATS: Readonly<Record<keyof CashSessionRow, ReportCellFormat>> = {
  sessionId: "text",
  registerId: "text",
  openedAt: "instant",
  closedAt: "instant",
  openingAmount: "decimal",
  expectedAmount: "decimal",
  countedAmount: "decimal",
  differenceAmount: "decimal",
};

export const CASH_MOVEMENT_FORMATS: Readonly<Record<keyof CashMovementRow, ReportCellFormat>> = {
  type: "cashMovementType",
  direction: "cashMovementDirection",
  movementCount: "count",
  signedAmount: "decimal",
};

export const PURCHASE_FORMATS: Readonly<Record<keyof PurchaseRow, ReportCellFormat>> = {
  purchaseId: "text",
  supplierId: "text",
  supplierName: "text",
  receivedAt: "instant",
  lineCount: "count",
  totalQuantity: "decimal",
};

export const STOCK_FORMATS: Readonly<Record<keyof StockReportRow, ReportCellFormat>> = {
  catalogItemId: "text",
  name: "text",
  kind: "catalogKind",
  quantity: "decimal",
  inbound: "decimal",
  outbound: "decimal",
  net: "decimal",
};

export const LOW_STOCK_FORMATS: Readonly<Record<keyof LowStockReportRow, ReportCellFormat>> = {
  catalogItemId: "text",
  name: "text",
  quantity: "decimal",
  threshold: "decimal",
  shortfall: "decimal",
};

export const CONSULTATION_DAY_FORMATS: Readonly<
  Record<keyof ConsultationDayRow, ReportCellFormat>
> = {
  bucketDate: "date",
  consultationCount: "count",
};

export const NEW_PATIENT_DAY_FORMATS: Readonly<Record<keyof NewPatientDayRow, ReportCellFormat>> = {
  bucketDate: "date",
  count: "count",
};

export const VACCINE_DUE_FORMATS: Readonly<Record<keyof VaccineDueRow, ReportCellFormat>> = {
  patientId: "text",
  patientName: "text",
  vaccine: "text",
  administeredAt: "instant",
  nextDueAt: "instant",
  status: "dueStatus",
};

export const DEWORMING_DUE_FORMATS: Readonly<Record<keyof DewormingDueRow, ReportCellFormat>> = {
  patientId: "text",
  patientName: "text",
  product: "text",
  administeredAt: "instant",
  nextDueAt: "instant",
  status: "dueStatus",
};

// es-PY labels for the enum literals the rows carry. An unknown literal is shown
// verbatim rather than hidden, the same rule the header fallback follows.

const PAYMENT_METHOD_LABELS: Readonly<Record<string, string>> = {
  CASH: "Efectivo",
  CARD: "Tarjeta",
  BANK_TRANSFER: "Transferencia bancaria",
  QR: "QR",
  CHECK: "Cheque",
  OTHER: "Otro",
};

const CATALOG_KIND_LABELS: Readonly<Record<string, string>> = {
  PRODUCT: "Producto",
  SERVICE: "Servicio",
  MEDICATION: "Medicamento",
  SUPPLY: "Insumo",
};

const CASH_MOVEMENT_TYPE_LABELS: Readonly<Record<string, string>> = {
  SALE: "Venta",
  REFUND: "Devolución",
  INCOME: "Ingreso",
  EXPENSE: "Gasto",
  WITHDRAWAL: "Retiro",
  DEPOSIT: "Depósito",
  ADJUSTMENT: "Ajuste",
};

const CASH_MOVEMENT_DIRECTION_LABELS: Readonly<Record<string, string>> = {
  INCREASE: "Aumento",
  DECREASE: "Disminución",
};

const DUE_STATUS_LABELS: Readonly<Record<string, string>> = {
  overdue: "Vencida",
  upcoming: "Próxima",
};

function labelOf(labels: Readonly<Record<string, string>>, value: string): string {
  return labels[value] ?? value;
}

/**
 * One cell's display text.
 *
 * `null`/`undefined` is the API's "no value here" (a cash movement's `direction`
 * on a type-owned kind) and prints as an em dash rather than as the word "null"
 * or as a zero it is not. A value whose type does not match its format (or a
 * field this client has no format for) falls back to the raw value, so nothing
 * the API sends is hidden.
 */
export function formatReportCell(
  value: unknown,
  format: ReportCellFormat | undefined,
  timeZone: string = DEFAULT_CLINIC_TIME_ZONE
): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "number") {
    return format === "count" || format === "decimal"
      ? formatEsPyDecimal(String(value))
      : String(value);
  }
  if (typeof value !== "string") return JSON.stringify(value) ?? "";
  switch (format) {
    case "decimal":
      return formatEsPyDecimal(value);
    case "date":
      return formatEsPyDateOnly(value);
    case "instant":
      return formatEsPyInstant(value, timeZone);
    case "paymentMethod":
      return labelOf(PAYMENT_METHOD_LABELS, value);
    case "catalogKind":
      return labelOf(CATALOG_KIND_LABELS, value);
    case "cashMovementType":
      return labelOf(CASH_MOVEMENT_TYPE_LABELS, value);
    case "cashMovementDirection":
      return labelOf(CASH_MOVEMENT_DIRECTION_LABELS, value);
    case "dueStatus":
      return labelOf(DUE_STATUS_LABELS, value);
    default:
      return value;
  }
}
