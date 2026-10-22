"use client";

import type { JSX, ReactNode } from "react";
import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@newsaas/ui/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@newsaas/ui/components/ui/card";
import {
  fetchImport,
  fetchImportSummary,
  IMPORT_ENTITY_LABELS,
  IMPORT_POLL_INTERVAL_MS,
  IMPORT_SUMMARY_PAGE_SIZE,
  importDetailQueryKey,
  importSummaryQueryKey,
  isImportAccessDenied,
  seedAcceptedPhase,
  startImportCommit,
  startImportPreview,
  userFacingImportError,
  type ImportPhaseAccepted,
  type ImportSummary,
} from "../imports-api";
import {
  IMPORTS_READ_PERMISSION,
  IMPORTS_RUN_PERMISSION,
  importPhaseNotice,
  importRowMessageText,
  importRowReasonText,
  importRowWarningText,
  nextImportAction,
  permissionGranted,
  pollIntervalForState,
  summaryPageLabel,
  summaryRowTotal,
} from "../imports-display";

const controlButtonClassName = "min-w-24";

/** The two commands this screen can issue. */
type ImportCommand = "preview" | "commit";

const COMMAND_LABELS: Readonly<Record<ImportCommand, string>> = {
  preview: "Preview",
  commit: "Commit",
};

const COMMAND_PENDING_LABELS: Readonly<Record<ImportCommand, string>> = {
  preview: "Queueing preview...",
  commit: "Queueing commit...",
};

export interface ImportsDetailProps {
  /** The import this screen shows. A foreign or unknown id is the API's `404`. */
  readonly importId: string;
  /**
   * The caller's permission keys when the shell knows them. Optional and UX-only,
   * with the same default-to-granted semantics the index uses: no page supplies a
   * list today, so `undefined` renders every action and the API stays
   * authoritative.
   */
  readonly permissions?: readonly string[];
  /**
   * How often to re-read a running import. Defaults to the documented
   * {@link IMPORT_POLL_INTERVAL_MS}; a test shortens it so it can assert both that
   * the poll happens and that it STOPS, without depending on a wall clock.
   */
  readonly pollIntervalMs?: number;
}

/**
 * `/app/imports/[importId]` — one import, watched and read ([[IMP-005]]).
 *
 * The screen exists for two moments that the index cannot serve: WHILE an import
 * runs, and AFTER it ends. Both are consequences of [[DEC-072]] and [[DEC-071]]:
 *
 * - **While it runs**, the state is `PREVIEWING` or `COMMITTING` and the only way
 *   to learn the outcome is to ask again — so this screen polls
 *   `GET /imports/:id` on {@link IMPORT_POLL_INTERVAL_MS} and stops the instant the
 *   state is anything else ({@link pollIntervalForState}). A queued command is
 *   announced in a live region and the phase the API ACCEPTED is seeded into the
 *   cache, so the watch starts on the next tick rather than after a read that may
 *   still answer the previous state.
 * - **After it ends**, the summary is read from the STORED row outcomes, not from
 *   the preview or commit response, which is what makes it survive a reload
 *   months later. The rows are a bounded page: a 5 000-row file renders 100 rows
 *   and a pager.
 *
 * Every state is rendered explicitly: loading, empty, error (the API's own
 * message), permission-denied and success. Nothing is computed here — the counts,
 * the verdicts, the reason codes and the messages are the API's values, printed
 * as given.
 */
