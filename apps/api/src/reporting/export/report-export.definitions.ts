import { DomainError, TENANT_TIME_ZONE } from "@newsaas/shared";
import {
  REPORT_DUE_QUERY_INVALID_MESSAGE,
  REPORT_PERIOD_QUERY_INVALID_MESSAGE,
  REPORT_QUERY_NOT_ALLOWED_MESSAGE,
  reportDueQuerySchema,
  reportNoQuerySchema,
  reportPeriodQuerySchema,
  type CashMovementRowDto,
  type CashSessionRowDto,
  type ConsultationDayRowDto,
  type DewormingDueRowDto,
  type LowStockReportRowDto,
  type NewPatientDayRowDto,
  type PaymentMethodRowDto,
  type PurchaseRowDto,
  type ReportDueQuery,
  type ReportPeriodDto,
  type ReportPeriodQuery,
  type SalesByPeriodRowDto,
  type SalesByProductServiceRowDto,
  type StockReportRowDto,
  type VaccineDueRowDto,
} from "../reporting.dto.js";
import { tenantCalendarDate } from "../report.period.js";
import type { ReportingService } from "../reporting.service.js";
import { renderCsv, type CsvColumn, type CsvValue } from "./csv.js";

/**
 * The export contract of every report the epic ships (EPIC-18 REP-007,
 * [[DEC-066]]) — ONE table, keyed by the report code.
 *
 * ## One route, twelve reports
 *
 * `GET /reports/:reportCode/export` is a single route with a CLOSED code
 * allowlist ({@link REPORT_EXPORT_CODES}) rather than twelve near-identical
 * handlers. Twelve handlers would be twelve chances for one of them to accept a
 * query shape its report does not have (`?from=` on `low-stock`, `?horizonDays=`
 * on `sales-by-period`) and twelve places to forget the RBAC pin.
 *
 * Each entry owns THREE things, together, so they cannot drift apart:
 *
 * 1. **The query contract.** A period report parses with the shipped
 *    `reportPeriodQuerySchema`, a due report with the shipped
 *    `reportDueQuerySchema`, and `low-stock` — a current-state view — refuses
 *    every key. The SHAPE schemas are the ones the report routes use; the period
 *    and horizon SEMANTICS stay in `report.period.ts` / `report.horizon.ts`
 *    because the report's own service method resolves them. There is no third
 *    period or horizon contract here, and no second parser of either.
 * 2. **The columns**, in the order the report returns them, which is the emitted
 *    header row. A column reads its report field and nothing else, so the value
 *    in the file IS the value in the response — money and quantities arrive as
 *    the report's fixed-scale decimal string and are never re-formatted.
 * 3. **The filename**: the code plus its resolved range — `<code>-<from>-<to>`,
 *    `<code>-<asOfDate>`, or for `low-stock` the tenant's as-of date. ASCII
 *    only, no spaces, and no caller input anywhere in it.
 *
 * ## One query, two renderings
 *
 * {@link ReportExportDefinition.load} calls the report's OWN service method —
 * the same one the JSON route calls — and projects its rows. The export never
 * issues a query of its own: the Story's invariant is that export rows and
 * report rows are the same rows for the same arguments, and a second query would
 * make that agreement unverifiable. The suite asserts the two agree for a real
 * period, field for field.
 *
 * ## Data classification (PRD §41) and logging
 *
 * The file is INTERNAL tenant data: aggregates of the tenant's own confirmed
 * sales, cash ledger, received purchases, inventory, closed consultations and
 * registered patients. The ONE exception is the two due reports
 * (`vaccines-due`, `deworming-due`), which carry `Patient.name` —
 * CONFIDENTIAL — under the same permission that guards reading them; the
 * portal never reaches this surface.
 *
 * No clinical free text is exported because no report READ in this epic loads
 * any: `internalNotes` is RESTRICTED and the reports never select it, and
 * `reasonForVisit`, `anamnesis`, `diagnosis`, `treatmentPlan` and
 * `clientSummary` are not selected either. The export inherits that boundary
 * rather than re-deciding it, which is exactly why it is a projection of the
 * report instead of a query.
 *
 * **No row content is ever logged** — not on success, not on a refusal. The
 * export logs nothing at all: the request is a read, reads are not audited in
 * this system, and a line of CSV in a log file would be the one place a
 * CONFIDENTIAL patient name escaped the tenant's own request.
 */

