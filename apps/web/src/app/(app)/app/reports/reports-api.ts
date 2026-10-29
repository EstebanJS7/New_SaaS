import type { ReportCode } from "@/app/api/reports/report-codes";
import { reportQueryShapeOf } from "@/app/api/reports/report-codes";

/**
 * The staff reporting client ([[REP-008]], [[DEC-062]]).
 *
 * Deliberately NOT a `"use client"` module: it holds no component and no hook,
 * only DTO mirrors and pure functions, so both the server page that validates a
 * report code and the client surfaces that render one can import it. A directive
 * here would turn every export into a client reference and break the server
 * import.
 *
 * ## What this module is
 *
 * A mirror of the API's reporting response contract
 * (`apps/api/src/reporting/reporting.dto.ts`) plus the one place the web app
 * turns a control selection into a query string. There is no shared package
 * between `apps/api` and `apps/web`, so the DTOs are restated here exactly as
 * `fiscal-api.ts` restates the fiscal document — a mirror is cheaper than a
 * package and honest as long as it is a MIRROR.
 *
 * ## The three rules this file exists to keep
 *
 * 1. **Money and quantities are strings, and they stay strings.** Every decimal
 *    projection is a fixed-scale exact string (`"1234.50"`, `"3.500"`) and it is
 *    typed, transported and rendered as that string. Nothing in the web app
 *    calls `Number()` on one: `0.1 + 0.2` cannot appear in a report, and neither
 *    can `1234.5` standing in for `"1234.50"`. A COUNT (`saleCount`,
 *    `paymentCount`, `consultationCount`) is a number and is typed as one.
 * 2. **The UI never computes a total.** Every number rendered came from the API;
 *    summing rows here would be a second aggregation path, which is the one thing
 *    [[DEC-062]] refuses.
 * 3. **The tenant comes from the session.** No request built here carries a
 *    tenant id — the BFF proxy refuses one, and the API resolves the tenant from
 *    the forwarded cookie.
 */

// ---------------------------------------------------------------------------
// Period and horizon contracts (mirrors report.period.ts / report.horizon.ts).
// ---------------------------------------------------------------------------

/**
 * The five accepted presets, in the order the control renders them.
 *
 * MIRROR of `REPORT_PERIOD_PRESETS` in `apps/api/src/reporting/report.period.ts`,
 * which OWNS the list ([[DEC-063]]). An unknown token is a `400` there, so this
 * copy is closed on purpose: the select cannot offer a preset the API refuses.
 */
export const REPORT_PERIOD_PRESETS = [
  "today",
  "last7Days",
  "last30Days",
  "thisMonth",
  "lastMonth",
] as const;

export type ReportPeriodPreset = (typeof REPORT_PERIOD_PRESETS)[number];

/** Human labels for the five presets. Presentation only; never sent. */
export const REPORT_PERIOD_PRESET_LABELS: Readonly<Record<ReportPeriodPreset, string>> = {
  today: "Hoy",
  last7Days: "Últimos 7 días",
  last30Days: "Últimos 30 días",
  thisMonth: "Este mes",
  lastMonth: "Mes anterior",
};

/**
 * The preset a period report opens on.
 *
 * `last30Days` and not `today`: a report that opens empty teaches nothing, and a
 * month is the shortest window that has a shape. It is a UI default only — the
 * preset still travels to the API, which resolves it.
 */
export const REPORT_DEFAULT_PRESET: ReportPeriodPreset = "last30Days";

/** MIRROR of `REPORT_HORIZON_DEFAULT_DAYS` / `_MIN_DAYS` / `_MAX_DAYS` ([[DEC-065]]). */
export const REPORT_HORIZON_DEFAULT_DAYS = 30;
export const REPORT_HORIZON_MIN_DAYS = 1;
export const REPORT_HORIZON_MAX_DAYS = 365;

/** True only for one of the five presets. */
export function isReportPeriodPreset(value: string): value is ReportPeriodPreset {
  return REPORT_PERIOD_PRESETS.some((preset) => preset === value);
}

