"use client";

import type { JSX, ReactNode } from "react";
import { useState } from "react";
import Link from "next/link";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@newsaas/ui/components/ui/card";
import type { ReportCode } from "@/app/api/reports/report-codes";
import {
  fetchReport,
  isReportAccessDenied,
  isReportPeriodPreset,
  REPORT_DEFAULT_PRESET,
  REPORT_PERIOD_PRESETS,
  REPORT_PERIOD_PRESET_LABELS,
  reportQueryString,
  userFacingReportError,
  type ReportPeriodPreset,
  type ReportResponse,
  type ReportSelection,
} from "./reports/reports-api";

/**
 * The staff dashboard at `/app` ([[REP-008]], [[DEC-062]]).
 *
 * ## This surface is the reports API with another layout
 *
 * [[DEC-062]] decided that the dashboard is NOT a second aggregation path: a card
 * and the report it summarises answer from ONE service method for ONE period. On
 * this surface that rule takes a concrete, checkable shape:
 *
 * - every card reads through {@link fetchReport}, the same client function the
 *   report views use, and therefore through `reportRequestPath` — there is no
 *   second URL builder, no second query and no second copy of a response type
 *   here;
 * - the query KEY is `["reports", code, reportQueryString(code, selection)]`, the
 *   exact key the report view uses, so the dashboard's card and the report it
 *   links to share one cache entry as well as one request;
 * - the card shows the report's own field verbatim. `totalGross` is a
 *   fixed-scale decimal STRING and is printed as it arrived; `saleCount` is a
 *   number and is printed as one; `totals.difference` is a string that may be
 *   negative and keeps its sign. Nothing is summed, divided, rounded or
 *   re-formatted on this surface, because a client-side total would be the second
 *   aggregation path the decision refuses.
 *
 * ## One card is not period-scoped, and says so
 *
 * `low-stock` is a CURRENT-STATE report: it takes no period at all
 * (`reportQueryShapeOf("low-stock") === "none"`), so its card asks for it with a
 * `{ kind: "none" }` selection. That selection never changes — no matter what the
 * period selector says — so the card's key never changes either and it is NOT
 * refetched when the period changes. Claiming otherwise would be a lie about a
 * figure that has no period, so the card's description says it outright.
 *
 * ## The states, per card
 *
 * Loading, permission-denied (`401`/`403` through the shipped
 * {@link isReportAccessDenied} helper), error (the API's OWN sentence) and
 * success are rendered by ONE component for all four cards, so the surfaces
 * cannot drift into showing a failure differently. A card is a report, and a
 * report that could not be read says why.
 *
 * ## Branding
 *
 * Semantic tokens only (`bg-card`, `text-card-foreground`,
 * `text-muted-foreground`, `border-destructive`, `text-primary`). No literal
 * colour, radius or font: the region re-themes with the tenant brand without a
 * component edit, which is the property the shell's surface-integrity tests
 * assert against `data-testid="app-dashboard"`.
 */

const controlClassName =
  "h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

const valueClassName = "text-2xl font-semibold tracking-tight text-foreground";

/**
 * What a card renders when the response is not the report it asked for.
 *
 * Unreachable by construction — each card requests its own code, so the response
 * discriminant always matches — but the renderers narrow on it because the
 * client's return type is the union of all twelve reports. It renders the
 * surface's no-value mark rather than a number, because a fabricated `0` here
 * would be indistinguishable from a real one.
 */
const NO_VALUE = <p className={valueClassName}>—</p>;

type DashboardReportQuery = UseQueryResult<ReportResponse, Error>;

/**
 * One report, read the way the report view reads it.
 *
 * Deliberately the same `queryKey` derivation as `ReportWorkspace`: `(code,
 * queryString)` is the identity of an answer, so two surfaces asking the same
 * question share the entry instead of each holding a copy.
 */