/**
 * The CLOSED set of exportable report codes ([[REP-002]]–[[REP-006]]), in the
 * order the reports were delivered.
 *
 * This tuple is the allowlist. An unknown code is a `404`, never a fallback: a
 * default would mean the surface answers for a report that does not exist.
 */
export const REPORT_EXPORT_CODES = [
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
] as const;

export type ReportExportCode = (typeof REPORT_EXPORT_CODES)[number];

/** The `404` message for a code outside {@link REPORT_EXPORT_CODES}. */
export const REPORT_EXPORT_UNKNOWN_CODE_MESSAGE = "The report code is not exportable.";

/** True when the code names a report this surface can export. */
export function isReportExportCode(value: string): value is ReportExportCode {
  return (REPORT_EXPORT_CODES as readonly string[]).includes(value);
}

/**
 * Which query a report's export accepts.
 *
 * Three values and no fourth: a report either has a period, or a forward
 * horizon, or no query at all. Reporting one of the two shapes when the report
 * does not have it is a `400`, not a silently ignored key — the same rule the
 * JSON routes apply.
 */
export type ReportExportQueryContract = "period" | "due" | "none";

/**
 * Parses the period SHAPE with the shipped `reportPeriodQuerySchema`, refusing
 * with the same stable message the report route refuses with.
 *
 * The controller's parser is private to it and the two must not become two
 * opinions about the same contract, so this module parses with the SAME schema
 * and the SAME message constant. What it deliberately does NOT do is resolve the
 * period: `resolveReportPeriod` runs inside the report's service method, which
 * is why the export cannot answer a different range than the report.
 */
export function parseReportExportPeriodQuery(query: unknown): ReportPeriodQuery {
  const parsed = reportPeriodQuerySchema.safeParse(query);
  if (!parsed.success) {
    throw new DomainError("VALIDATION_FAILED", REPORT_PERIOD_QUERY_INVALID_MESSAGE);
  }
  return parsed.data;
}

/** The same for the due reports' horizon shape: one schema, one stable message. */
export function parseReportExportDueQuery(query: unknown): ReportDueQuery {
  const parsed = reportDueQuerySchema.safeParse(query);
  if (!parsed.success) {
    throw new DomainError("VALIDATION_FAILED", REPORT_DUE_QUERY_INVALID_MESSAGE);
  }
  return parsed.data;
}

/**
 * Refuses EVERY query key for a current-state report, through the shipped
 * `reportNoQuerySchema`.
 *
 * `?from=2026-06-01` on a snapshot report is a caller believing a period was
 * applied, which is why it is a `400` here exactly as it is on
 * `GET /reports/low-stock`.
 */
export function assertNoReportExportQuery(query: unknown): void {
  const parsed = reportNoQuerySchema.safeParse(query);
  if (!parsed.success) {
    throw new DomainError("VALIDATION_FAILED", REPORT_QUERY_NOT_ALLOWED_MESSAGE);
  }
}

/** Everything {@link ReportExportDefinition.load} needs. */
export interface ReportExportRenderContext {
  /** The reporting application service — the report's own method is called on it. */
  readonly reports: ReportingService;
  /** The route's raw query, PARSED by the entry that owns the contract. */
  readonly query: unknown;
  /** The tenant's "now", used only by the report that carries no dates of its own. */
  readonly now: Date;
}

/**
 * One loaded export: the filename, the DATA row count the cap applies to, and a
 * lazy renderer.
 *
 * `toCsv` is a function rather than a string ON PURPOSE: the row cap must refuse
 * BEFORE a single byte is serialized, so "no partial file" is a property of the
 * code rather than of a caller remembering to check first.
 */
export interface LoadedReportExport {
  /** ASCII only, no spaces, no caller input. Includes the `.csv` suffix. */
  readonly filename: string;
  /** The number of DATA rows — the header is not counted. */
  readonly rowCount: number;
  /** Serializes the rows. Called only once the row cap has been satisfied. */
  readonly toCsv: () => string;
}