/** The period echo the API returns, so a caller can PROVE what was aggregated. */
export interface ReportPeriodEcho {
  readonly preset: string | null;
  /** `YYYY-MM-DD` in the tenant zone. */
  readonly fromDate: string;
  /** `YYYY-MM-DD` in the tenant zone, inclusive. */
  readonly toDate: string;
  readonly timeZone: string;
  readonly fromInstant: string;
  readonly toInstant: string;
}

// ---------------------------------------------------------------------------
// Row DTOs. Every decimal is a fixed-scale STRING; every count is a number.
// ---------------------------------------------------------------------------

export interface SalesByPeriodRow {
  readonly bucketDate: string;
  readonly saleCount: number;
  readonly net: string;
  readonly tax: string;
  readonly gross: string;
}

export interface PaymentMethodRow {
  readonly method: string;
  readonly paymentCount: number;
  readonly amount: string;
  readonly shareOfGross: string;
}

export interface SalesByProductServiceRow {
  readonly catalogItemId: string;
  readonly name: string;
  readonly kind: string;
  readonly quantity: string;
  readonly net: string;
  readonly tax: string;
  readonly gross: string;
}

export interface KindTotal {
  readonly net: string;
  readonly tax: string;
  readonly gross: string;
  readonly quantity: string;
}

export interface CashSessionRow {
  readonly sessionId: string;
  readonly registerId: string;
  readonly openedAt: string;
  readonly closedAt: string;
  readonly openingAmount: string;
  readonly expectedAmount: string;
  readonly countedAmount: string;
  readonly differenceAmount: string;
}

export interface CashSessionsTotals {
  readonly expected: string;
  readonly counted: string;
  readonly difference: string;
}

export interface CashMovementRow {
  readonly type: string;
  readonly direction: string | null;
  readonly movementCount: number;
  readonly signedAmount: string;
}

export interface PurchaseRow {
  readonly purchaseId: string;
  readonly supplierId: string;
  readonly supplierName: string;
  readonly receivedAt: string;
  readonly lineCount: number;
  readonly totalQuantity: string;
}

export interface StockReportRow {
  readonly catalogItemId: string;
  readonly name: string;
  readonly kind: string;
  /** CURRENT BALANCE — a snapshot, never the period's net. */
  readonly quantity: string;
  readonly inbound: string;
  readonly outbound: string;
  readonly net: string;
}

export interface LowStockReportRow {
  readonly catalogItemId: string;
  readonly name: string;
  readonly quantity: string;
  readonly threshold: string;
  readonly shortfall: string;
}

export interface ConsultationDayRow {
  readonly bucketDate: string;
  readonly consultationCount: number;
}

export interface NewPatientDayRow {
  readonly bucketDate: string;
  readonly count: number;
}

/** `overdue` = local due date before today; `upcoming` = today or later. */
export type ReportDueStatus = "overdue" | "upcoming";

export interface VaccineDueRow {
  readonly patientId: string;
  readonly patientName: string;
  readonly vaccine: string;
  readonly administeredAt: string;
  readonly nextDueAt: string;
  readonly status: ReportDueStatus;
}

export interface DewormingDueRow {
  readonly patientId: string;
  readonly patientName: string;
  readonly product: string;
  readonly administeredAt: string;
  readonly nextDueAt: string;
  readonly status: ReportDueStatus;
}

// ---------------------------------------------------------------------------
// Response DTOs, discriminated by `report`.
// ---------------------------------------------------------------------------

export interface SalesByPeriodResponse {
  readonly report: "sales-by-period";
  readonly period: ReportPeriodEcho;
  readonly currency: string;
  readonly saleCount: number;
  readonly totalNet: string;
  readonly totalTax: string;
  readonly totalGross: string;
  readonly rows: readonly SalesByPeriodRow[];
}

export interface PaymentMethodsResponse {
  readonly report: "payment-methods";
  readonly period: ReportPeriodEcho;
  readonly currency: string;
  readonly totalGross: string;
  readonly rows: readonly PaymentMethodRow[];
}

export interface SalesByProductServiceResponse {
  readonly report: "sales-by-product-service";
  readonly period: ReportPeriodEcho;
  readonly currency: string;
  readonly totalsByKind: Readonly<Record<string, KindTotal>>;
  readonly rows: readonly SalesByProductServiceRow[];
}