export function ImportsDetail({
  importId,
  permissions,
  pollIntervalMs = IMPORT_POLL_INTERVAL_MS,
}: ImportsDetailProps): JSX.Element {
  const queryClient = useQueryClient();
  const canRun = permissionGranted(permissions, IMPORTS_RUN_PERMISSION);
  const canRead = permissionGranted(permissions, IMPORTS_READ_PERMISSION);
  const [offset, setOffset] = useState(0);

  const page = { limit: IMPORT_SUMMARY_PAGE_SIZE, offset };

  const detail = useQuery({
    queryKey: importDetailQueryKey(importId),
    queryFn: () => fetchImport(importId),
    retry: false,
    enabled: canRead,
    /**
     * The whole polling contract, and it is one expression: an interval while a
     * worker is expected to move the import, `false` everywhere else. `false` is
     * what CLEARS the timer, so `PREVIEWED`, `COMMITTED`, `FAILED`, `EXPIRED` and
     * `UPLOADED` cost no further requests.
     */
    refetchInterval: (query) => pollIntervalForState(query.state.data?.state, pollIntervalMs),
  });

  const job = detail.data;
  const jobState = job?.state;

  const summary = useQuery({
    // Keyed by the STATE as well (see `importSummaryQueryKey`): the stored
    // outcomes change when the import moves, so a transition re-reads the page
    // instead of leaving a pre-transition one on screen.
    queryKey: importSummaryQueryKey(importId, page, jobState ?? "UNKNOWN"),
    queryFn: () => fetchImportSummary(importId, page),
    retry: false,
    // Nothing to read before the import itself is known: the summary's key would
    // then be the placeholder one and every load would cost two requests.
    enabled: canRead && jobState !== undefined,
  });

  const command = useMutation({
    mutationFn: (action: ImportCommand): Promise<ImportPhaseAccepted> =>
      action === "preview" ? startImportPreview(importId) : startImportCommit(importId),
    onSuccess: (result) => {
      if (job !== undefined) {
        seedAcceptedPhase(queryClient, job, result.state);
      }
    },
  });

  const detailError = detail.error;
  const denied = isImportAccessDenied(detailError);
  const notice = importPhaseNotice(jobState);
  const action = jobState === undefined ? null : nextImportAction(jobState);

  return (
    <div data-testid="imports-detail" className="mx-auto max-w-5xl space-y-6">
      <header className="space-y-1">
        <p className="text-sm text-muted-foreground">
          <Link href="/app/imports" className="text-primary underline-offset-4 hover:underline">
            Imports
          </Link>
        </p>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Import</h1>
        <p className="text-sm text-muted-foreground">
          {job === undefined
            ? "One import, its state, and the verdict for every row it read."
            : `A ${IMPORT_ENTITY_LABELS[job.entity]} import. Every verdict below is the server's.`}
        </p>
        <p data-testid="imports-detail-id" className="font-mono text-xs text-muted-foreground">
          {importId}
        </p>
      </header>

      {!canRead && (
        <div
          role="alert"
          data-testid="imports-permission-denied"
          className="rounded-lg border border-destructive bg-destructive/10 p-4 text-sm text-destructive"
        >
          <p className="font-medium">Imports are not available to this account</p>
          <p>Reading an import requires the imports.read permission.</p>
        </div>
      )}

      {canRead && detail.isLoading && (
        <p data-testid="imports-loading" className="text-sm text-muted-foreground">
          Loading the import...
        </p>
      )}

      {canRead && detailError !== null && denied && (
        <div
          role="alert"
          data-testid="imports-permission-denied"
          className="rounded-lg border border-destructive bg-destructive/10 p-4 text-sm text-destructive"
        >
          <p className="font-medium">Imports are not available to this account</p>
          <p>{userFacingImportError(detailError)}</p>
        </div>
      )}

      {canRead && detailError !== null && !denied && (
        <div
          role="alert"
          data-testid="imports-error"
          className="rounded-lg border border-destructive bg-destructive/10 p-4 text-sm text-destructive"
        >
          <p className="font-medium">The import could not be loaded</p>
          {/* The API's own sentence, verbatim. A foreign or unknown id answers the
              same body, so this is also the "not found" state. */}
          <p>{userFacingImportError(detailError)}</p>
        </div>
      )}

      {job !== undefined && (
        <>
          {notice !== null && (
            <p
              role="status"
              data-testid="imports-polling"
              className="rounded-lg border border-border bg-secondary p-4 text-sm text-secondary-foreground"
            >
              {notice}
            </p>
          )}

          <Card data-testid="imports-summary-card">
            <CardHeader>
              <CardTitle>State and counters</CardTitle>
              <CardDescription>
                Written by the transition that produced them, so they cannot disagree with what the
                import actually did.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Entity" testId="imports-entity">
                  {IMPORT_ENTITY_LABELS[job.entity]}
                </Field>
                <Field label="State" testId="imports-state">
                  {job.state}
                </Field>
                <Field label="Rows created" testId="imports-created">
                  {job.createdCount}
                </Field>
                <Field label="Rows failed" testId="imports-failed">
                  {job.failedCount}
                </Field>
                <Field label="Suspected duplicates" testId="imports-suspected">
                  {job.suspectedDuplicateCount}
                </Field>
                <Field label="Uploaded at" testId="imports-created-at">
                  <time dateTime={job.createdAt}>{job.createdAt}</time>
                </Field>
              </dl>

              {job.failureReason !== null && (
                <div
                  role="alert"
                  data-testid="imports-failure-reason"
                  className="rounded-lg border border-destructive bg-destructive/10 p-4 text-sm text-destructive"
                >
                  <p className="font-medium">The import failed</p>
                  <p>{job.failureReason}</p>
                </div>
              )}

              <p data-testid="imports-artefact" className="text-xs text-muted-foreground">
                {job.artefactDeletedAt === null
                  ? `The uploaded file is removed after ${job.artefactExpiresAt}.`
                  : `The uploaded file was removed at ${job.artefactDeletedAt}.`}
              </p>

              {canRun && action !== null && (
                <div className="flex flex-wrap items-center gap-3">
                  <Button
                    type="button"
                    data-testid={`imports-${action}`}
                    className={controlButtonClassName}
                    disabled={command.isPending}
                    onClick={() => command.mutate(action)}
                  >
                    {command.isPending ? COMMAND_PENDING_LABELS[action] : COMMAND_LABELS[action]}
                  </Button>
                  <p className="text-xs text-muted-foreground">
                    {action === "preview"
                      ? "The preview validates every row and writes nothing."
                      : "The commit writes the rows the preview accepted. It cannot be undone from here."}
                  </p>
                </div>
              )}

              {command.error !== null && (
                <div
                  role="alert"
                  data-testid="imports-command-error"
                  className="rounded-lg border border-destructive bg-destructive/10 p-4 text-sm text-destructive"
                >
                  <p className="font-medium">The command was refused</p>
                  <p>{userFacingImportError(command.error)}</p>
                </div>
              )}
            </CardContent>
          </Card>

          <Card data-testid="imports-outcomes">
            <CardHeader>
              <CardTitle>Row outcomes</CardTitle>
              <CardDescription>
                One stored verdict per data row, in the file&apos;s own order. An errored row and a
                suspected duplicate are different facts, and both are stated in words.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {summary.isLoading && (
                <p data-testid="imports-summary-loading" className="text-sm text-muted-foreground">
                  Loading the row outcomes...
                </p>
              )}

              {summary.error !== null && (
                <div
                  role="alert"
                  data-testid="imports-summary-error"
                  className="rounded-lg border border-destructive bg-destructive/10 p-4 text-sm text-destructive"
                >
                  <p className="font-medium">The row outcomes could not be loaded</p>
                  <p>{userFacingImportError(summary.error)}</p>
                </div>
              )}

              {summary.data !== undefined && (
                <>
                  {summary.data.rows.length === 0 ? (
                    <p
                      data-testid="imports-summary-empty"
                      className="text-sm text-muted-foreground"
                    >
                      {job.state === "UPLOADED"
                        ? "No row outcomes are stored yet: the file has not been previewed."
                        : "No row outcomes are stored for this import."}
                    </p>
                  ) : (
                    <OutcomeTable summary={summary.data} />
                  )}

                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p data-testid="imports-summary-page" className="text-sm text-muted-foreground">
                      {summaryPageLabel(
                        summary.data.page,
                        summary.data.totals,
                        summary.data.rows.length
                      )}
                    </p>
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        data-testid="imports-summary-previous"
                        disabled={offset === 0}
                        onClick={() => {
                          setOffset((current) => Math.max(0, current - IMPORT_SUMMARY_PAGE_SIZE));
                        }}
                      >
                        Previous
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        data-testid="imports-summary-next"
                        disabled={
                          offset + summary.data.rows.length >= summaryRowTotal(summary.data.totals)
                        }
                        onClick={() => {
                          setOffset((current) => current + IMPORT_SUMMARY_PAGE_SIZE);
                        }}
                      >
                        Next
                      </Button>
                    </div>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function Field({
  label,
  testId,
  children,
}: {
  readonly label: string;
  readonly testId: string;
  readonly children: ReactNode;
}): JSX.Element {
  return (
    <div className="space-y-1">
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd data-testid={testId} className="text-sm text-foreground">
        {children}
      </dd>
    </div>
  );
}

/**
 * One page of stored row outcomes.
 *
 * The two facts the Story insists are separable are separated in TEXT: the status
 * is the API's own token (`CREATE` or `FAILED`), the reason code and message say
 * why a row failed, and the last column spells out a suspected duplicate as
 * "Suspected duplicate (warning)". So a flagged row that was still created reads
 * as `CREATE` PLUS a warning, and an errored row reads as `FAILED` plus its
 * reason — colour is never carrying the distinction alone.
 */
function OutcomeTable({ summary }: { readonly summary: ImportSummary }): JSX.Element {
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead className="bg-secondary text-secondary-foreground">
          <tr>
            <th scope="col" className="px-3 py-2 text-left font-medium">
              Row
            </th>
            <th scope="col" className="px-3 py-2 text-left font-medium">
              Status
            </th>
            <th scope="col" className="px-3 py-2 text-left font-medium">
              Reason
            </th>
            <th scope="col" className="px-3 py-2 text-left font-medium">
              Message
            </th>
            <th scope="col" className="px-3 py-2 text-left font-medium">
              Warning
            </th>
          </tr>
        </thead>
        <tbody>
          {summary.rows.map((row) => (
            <tr
              key={row.rowNumber}
              data-testid="imports-outcome-row"
              className="border-t border-border"
            >
              <td data-testid="imports-outcome-row-number" className="px-3 py-2 text-foreground">
                {row.rowNumber}
              </td>
              <td
                data-testid="imports-outcome-status"
                className="whitespace-nowrap px-3 py-2 font-medium text-foreground"
              >
                {row.status}
              </td>
              <td
                data-testid="imports-outcome-reason"
                className="whitespace-nowrap px-3 py-2 text-foreground"
              >
                {importRowReasonText(row)}
              </td>
              <td data-testid="imports-outcome-message" className="px-3 py-2 text-foreground">
                {importRowMessageText(row)}
              </td>
              <td
                data-testid="imports-outcome-warning"
                className="whitespace-nowrap px-3 py-2 text-foreground"
              >
                {importRowWarningText(row.suspectedDuplicate) === ""
                  ? "—"
                  : importRowWarningText(row.suspectedDuplicate)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
