/**
 * The CLOSED set of report codes this boundary serves, and the query keys each
 * one accepts ([[REP-008]], [[DEC-062]]).
 *
 * ## Why a copy exists at all
 *
 * `apps/api/src/reporting/export/report-export.definitions.ts` OWNS the API-side
 * list (`REPORT_EXPORT_CODES`), and `apps/api/src/reporting/reporting.controller.ts`
 * is what actually routes the twelve reports. There is no shared package between
 * the API and the web app, so this is a DELIBERATE second copy — the same
 * mirroring `apps/web/src/app/api/reports/[reportCode]/export/route.ts` already
 * keeps. Its only job is to let this boundary refuse an unknown code BEFORE an
 * upstream call: a proxy that forwarded anything would be a tunnel with a
 * report-shaped hole in it. A code added on the API side alone is a `400` here
 * and a `404` there, which is the failure mode this copy is allowed to have.
 *
 * ## Why the query KEYS live in the same table
 *
 * Which keys a report accepts is part of the same answer as which reports exist.
 * The API decides it with three closed schemas in
 * `apps/api/src/reporting/reporting.dto.ts` — `reportPeriodQuerySchema`
 * (`preset` / `from` / `to`), `reportDueQuerySchema` (`horizonDays`) and
 * `reportNoQuerySchema` (nothing at all) — and each of them is `.strict()`, so an
 * unknown key is a refusal there rather than a silently ignored parameter.
 * Forwarding a key the report would refuse would turn that explicit refusal into
 * a proxy round-trip that looks like a bug; DROPPING one would be worse, because
 * `?tenantId=…` would leave the caller believing it had chosen a tenant when the
 * tenant comes from the session alone.
 *
 * ## One list, shared with the workspace
 *
 * `apps/web/src/app/(app)/app/reports/report-catalog.ts` reads this module for
 * the codes and their query shapes, so the report the index links to and the
 * report this proxy accepts cannot drift apart inside the web app.
 *
 * The VALUES of the query are never interpreted here. Which presets exist, what
 * a `from`/`to` pair means, the maximum span and the horizon bound all live in
 * `apps/api/src/reporting/report.period.ts` and `report.horizon.ts`; this
 * boundary forwards the accepted keys verbatim, exactly as the export proxy does.
 */
export const REPORT_CODES = [
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

export type ReportCode = (typeof REPORT_CODES)[number];

/**
 * The three query contracts the reporting API ships.
 *
 * - `period` — "what happened in a window" ([[DEC-063]]): a preset OR a custom
 *   `from`/`to` pair, never both and never instants.
 * - `due` — "what is due", with a bounded forward horizon and NO period
 *   ([[DEC-065]]).
 * - `none` — a current-state view that takes no parameter at all.
 */
export type ReportQueryShape = "period" | "due" | "none";

const REPORT_QUERY_SHAPE_BY_CODE: Readonly<Record<ReportCode, ReportQueryShape>> = {
  "sales-by-period": "period",
  "payment-methods": "period",
  "sales-by-product-service": "period",
  "cash-sessions": "period",
  "cash-movements": "period",
  purchases: "period",
  stock: "period",
  "low-stock": "none",
  consultations: "period",
  "new-patients": "period",
  "vaccines-due": "due",
  "deworming-due": "due",
};

/** The keys each query contract accepts, in the order the API's schemas declare them. */
export const REPORT_QUERY_KEYS: Readonly<Record<ReportQueryShape, readonly string[]>> = {
  period: ["preset", "from", "to"],
  due: ["horizonDays"],
  none: [],
};

const REPORT_CODE_SET: ReadonlySet<string> = new Set<string>(REPORT_CODES);

/** True only for one of the twelve codes. */
export function isReportCode(value: string): value is ReportCode {
  return REPORT_CODE_SET.has(value);
}

/** The query contract of one report. Total: every code has exactly one shape. */
export function reportQueryShapeOf(code: ReportCode): ReportQueryShape {
  return REPORT_QUERY_SHAPE_BY_CODE[code];
}

/** The query keys one report accepts — empty for a current-state report. */
export function reportQueryKeysOf(code: ReportCode): readonly string[] {
  return REPORT_QUERY_KEYS[reportQueryShapeOf(code)];
}

/** True when a report accepts this query key. */
export function isAcceptedReportQueryKey(code: ReportCode, key: string): boolean {
  return reportQueryKeysOf(code).includes(key);
}