function useDashboardReport(code: ReportCode, selection: ReportSelection): DashboardReportQuery {
  return useQuery({
    queryKey: ["reports", code, reportQueryString(code, selection)],
    queryFn: () => fetchReport(code, selection),
    retry: false,
  });
}

interface DashboardCardProps {
  readonly testId: string;
  readonly title: string;
  readonly code: ReportCode;
  readonly description: string;
  readonly query: DashboardReportQuery;
  readonly renderValue: (response: ReportResponse) => ReactNode;
}

/**
 * One card: a link to the full report, and that report's answer.
 *
 * The link lives in the title rather than wrapping the whole card for a concrete
 * reason: the low-stock card contains its OWN link to `/app/catalog` (the place a
 * threshold is entered), and a link inside a link is invalid HTML that browsers
 * silently un-nest.
 */
function DashboardCard({
  testId,
  title,
  code,
  description,
  query,
  renderValue,
}: DashboardCardProps): JSX.Element {
  return (
    <Card data-testid={testId} className="flex flex-col">
      <CardHeader>
        <CardTitle>
          <Link
            data-testid={`${testId}-link`}
            href={`/app/reports/${code}`}
            className="text-primary underline-offset-4 hover:underline"
          >
            {title}
          </Link>
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="flex-1">
        <CardState testId={testId} query={query} renderValue={renderValue} />
      </CardContent>
    </Card>
  );
}

/** Loading, permission-denied, error and success — the same four for every card. */
function CardState({
  testId,
  query,
  renderValue,
}: Omit<DashboardCardProps, "title" | "code" | "description">): JSX.Element | null {
  const error = query.error;

  if (query.isLoading) {
    return (
      <p data-testid={`${testId}-loading`} className="text-sm text-muted-foreground">
        Loading...
      </p>
    );
  }

  if (error !== null) {
    const denied = isReportAccessDenied(error);
    return (
      <div
        role="alert"
        data-testid={`${testId}-${denied ? "permission-denied" : "error"}`}
        className="rounded-lg border border-destructive bg-destructive/10 p-3 text-sm text-destructive"
      >
        <p className="font-medium">
          {denied ? "Not available to this account" : "This figure could not be loaded"}
        </p>
        {/* The API's own sentence, verbatim: the same rule the report view keeps,
            because a period the API refused explains itself. */}
        <p>{userFacingReportError(error)}</p>
      </div>
    );
  }

  if (query.data === undefined) {
    return null;
  }

  return (
    <div data-testid={`${testId}-value`} className="space-y-1">
      {renderValue(query.data)}
    </div>
  );
}

/**
 * The dashboard.
 *
 * Four cards over three reports (`sales-by-period` feeds two of them, so it is
 * requested once), and one period selector defaulting to
 * {@link REPORT_DEFAULT_PRESET} — the same default the report views open on, so a
 * card and the report it links to answer for the same period by default.
 */
