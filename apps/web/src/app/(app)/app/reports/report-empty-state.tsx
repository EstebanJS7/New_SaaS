"use client";

import type { JSX } from "react";
import Link from "next/link";
import type { ReportResponse } from "./reports-api";

/**
 * What an empty report says ([[REP-008]], [[DEC-065]]).
 *
 * Three of the twelve reports can be empty for a reason the reader can FIX, and
 * they are the reason this component exists as a switch rather than a one-line
 * "no results" string:
 *
 * - `low-stock` is empty for every tenant until somebody sets a low-stock
 *   threshold on a catalog item ([[DEC-065]] refused to invent a default, so an
 *   unmonitored item is a real state, not a healthy one).
 * - `vaccines-due` and `deworming-due` are empty until a staff member records a
 *   next-due date on a clinical record. Nothing is derived or projected, again by
 *   [[DEC-065]].
 *
 * Each of those names the missing fact and links to the surface where it is
 * entered. Everything else is the plain answer — nothing was recorded in the
 * period — with the period echoed from the RESPONSE, so the reader can see which
 * range actually answered rather than which one the browser believes it asked
 * for. No branch renders a blank panel.
 */
export function ReportEmptyState({ response }: { readonly response: ReportResponse }): JSX.Element {
  switch (response.report) {
    case "low-stock":
      return response.thresholdsConfigured ? (
        <EmptyPanel
          testId="report-empty-low-stock-clear"
          title="No item is at or below its threshold"
          body="Thresholds are configured and every tracked item sits above its own, so nothing needs restocking today."
          action={null}
        />
      ) : (
        <EmptyPanel
          testId="report-empty-low-stock-thresholds"
          title="No item has a low-stock threshold yet"
          body="This report lists only items whose own threshold has been set, and none has: no threshold means the item is not monitored. It stays empty by design until a threshold is entered on a catalog item — not because stock is healthy."
          action={{ href: "/app/catalog", label: "Open the catalog to set a threshold" }}
        />
      );
    case "vaccines-due":
    case "deworming-due":
      return (
        <EmptyPanel
          testId="report-empty-due"
          title={
            response.report === "vaccines-due"
              ? "No vaccination has a due date"
              : "No deworming treatment has a due date"
          }
          body={`This report lists only records where staff entered the next due date; no booster interval is derived. Nothing is overdue or due within ${response.horizonDays} days from ${response.asOfDate} because no record carries a due date at all.`}
          action={{ href: "/app/patients", label: "Open patients to record a due date" }}
        />
      );
    default: {
      // The nine PERIOD reports: `response` is narrowed to the members that carry
      // a period echo, so this reads the range the API resolved (tenant zone
      // included) instead of restating one.
      const { fromDate, toDate, timeZone } = response.period;
      return (
        <EmptyPanel
          testId="report-empty-period"
          title="Nothing was recorded in this period"
          body={`No row matches ${fromDate} to ${toDate} (${timeZone}).`}
          action={null}
        />
      );
    }
  }
}

interface EmptyAction {
  readonly href: string;
  readonly label: string;
}

function EmptyPanel({
  testId,
  title,
  body,
  action,
}: {
  readonly testId: string;
  readonly title: string;
  readonly body: string;
  readonly action: EmptyAction | null;
}): JSX.Element {
  return (
    <div
      data-testid={testId}
      role="status"
      className="space-y-2 rounded-lg border bg-card p-4 text-sm text-card-foreground"
    >
      <p className="font-medium">{title}</p>
      <p className="text-muted-foreground">{body}</p>
      {action !== null && (
        <Link
          data-testid="report-empty-action"
          href={action.href}
          className="inline-flex text-sm font-medium text-primary underline-offset-4 hover:underline"
        >
          {action.label}
        </Link>
      )}
    </div>
  );
}