/** One entry of {@link REPORT_EXPORT_DEFINITIONS}. */
export interface ReportExportDefinition {
  readonly code: ReportExportCode;
  readonly queryContract: ReportExportQueryContract;
  /** The documented column order, which is also the emitted header row. */
  readonly headers: readonly string[];
  /** Calls the report's service method once and projects its rows to CSV. */
  readonly load: (context: ReportExportRenderContext) => Promise<LoadedReportExport>;
}

/**
 * Declares a column per `[header, reader]` pair.
 *
 * The reader's return type is {@link CsvValue}, so a column that points at a
 * nested object, a `Date` or a `Decimal` fails to COMPILE rather than rendering
 * `[object Object]` — which is the only way this hand-written projection stays
 * honest across twelve reports.
 */
function columnsOf<Row>(
  entries: readonly (readonly [string, (row: Row) => CsvValue])[]
): readonly CsvColumn<Row>[] {
  return entries.map(([header, value]) => ({ header, value }));
}

/**
 * A PERIOD report's export: the period shape, {@link renderCsv} over the rows,
 * and a filename carrying the resolved `from`/`to` dates.
 *
 * The dates come from the response's own `period` echo — the range the report
 * ACTUALLY aggregated — and never from the caller's query string: a preset query
 * carries no dates at all, and a caller-supplied range must not be able to
 * disagree with what was aggregated.
 */
function periodReportExport<Row>(
  code: ReportExportCode,
  columns: readonly CsvColumn<Row>[],
  load: (
    reports: ReportingService,
    query: ReportPeriodQuery
  ) => Promise<{ readonly period: ReportPeriodDto; readonly rows: readonly Row[] }>
): ReportExportDefinition {
  return {
    code,
    queryContract: "period",
    headers: columns.map((column) => column.header),
    load: async ({ reports, query }) => {
      const response = await load(reports, parseReportExportPeriodQuery(query));
      return {
        filename: `${code}-${response.period.fromDate}-${response.period.toDate}.csv`,
        rowCount: response.rows.length,
        toCsv: () => renderCsv(columns, response.rows),
      };
    },
  };
}

/**
 * A DUE report's export: the horizon shape, the rows, and a filename carrying
 * the resolved as-of date the overdue/upcoming split was made against.
 *
 * A due report has no period, so there is no `<from>-<to>` to name it by; the
 * as-of date is the one date the response echoes, and it is resolved in the
 * tenant zone by `report.horizon.ts`, not here.
 */
function dueReportExport<Row>(
  code: ReportExportCode,
  columns: readonly CsvColumn<Row>[],
  load: (
    reports: ReportingService,
    query: ReportDueQuery
  ) => Promise<{ readonly asOfDate: string; readonly rows: readonly Row[] }>
): ReportExportDefinition {
  return {
    code,
    queryContract: "due",
    headers: columns.map((column) => column.header),
    load: async ({ reports, query }) => {
      const response = await load(reports, parseReportExportDueQuery(query));
      return {
        filename: `${code}-${response.asOfDate}.csv`,
        rowCount: response.rows.length,
        toCsv: () => renderCsv(columns, response.rows),
      };
    },
  };
}

/**
 * A CURRENT-STATE report's export: NO query at all, the rows, and a filename
 * carrying the tenant's as-of date.
 *
 * The refusal runs BEFORE the service call, so an out-of-contract query never
 * reaches a read. There is no resolved period and no response date to name the
 * file after, so the date is today in `TENANT_TIME_ZONE` — the same calendar day
 * the due reports pivot on, from the same helper — and it is a fact about the
 * tenant, never about the caller's input.
 */
function currentStateReportExport<Row>(
  code: ReportExportCode,
  columns: readonly CsvColumn<Row>[],
  load: (reports: ReportingService) => Promise<{ readonly rows: readonly Row[] }>
): ReportExportDefinition {
  return {
    code,
    queryContract: "none",
    headers: columns.map((column) => column.header),
    load: async ({ reports, query, now }) => {
      assertNoReportExportQuery(query);
      const response = await load(reports);
      return {
        filename: `${code}-${tenantCalendarDate(now, TENANT_TIME_ZONE)}.csv`,
        rowCount: response.rows.length,
        toCsv: () => renderCsv(columns, response.rows),
      };
    },
  };
}