export interface CashSessionsResponse {
  readonly report: "cash-sessions";
  readonly period: ReportPeriodEcho;
  readonly rows: readonly CashSessionRow[];
  readonly totals: CashSessionsTotals;
}

export interface CashMovementsResponse {
  readonly report: "cash-movements";
  readonly period: ReportPeriodEcho;
  readonly net: string;
  readonly rows: readonly CashMovementRow[];
}

export interface PurchasesResponse {
  readonly report: "purchases";
  readonly period: ReportPeriodEcho;
  readonly rows: readonly PurchaseRow[];
}

export interface StockReportResponse {
  readonly report: "stock";
  readonly period: ReportPeriodEcho;
  readonly rows: readonly StockReportRow[];
}

export interface LowStockReportResponse {
  readonly report: "low-stock";
  /**
   * Distinguishes the TWO empty states: `false` means nobody has set a threshold
   * yet (the first-run state the surface must explain), `true` with no rows means
   * every tracked item is above its own.
   */
  readonly thresholdsConfigured: boolean;
  readonly rows: readonly LowStockReportRow[];
}

export interface ConsultationsResponse {
  readonly report: "consultations";
  readonly period: ReportPeriodEcho;
  readonly consultationCount: number;
  readonly amendmentCount: number;
  readonly rows: readonly ConsultationDayRow[];
}

export interface NewPatientsResponse {
  readonly report: "new-patients";
  readonly period: ReportPeriodEcho;
  readonly newPatientCount: number;
  readonly rows: readonly NewPatientDayRow[];
}

export interface VaccinesDueResponse {
  readonly report: "vaccines-due";
  readonly asOfDate: string;
  readonly timeZone: string;
  readonly horizonDays: number;
  readonly overdueCount: number;
  readonly upcomingCount: number;
  readonly rows: readonly VaccineDueRow[];
}

export interface DewormingDueResponse {
  readonly report: "deworming-due";
  readonly asOfDate: string;
  readonly timeZone: string;
  readonly horizonDays: number;
  readonly overdueCount: number;
  readonly upcomingCount: number;
  readonly rows: readonly DewormingDueRow[];
}

/** Every response the twelve reports can answer with. */
export type ReportResponse =
  | SalesByPeriodResponse
  | PaymentMethodsResponse
  | SalesByProductServiceResponse
  | CashSessionsResponse
  | CashMovementsResponse
  | PurchasesResponse
  | StockReportResponse
  | LowStockReportResponse
  | ConsultationsResponse
  | NewPatientsResponse
  | VaccinesDueResponse
  | DewormingDueResponse;

/**
 * The wire shape of the error envelope every API refusal uses. Parsed as
 * `unknown` and narrowed field by field — never cast to a DTO.
 */
interface ApiErrorEnvelope {
  readonly error?: { readonly code?: string; readonly message?: string };
}

export class ReportRequestError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = "ReportRequestError";
    this.code = code;
    this.status = status;
  }
}

async function parseError(response: Response): Promise<ReportRequestError> {
  const raw: unknown = await response.json().catch(() => null);
  const envelope =
    typeof raw === "object" && raw !== null ? (raw as ApiErrorEnvelope) : ({} as ApiErrorEnvelope);
  return new ReportRequestError(
    envelope.error?.code ?? "UNKNOWN",
    envelope.error?.message ?? `Request failed (${response.status})`,
    response.status
  );
}

// ---------------------------------------------------------------------------
// Selection → query. Only the shapes the API accepts can be built here.
// ---------------------------------------------------------------------------

/**
 * What the controls currently ask for. One variant per accepted query contract:
 * a `preset` OR a `from`/`to` pair for a period report, a `horizonDays` for a due
 * report, and nothing at all for a current-state report.
 *
 * There is deliberately no "empty period" variant: `preset` and `range` are two
 * different questions and the API refuses a request that carries both or half of
 * either, so a selection that cannot be built is not represented here.
 */
export type ReportSelection =
  | { readonly kind: "preset"; readonly preset: ReportPeriodPreset }
  | { readonly kind: "range"; readonly from: string; readonly to: string }
  | { readonly kind: "horizon"; readonly horizonDays: number }
  | { readonly kind: "none" };

