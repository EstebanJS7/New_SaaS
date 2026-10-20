"use client";

import type { JSX } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@newsaas/ui/components/ui/card";
import { REPORT_GROUPS, reportsInGroup, type ReportDefinition } from "./report-catalog";
import { fetchReport, isReportAccessDenied, userFacingReportError } from "./reports-api";

/**
 * The reports index ([[REP-008]]): every report the epic ships, grouped Core /
 * Veterinary, each one a link to its view.
 *
 * ## Why the index reads anything at all
 *
 * The twelve entries are static, so an index that only listed them could never be
 * loading, and could never be refused. Reports are guarded by `reports.read`
 * ([[DEC-062]]) and there is no feature code to gate the destination on, so the
 * ONLY honest way to know whether those links lead anywhere is to ask the API —
 * and the cheapest question in the catalogue is `low-stock`, the one report that
 * takes no query parameter at all. That read is the access probe behind the three
 * states below, and it is the same aggregation path the workspace uses: nothing
 * here computes or counts anything.
 *
 * The entries render whatever the probe says, because a link that is not usable
 * is still a report the product has, and hiding a whole catalogue behind a
 * spinner or an outage would make a transient failure look like a missing
 * feature.
 */
export function ReportsIndex(): JSX.Element {
  const access = useQuery({
    queryKey: ["reports", "access-probe"],
    queryFn: () => fetchReport("low-stock", { kind: "none" }),
    retry: false,
  });

  const denied = isReportAccessDenied(access.error);

  return (
    <main data-testid="reports-workspace" className="mx-auto max-w-5xl space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Reports</h1>
        <p className="text-sm text-muted-foreground">
          Read-only views over the tenant&apos;s own data. Every figure comes from the reporting
          API, never from this surface.
        </p>
      </header>

      {access.isLoading && (
        <p data-testid="reports-loading" className="text-sm text-muted-foreground">
          Checking your report access...
        </p>
      )}

      {denied && (
        <div
          role="alert"
          data-testid="reports-permission-denied"
          className="rounded-lg border border-destructive bg-destructive/10 p-4 text-sm text-destructive"
        >
          <p className="font-medium">Reports are not available to this account</p>
          <p>{access.error === null ? "" : userFacingReportError(access.error)}</p>
        </div>
      )}

      {access.error !== null && !denied && (
        <div
          role="alert"
          data-testid="reports-error"
          className="rounded-lg border border-destructive bg-destructive/10 p-4 text-sm text-destructive"
        >
          <p className="font-medium">Report access could not be checked</p>
          {/* The API's own message, verbatim — the same rule the report view uses. */}
          <p>{userFacingReportError(access.error)}</p>
        </div>
      )}

      {REPORT_GROUPS.map((group) => (
        <ReportGroupSection
          key={group.id}
          title={group.title}
          description={group.description}
          entries={reportsInGroup(group.id)}
        />
      ))}
    </main>
  );
}

function ReportGroupSection({
  title,
  description,
  entries,
}: {
  readonly title: string;
  readonly description: string;
  readonly entries: readonly ReportDefinition[];
}): JSX.Element {
  return (
    <Card data-testid="reports-group">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="divide-y divide-border">
          {entries.map((entry) => (
            <li key={entry.code} data-testid="report-index-entry" className="py-3">
              <Link
                href={`/app/reports/${entry.code}`}
                className="text-sm font-medium text-primary underline-offset-4 hover:underline"
              >
                {entry.title}
              </Link>
              <p className="text-xs text-muted-foreground">{entry.description}</p>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