/** `GET /reports/sales-by-period` — the local-day bucket series. */
const SALES_BY_PERIOD_COLUMNS = columnsOf<SalesByPeriodRowDto>([
  ["bucketDate", (row) => row.bucketDate],
  ["saleCount", (row) => row.saleCount],
  ["net", (row) => row.net],
  ["tax", (row) => row.tax],
  ["gross", (row) => row.gross],
]);

/** `GET /reports/payment-methods` — how the money arrived. */
const PAYMENT_METHOD_COLUMNS = columnsOf<PaymentMethodRowDto>([
  ["method", (row) => row.method],
  ["paymentCount", (row) => row.paymentCount],
  ["amount", (row) => row.amount],
  ["shareOfGross", (row) => row.shareOfGross],
]);

/** `GET /reports/sales-by-product-service` — revenue per catalog item. */
const SALES_BY_PRODUCT_SERVICE_COLUMNS = columnsOf<SalesByProductServiceRowDto>([
  ["catalogItemId", (row) => row.catalogItemId],
  ["name", (row) => row.name],
  ["kind", (row) => row.kind],
  ["quantity", (row) => row.quantity],
  ["net", (row) => row.net],
  ["tax", (row) => row.tax],
  ["gross", (row) => row.gross],
]);

/** `GET /reports/cash-sessions` — the drawer results closed in the period. */
const CASH_SESSION_COLUMNS = columnsOf<CashSessionRowDto>([
  ["sessionId", (row) => row.sessionId],
  ["registerId", (row) => row.registerId],
  ["openedAt", (row) => row.openedAt],
  ["closedAt", (row) => row.closedAt],
  ["openingAmount", (row) => row.openingAmount],
  ["expectedAmount", (row) => row.expectedAmount],
  ["countedAmount", (row) => row.countedAmount],
  ["differenceAmount", (row) => row.differenceAmount],
]);

/**
 * `GET /reports/cash-movements` — the period's movements by `(type, direction)`.
 *
 * `direction` is `null` for every kind that owns its sign, and a `null` renders
 * as an EMPTY field: the file says the report found no direction, never the word
 * `null`.
 */
const CASH_MOVEMENT_COLUMNS = columnsOf<CashMovementRowDto>([
  ["type", (row) => row.type],
  ["direction", (row) => row.direction],
  ["movementCount", (row) => row.movementCount],
  ["signedAmount", (row) => row.signedAmount],
]);

/** `GET /reports/purchases` — the receipts booked in the period. */
const PURCHASE_COLUMNS = columnsOf<PurchaseRowDto>([
  ["purchaseId", (row) => row.purchaseId],
  ["supplierId", (row) => row.supplierId],
  ["supplierName", (row) => row.supplierName],
  ["receivedAt", (row) => row.receivedAt],
  ["lineCount", (row) => row.lineCount],
  ["totalQuantity", (row) => row.totalQuantity],
]);

/** `GET /reports/stock` — the current balance plus the period's flow, per item. */
const STOCK_COLUMNS = columnsOf<StockReportRowDto>([
  ["catalogItemId", (row) => row.catalogItemId],
  ["name", (row) => row.name],
  ["kind", (row) => row.kind],
  ["quantity", (row) => row.quantity],
  ["inbound", (row) => row.inbound],
  ["outbound", (row) => row.outbound],
  ["net", (row) => row.net],
]);

/** `GET /reports/low-stock` — the items at or below their own threshold. */
const LOW_STOCK_COLUMNS = columnsOf<LowStockReportRowDto>([
  ["catalogItemId", (row) => row.catalogItemId],
  ["name", (row) => row.name],
  ["quantity", (row) => row.quantity],
  ["threshold", (row) => row.threshold],
  ["shortfall", (row) => row.shortfall],
]);

/** `GET /reports/consultations` — consultations closed per local day. */
const CONSULTATION_COLUMNS = columnsOf<ConsultationDayRowDto>([
  ["bucketDate", (row) => row.bucketDate],
  ["consultationCount", (row) => row.consultationCount],
]);

/** `GET /reports/new-patients` — patients registered per local day. */
const NEW_PATIENT_COLUMNS = columnsOf<NewPatientDayRowDto>([
  ["bucketDate", (row) => row.bucketDate],
  ["count", (row) => row.count],
]);