/** The selection a report opens with, derived from its query contract. */
export function defaultSelectionFor(code: ReportCode): ReportSelection {
  switch (reportQueryShapeOf(code)) {
    case "period":
      return { kind: "preset", preset: REPORT_DEFAULT_PRESET };
    case "due":
      return { kind: "horizon", horizonDays: REPORT_HORIZON_DEFAULT_DAYS };
    case "none":
      return { kind: "none" };
  }
}

/** True when a selection is a shape this report's contract accepts. */
export function selectionMatchesCode(code: ReportCode, selection: ReportSelection): boolean {
  switch (reportQueryShapeOf(code)) {
    case "period":
      return selection.kind === "preset" || selection.kind === "range";
    case "due":
      return selection.kind === "horizon";
    case "none":
      return selection.kind === "none";
  }
}

/**
 * The query string one selection produces, or `""` for a current-state report.
 *
 * Callers get an exception rather than a silently wrong request when a selection
 * does not match the report: sending `?horizonDays=` to a period report would be
 * a `400` from the API that looked like a surface bug, and the surface builds its
 * controls FROM the query shape, so reaching this branch is a programming error.
 */
export function reportQueryString(code: ReportCode, selection: ReportSelection): string {
  if (!selectionMatchesCode(code, selection)) {
    throw new Error(`Report ${code} does not accept a "${selection.kind}" selection.`);
  }
  const params = new URLSearchParams();
  switch (selection.kind) {
    case "preset":
      params.set("preset", selection.preset);
      break;
    case "range":
      params.set("from", selection.from);
      params.set("to", selection.to);
      break;
    case "horizon":
      params.set("horizonDays", String(selection.horizonDays));
      break;
    case "none":
      break;
  }
  return params.toString();
}

/** The BFF read path, e.g. `/api/reports/stock?preset=last7Days`. */
export function reportRequestPath(code: ReportCode, selection: ReportSelection): string {
  const query = reportQueryString(code, selection);
  return `/api/reports/${encodeURIComponent(code)}${query.length > 0 ? `?${query}` : ""}`;
}

/**
 * The BFF export path for the SAME query the table is showing — `/api/reports/
 * <code>/export?…`. It is a separate route (`[reportCode]/export`) on purpose:
 * the CSV carries `content-disposition`, which no read answer may carry.
 */
export function reportExportPath(code: ReportCode, selection: ReportSelection): string {
  const query = reportQueryString(code, selection);
  return `/api/reports/${encodeURIComponent(code)}/export${query.length > 0 ? `?${query}` : ""}`;
}

/** Reads one report through the staff BFF. */
export async function fetchReport(
  code: ReportCode,
  selection: ReportSelection
): Promise<ReportResponse> {
  const response = await fetch(reportRequestPath(code, selection), { cache: "no-store" });
  if (!response.ok) {
    throw await parseError(response);
  }
  // The mirror above is the contract this cast asserts; the BFF forwards the
  // API's own JSON unchanged, so the shape is the API's, not a copy of it.
  return (await response.json()) as ReportResponse;
}

// ---------------------------------------------------------------------------
// Errors, as the surface shows them.
// ---------------------------------------------------------------------------

/** True when the read failed on an authorization gate rather than on the data. */
export function isReportAccessDenied(error: Error | null): boolean {
  return (
    error instanceof ReportRequestError &&
    (error.code === "FORBIDDEN" || error.code === "UNAUTHENTICATED")
  );
}

/**
 * The sentence the surface shows for a failed read.
 *
 * A `VALIDATION_FAILED` — the over-long period, an inverted range, a horizon
 * outside its bound — returns the API's OWN message verbatim, because that
 * sentence ("The report period spans more than 366 days.") is the explanation,
 * and replacing it with "Something went wrong" would throw it away.
 */
export function userFacingReportError(error: Error): string {
  if (!(error instanceof ReportRequestError)) {
    return "The request could not reach the server. Check your connection and try again.";
  }
  switch (error.code) {
    case "UNAUTHENTICATED":
      return "You must be signed in to read reports.";
    case "FORBIDDEN":
      return "You do not have permission to read reports.";
    default:
      return error.message;
  }
}
