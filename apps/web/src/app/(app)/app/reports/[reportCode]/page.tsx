import type { JSX } from "react";
import { notFound } from "next/navigation";
import { isReportCode } from "@/app/api/reports/report-codes";
import { ReportWorkspaceScreen } from "../report-workspace";

/**
 * One report, by code ([[REP-008]]).
 *
 * The code is validated on the SERVER against the same closed list the BFF proxy
 * enforces, so `/app/reports/profit-and-loss` is the app's 404 rather than a view
 * that loads nothing and cannot say why. The view itself is a client surface
 * because the period controls, the states and the export link all follow from a
 * live read. Its container reads the caller's permissions from the staff shell
 * ([[UX-037]]).
 */
export default async function ReportViewPage({
  params,
}: {
  params: Promise<{ reportCode: string }>;
}): Promise<JSX.Element> {
  const { reportCode } = await params;
  if (!isReportCode(reportCode)) {
    notFound();
  }
  return <ReportWorkspaceScreen reportCode={reportCode} />;
}