/** `GET /reports/vaccines-due` — `patientName` is CONFIDENTIAL; nothing clinical is carried. */
const VACCINE_DUE_COLUMNS = columnsOf<VaccineDueRowDto>([
  ["patientId", (row) => row.patientId],
  ["patientName", (row) => row.patientName],
  ["vaccine", (row) => row.vaccine],
  ["administeredAt", (row) => row.administeredAt],
  ["nextDueAt", (row) => row.nextDueAt],
  ["status", (row) => row.status],
]);

/** `GET /reports/deworming-due` — as above, over `clinical_deworming.product`. */
const DEWORMING_DUE_COLUMNS = columnsOf<DewormingDueRowDto>([
  ["patientId", (row) => row.patientId],
  ["patientName", (row) => row.patientName],
  ["product", (row) => row.product],
  ["administeredAt", (row) => row.administeredAt],
  ["nextDueAt", (row) => row.nextDueAt],
  ["status", (row) => row.status],
]);

/**
 * THE TABLE. Every exportable report, its query contract, its columns and its
 * filename, in one place.
 *
 * The `load` closures call the reporting service's PUBLIC methods — the same
 * ones `ReportingController` calls — so "the export is a rendering of the
 * report, never a second query" is a property of the wiring, not a convention.
 */
export const REPORT_EXPORT_DEFINITIONS: Readonly<Record<ReportExportCode, ReportExportDefinition>> =
  {
    "sales-by-period": periodReportExport(
      "sales-by-period",
      SALES_BY_PERIOD_COLUMNS,
      (reports, query) => reports.salesByPeriod(query)
    ),
    "payment-methods": periodReportExport(
      "payment-methods",
      PAYMENT_METHOD_COLUMNS,
      (reports, query) => reports.paymentMethods(query)
    ),
    "sales-by-product-service": periodReportExport(
      "sales-by-product-service",
      SALES_BY_PRODUCT_SERVICE_COLUMNS,
      (reports, query) => reports.salesByProductService(query)
    ),
    "cash-sessions": periodReportExport("cash-sessions", CASH_SESSION_COLUMNS, (reports, query) =>
      reports.cashSessions(query)
    ),
    "cash-movements": periodReportExport(
      "cash-movements",
      CASH_MOVEMENT_COLUMNS,
      (reports, query) => reports.cashMovements(query)
    ),
    purchases: periodReportExport("purchases", PURCHASE_COLUMNS, (reports, query) =>
      reports.purchases(query)
    ),
    stock: periodReportExport("stock", STOCK_COLUMNS, (reports, query) => reports.stock(query)),
    // `low-stock` is the ONE report with no period and no horizon: a snapshot of
    // the projection, named after the tenant's own as-of date.
    "low-stock": currentStateReportExport("low-stock", LOW_STOCK_COLUMNS, (reports) =>
      reports.lowStock()
    ),
    consultations: periodReportExport("consultations", CONSULTATION_COLUMNS, (reports, query) =>
      reports.consultations(query)
    ),
    "new-patients": periodReportExport("new-patients", NEW_PATIENT_COLUMNS, (reports, query) =>
      reports.newPatients(query)
    ),
    "vaccines-due": dueReportExport("vaccines-due", VACCINE_DUE_COLUMNS, (reports, query) =>
      reports.vaccinesDue(query)
    ),
    "deworming-due": dueReportExport("deworming-due", DEWORMING_DUE_COLUMNS, (reports, query) =>
      reports.dewormingDue(query)
    ),
  };

/**
 * Resolves the definition for a route parameter, or refuses with the stable
 * `404` message.
 *
 * Resolution happens AFTER the permission re-assertion and BEFORE any data
 * access, so an unknown code costs no query and reveals nothing about which
 * codes exist beyond its own refusal.
 */
export function reportExportDefinitionFor(reportCode: string): ReportExportDefinition {
  if (!isReportExportCode(reportCode)) {
    throw new DomainError("NOT_FOUND", REPORT_EXPORT_UNKNOWN_CODE_MESSAGE);
  }
  return REPORT_EXPORT_DEFINITIONS[reportCode];
}
