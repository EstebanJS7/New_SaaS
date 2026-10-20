"use client";

import type { JSX } from "react";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@newsaas/ui/components/ui/button";
import type { ReportCode } from "@/app/api/reports/report-codes";
import { reportDefinition } from "./report-catalog";
import { ReportEmptyState } from "./report-empty-state";
import { ReportTable } from "./report-table";
import {
  defaultSelectionFor,
  fetchReport,
  isReportAccessDenied,
  isReportPeriodPreset,
  REPORT_HORIZON_DEFAULT_DAYS,
  REPORT_HORIZON_MAX_DAYS,
  REPORT_HORIZON_MIN_DAYS,
  REPORT_PERIOD_PRESETS,
  REPORT_PERIOD_PRESET_LABELS,
  reportExportPath,
  reportQueryString,
  userFacingReportError,
  type ReportPeriodPreset,
  type ReportSelection,
} from "./reports-api";

/** The permission that reveals the export action. UX only: the API re-checks it. */
export const REPORTS_EXPORT_PERMISSION = "reports.export";

/** The value the period select uses for "neither preset": a custom range. */
const CUSTOM_RANGE_OPTION = "custom";

const controlClassName =
  "h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

/**
 * `undefined` means the surface was not told the caller's claims, so the action is
 * shown and the API stays authoritative — the same convention the clinical
 * records surface and the staff nav use. An explicit list without the key hides
 * it.
 */
function permissionGranted(permissions: readonly string[] | undefined, required: string): boolean {
  return permissions === undefined || permissions.includes(required);
}

export interface ReportWorkspaceProps {
  readonly reportCode: ReportCode;
  /**
   * The caller's permission keys when the shell knows them. Optional and UX-only
   * ([[DEC-062]]): a hidden button is not an authorization, and the API refuses
   * an export from a caller without `reports.export` regardless of this prop.
   */
  readonly permissions?: readonly string[];
}

/**
 * One report, with the controls its own query contract allows ([[REP-008]]).
 *
 * The controls are DERIVED from the report's query shape rather than chosen per
 * report, which is what keeps a wrong query structurally impossible:
 *
 * - a `period` report gets the five presets and a custom `from`/`to` pair, and
 *   never both at once ([[DEC-063]] refuses a request that carries both);
 * - a `due` report gets a `horizonDays` control and NO period ([[DEC-065]]);
 * - `low-stock` gets neither and sends NO query at all — the API refuses one.
 *
 * The surface renders every state explicitly: loading, permission-denied, error,
 * empty (through {@link ReportEmptyState}, which explains the fixable ones) and
 * success. It never computes a number: each cell is an API value, and a decimal
 * string is printed verbatim.
 */