export function Dashboard(): JSX.Element {
  const [preset, setPreset] = useState<ReportPeriodPreset>(REPORT_DEFAULT_PRESET);
  const periodSelection: ReportSelection = { kind: "preset", preset };

  const sales = useDashboardReport("sales-by-period", periodSelection);
  const cashSessions = useDashboardReport("cash-sessions", periodSelection);
  // No period, ever: `low-stock` refuses a query, so this selection is not
  // derived from `preset` and the card is not refetched when the period changes.
  const lowStock = useDashboardReport("low-stock", { kind: "none" });

  return (
    <div
      data-testid="app-dashboard"
      className="mx-auto max-w-5xl space-y-6 rounded-xl bg-card p-6 text-card-foreground"
    >
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            Four figures, each one a report this tenant can open in full. Nothing is computed here:
            every value is the reporting API&apos;s own answer for the period below.
          </p>
        </div>
        <div className="space-y-2">
          <label htmlFor="dashboard-period" className="text-sm font-medium">
            Period
          </label>
          <select
            id="dashboard-period"
            data-testid="dashboard-period"
            className={controlClassName}
            value={preset}
            onChange={(event) => {
              const next = event.target.value;
              if (isReportPeriodPreset(next)) {
                setPreset(next);
              }
            }}
          >
            {REPORT_PERIOD_PRESETS.map((option) => (
              <option key={option} value={option}>
                {REPORT_PERIOD_PRESET_LABELS[option]}
              </option>
            ))}
          </select>
        </div>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <DashboardCard
          testId="dashboard-card-gross"
          title="Gross sales"
          code="sales-by-period"
          description="The period's gross total from the sales-by-period report."
          query={sales}
          renderValue={(response) =>
            response.report === "sales-by-period" ? (
              <>
                {/* A fixed-scale decimal STRING, printed exactly as it arrived:
                    `"1234.50"` renders as `1234.50` and never as `1234.5`. */}
                <p className={valueClassName}>{response.totalGross}</p>
                <p className="text-xs text-muted-foreground">
                  {response.currency} · the report&apos;s own total, never recomputed here.
                </p>
              </>
            ) : (
              NO_VALUE
            )
          }
        />

        <DashboardCard
          testId="dashboard-card-sales"
          title="Sales"
          code="sales-by-period"
          description="How many sales completed in the period."
          query={sales}
          renderValue={(response) =>
            response.report === "sales-by-period" ? (
              <>
                {/* A COUNT: a number in the DTO, printed as one. */}
                <p className={valueClassName}>{response.saleCount}</p>
                <p className="text-xs text-muted-foreground">
                  Completed sales in the period, counted by the report.
                </p>
              </>
            ) : (
              NO_VALUE
            )
          }
        />

        <DashboardCard
          testId="dashboard-card-cash-difference"
          title="Cash difference"
          code="cash-sessions"
          description="Counted minus expected across the drawers that closed in the period."
          query={cashSessions}
          renderValue={(response) =>
            response.report === "cash-sessions" ? (
              <>
                {/* May be negative, and the sign IS the information: a drawer
                    that was short must not read like one that was over. */}
                <p className={valueClassName}>{response.totals.difference}</p>
                <p className="text-xs text-muted-foreground">
                  Across {response.rows.length} closed{" "}
                  {response.rows.length === 1 ? "drawer" : "drawers"} in the period.
                </p>
              </>
            ) : (
              NO_VALUE
            )
          }
        />

        <DashboardCard
          testId="dashboard-card-low-stock"
          title="Low stock"
          code="low-stock"
          description="A current state, not a period: this report takes no period, so this card does not follow the selector."
          query={lowStock}
          renderValue={(response) =>
            response.report === "low-stock" ? (
              response.thresholdsConfigured ? (
                <>
                  <p className={valueClassName}>{response.rows.length}</p>
                  <p className="text-xs text-muted-foreground">
                    {response.rows.length === 1 ? "item is" : "items are"} at or below their own
                    threshold.
                  </p>
                </>
              ) : (
                <>
                  {/* The honest first-run answer ([[DEC-065]]): no threshold means
                      the item is not monitored, which is NOT the same as healthy,
                      so the card explains itself instead of rendering a confident
                      zero. The sentence matches the report workspace's empty
                      state verbatim. */}
                  <p
                    data-testid="dashboard-card-low-stock-not-configured"
                    className="text-sm font-medium text-foreground"
                  >
                    No item has a low-stock threshold yet
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Nothing is monitored until a threshold is set, so there is nothing to count.
                  </p>
                  <Link
                    data-testid="dashboard-card-low-stock-configure"
                    href="/app/catalog"
                    className="inline-flex text-xs font-medium text-primary underline-offset-4 hover:underline"
                  >
                    Set a threshold in the catalog
                  </Link>
                </>
              )
            ) : (
              NO_VALUE
            )
          }
        />
      </div>
    </div>
  );
}