export function ReportWorkspace({ reportCode, permissions }: ReportWorkspaceProps): JSX.Element {
  const definition = reportDefinition(reportCode);
  const initialSelection = defaultSelectionFor(reportCode);

  // The selection the TABLE is showing. The controls hold drafts, and a draft only
  // becomes the selection once it is a shape the API accepts — so a half-typed
  // custom range never becomes a request, and never becomes an error either.
  const [selection, setSelection] = useState<ReportSelection>(initialSelection);
  const [periodMode, setPeriodMode] = useState<"preset" | "range">("preset");
  const [rangeFrom, setRangeFrom] = useState("");
  const [rangeTo, setRangeTo] = useState("");
  const [horizonInput, setHorizonInput] = useState(String(REPORT_HORIZON_DEFAULT_DAYS));
  const [controlNotice, setControlNotice] = useState<string | null>(null);

  const query = useQuery({
    // Keyed by the CODE and the exact query string: two periods are two answers,
    // and the export action below uses the same string.
    queryKey: ["reports", reportCode, reportQueryString(reportCode, selection)],
    queryFn: () => fetchReport(reportCode, selection),
    retry: false,
  });

  function applyPreset(next: ReportPeriodPreset): void {
    setPeriodMode("preset");
    setRangeFrom("");
    setRangeTo("");
    setControlNotice(null);
    setSelection({ kind: "preset", preset: next });
  }

  function applyRange(nextFrom: string, nextTo: string): void {
    setRangeFrom(nextFrom);
    setRangeTo(nextTo);
    if (nextFrom.length === 0 && nextTo.length === 0) {
      // Nothing typed yet: no notice, and the previous period stays on screen.
      setControlNotice(null);
      return;
    }
    if (nextFrom.length === 0 || nextTo.length === 0) {
      // Half a range is ambiguous, and the API refuses it: an implied "today"
      // would be this surface's guess about a period.
      setControlNotice("A custom range needs both a start date and an end date.");
      return;
    }
    setControlNotice(null);
    setSelection({ kind: "range", from: nextFrom, to: nextTo });
  }

  function applyHorizon(value: string): void {
    setHorizonInput(value);
    const parsed = Number(value);
    if (
      !Number.isInteger(parsed) ||
      parsed < REPORT_HORIZON_MIN_DAYS ||
      parsed > REPORT_HORIZON_MAX_DAYS
    ) {
      setControlNotice(
        `The horizon must be a whole number of days between ${REPORT_HORIZON_MIN_DAYS} and ${REPORT_HORIZON_MAX_DAYS}.`
      );
      return;
    }
    setControlNotice(null);
    setSelection({ kind: "horizon", horizonDays: parsed });
  }

  const canExport = permissionGranted(permissions, REPORTS_EXPORT_PERMISSION);
  const readError = query.error;
  const accessDenied = isReportAccessDenied(readError);

  return (
    <div data-testid="report-workspace" className="mx-auto max-w-5xl space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          {definition.title}
        </h1>
        <p className="text-sm text-muted-foreground">{definition.description}</p>
      </header>

      <div className="flex flex-wrap items-end gap-3">
        {definition.queryShape === "period" && (
          <>
            <div className="space-y-2">
              <label htmlFor="report-period" className="text-sm font-medium">
                Period
              </label>
              <select
                id="report-period"
                className={controlClassName}
                value={
                  periodMode === "range"
                    ? CUSTOM_RANGE_OPTION
                    : selection.kind === "preset"
                      ? selection.preset
                      : CUSTOM_RANGE_OPTION
                }
                onChange={(event) => {
                  const value = event.target.value;
                  if (value === CUSTOM_RANGE_OPTION) {
                    setPeriodMode("range");
                    applyRange(rangeFrom, rangeTo);
                    return;
                  }
                  if (isReportPeriodPreset(value)) {
                    applyPreset(value);
                  }
                }}
              >
                {REPORT_PERIOD_PRESETS.map((preset) => (
                  <option key={preset} value={preset}>
                    {REPORT_PERIOD_PRESET_LABELS[preset]}
                  </option>
                ))}
                <option value={CUSTOM_RANGE_OPTION}>Custom range</option>
              </select>
            </div>
            {periodMode === "range" && (
              <>
                <div className="space-y-2">
                  <label htmlFor="report-period-from" className="text-sm font-medium">
                    From
                  </label>
                  <input
                    id="report-period-from"
                    type="date"
                    className={controlClassName}
                    value={rangeFrom}
                    onChange={(event) => applyRange(event.target.value, rangeTo)}
                  />
                </div>
                <div className="space-y-2">
                  <label htmlFor="report-period-to" className="text-sm font-medium">
                    To
                  </label>
                  <input
                    id="report-period-to"
                    type="date"
                    className={controlClassName}
                    value={rangeTo}
                    onChange={(event) => applyRange(rangeFrom, event.target.value)}
                  />
                </div>
              </>
            )}
          </>
        )}

        {definition.queryShape === "due" && (
          <div className="space-y-2">
            <label htmlFor="report-horizon" className="text-sm font-medium">
              Horizon (days)
            </label>
            <input
              id="report-horizon"
              type="number"
              min={REPORT_HORIZON_MIN_DAYS}
              max={REPORT_HORIZON_MAX_DAYS}
              step={1}
              className={controlClassName}
              value={horizonInput}
              onChange={(event) => applyHorizon(event.target.value)}
            />
          </div>
        )}

        {definition.queryShape === "none" && (
          <p data-testid="report-no-query" className="text-sm text-muted-foreground">
            This report is a current-state view: it takes no period and no other parameter.
          </p>
        )}

        {canExport && (
          <Button asChild variant="outline">
            {/*
              A plain link, not a fetch: the export proxy relays the API's own
              `content-disposition`, so the browser names and saves the file. The
              `download` attribute is deliberately NOT set — it would override the
              API's filename with one derived from the URL.
            */}
            <a data-testid="report-export" href={reportExportPath(reportCode, selection)}>
              Export CSV
            </a>
          </Button>
        )}
      </div>

      {controlNotice !== null && (
        <p data-testid="report-control-notice" className="text-sm text-muted-foreground">
          {controlNotice}
        </p>
      )}

      {query.isLoading && (
        <p data-testid="report-loading" className="text-sm text-muted-foreground">
          Loading report...
        </p>
      )}

      {readError !== null && accessDenied && (
        <div
          role="alert"
          data-testid="report-permission-denied"
          className="rounded-lg border border-destructive bg-destructive/10 p-4 text-sm text-destructive"
        >
          <p className="font-medium">Reports are not available to this account</p>
          <p>{userFacingReportError(readError)}</p>
        </div>
      )}

      {readError !== null && !accessDenied && (
        <div
          role="alert"
          data-testid="report-error"
          className="rounded-lg border border-destructive bg-destructive/10 p-4 text-sm text-destructive"
        >
          <p className="font-medium">The report could not be loaded</p>
          {/* The API's own sentence, verbatim: an over-long period explains
              itself ("spans more than 366 days") and a generic failure would
              throw that explanation away. */}
          <p>{userFacingReportError(readError)}</p>
        </div>
      )}

      {query.data !== undefined &&
        readError === null &&
        (query.data.rows.length === 0 ? (
          <ReportEmptyState response={query.data} />
        ) : (
          <ReportTable response={query.data} />
        ))}
    </div>
  );
}
