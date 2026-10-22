"use client";

import type { JSX } from "react";
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
  fetchImports,
  IMPORT_ENTITIES,
  IMPORT_ENTITY_LABELS,
  importsListQueryKey,
  isImportAccessDenied,
  startImportCommit,
  startImportPreview,
  uploadImport,
  userFacingImportError,
  type ImportEntity,
  type ImportJob,
  type ImportJobState,
  type ImportPhaseAccepted,
  type ImportUploadAccepted,
} from "./imports-api";
import {
  IMPORTS_READ_PERMISSION,
  IMPORTS_RUN_PERMISSION,
  nextImportAction,
  permissionGranted,
} from "./imports-display";

const controlClassName =
  "h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

/** The two commands this screen can issue, named as the surface labels them. */
type ImportCommand = "preview" | "commit";

const COMMAND_LABELS: Readonly<Record<ImportCommand, string>> = {
  preview: "Preview",
  commit: "Commit",
};

/**
 * A phase this screen just QUEUED, remembered against the state the row had when
 * the command was issued.
 *
 * A trigger answers `{ importId, state }` with the phase it queued, while the row
 * itself only reaches that phase when the worker claims it ([[DEC-072]]). Without
 * this, the row would keep reading `UPLOADED` until the next refetch and offer the
 * same command again. The entry is only applied while the row still reads the
 * state it had (`before`), so a refetch that moved the import on is NEVER masked
 * by a stale local note — the API's value wins the moment it differs.
 */
interface QueuedPhase {
  readonly before: ImportJobState;
  readonly accepted: ImportJobState;
}

export interface ImportsIndexProps {
  /**
   * The caller's permission keys when the shell knows them.
   *
   * Optional, and the same `permissionGranted` default-to-granted semantics the
   * reports workspace and the staff nav use: no page supplies a list today (the
   * reports surface has the same gap), so `undefined` shows every action and the
   * API stays authoritative. An explicit list without `imports.run` HIDES the
   * upload and the commands; one without `imports.read` hides the history.
   */
  readonly permissions?: readonly string[];
}

/**
 * `/app/imports` — upload a CSV and read the tenant's import history
 * ([[IMP-005]]).
 *
 * The screen exists because [[DEC-072]] made every import asynchronous: an upload
 * answers with an identifier to watch, never with a result. So the index has two
 * jobs — accept a file, and tell the operator what each import is waiting for —
 * and the watching itself happens on the detail screen.
 *
 * Every state is rendered explicitly: loading, empty, error (the API's own
 * message, verbatim), permission-denied, and success. The screen computes
 * nothing: the entity, the state, the three counters and the instant are the
 * API's values printed as given.
 */
export function ImportsIndex({ permissions }: ImportsIndexProps = {}): JSX.Element {
  const queryClient = useQueryClient();
  const canRun = permissionGranted(permissions, IMPORTS_RUN_PERMISSION);
  const canRead = permissionGranted(permissions, IMPORTS_READ_PERMISSION);

  const [uploadEntity, setUploadEntity] = useState<ImportEntity>("CUSTOMER");
  const [file, setFile] = useState<File | null>(null);
  const [accepted, setAccepted] = useState<ImportUploadAccepted | null>(null);
  const [entityFilter, setEntityFilter] = useState<ImportEntity | "">("");
  const [queued, setQueued] = useState<Readonly<Record<string, QueuedPhase>>>({});

  const history = useQuery({
    // Keyed by the FILTER: two filters are two answers, and the key is what the
    // upload and the two commands invalidate.
    queryKey: importsListQueryKey(entityFilter),
    queryFn: () => fetchImports(entityFilter),
    retry: false,
    // Without `imports.read` there is nothing to ask for: the panel below states
    // it, and no request is issued the API would refuse anyway.
    enabled: canRead,
  });

  const upload = useMutation({
    mutationFn: (input: { entity: ImportEntity; file: File }) =>
      uploadImport(input.entity, input.file),
    onSuccess: (result) => {
      setAccepted(result);
      setFile(null);
      // The new import appears in the history as soon as the API lists it; the
      // detail screen is where its progress is watched.
      void queryClient.invalidateQueries({ queryKey: ["imports", "list"] });
    },
  });

  const command = useMutation({
    mutationFn: (input: { job: ImportJob; action: ImportCommand }): Promise<ImportPhaseAccepted> =>
      input.action === "preview"
        ? startImportPreview(input.job.id)
        : startImportCommit(input.job.id),
    onSuccess: (result, input) => {
      setQueued((previous) => ({
        ...previous,
        [input.job.id]: { before: input.job.state, accepted: result.state },
      }));
      void queryClient.invalidateQueries({ queryKey: ["imports", "list"] });
    },
  });

  /**
   * The state this row reads as: the API's value, unless this screen just queued
   * a phase for it off that same value (see {@link QueuedPhase}).
   */
  function stateOf(job: ImportJob): ImportJobState {
    const entry = queued[job.id];
    return entry?.before === job.state ? entry.accepted : job.state;
  }

  const historyError = history.error;
  const historyDenied = isImportAccessDenied(historyError);
  const commandFailed = command.error;
  const rows = history.data ?? [];

  return (
    <div data-testid="imports-index" className="mx-auto max-w-5xl space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Imports</h1>
        <p className="text-sm text-muted-foreground">
          Upload a file, preview exactly what it will do, and read why each row did or did not
          become a record. Every import runs in the background: this screen accepts the file and
          tells you what it is waiting for.
        </p>
      </header>

      {/* Without `imports.run` the upload is HIDDEN, not disabled (the Story asks
          for hidden): a control the caller may not use is not a hint, it is noise.
          The API refuses the upload regardless of this prop. */}
      {canRun && (
        <Card data-testid="imports-upload">
          <CardHeader>
            <CardTitle>Upload a file</CardTitle>
            <CardDescription>
              The accepted format is CSV (one header row, then one record per row). The file is
              validated by the server: its refusal, if any, is shown here in its own words.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-2">
                <label htmlFor="import-entity" className="text-sm font-medium">
                  Import entity
                </label>
                <select
                  id="import-entity"
                  className={controlClassName}
                  value={uploadEntity}
                  onChange={(event) => {
                    const value = event.target.value;
                    if (value === "CUSTOMER" || value === "PATIENT") {
                      setUploadEntity(value);
                    }
                  }}
                >
                  {IMPORT_ENTITIES.map((entity) => (
                    <option key={entity} value={entity}>
                      {IMPORT_ENTITY_LABELS[entity]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <label htmlFor="import-file" className="text-sm font-medium">
                  CSV file
                </label>
                {/*
                  No `accept` attribute on purpose: pre-filtering the picker would
                  make the server's by-name refusal of a spreadsheet unreachable,
                  and that refusal — "export the data as CSV" — is the message the
                  operator needs. The accepted format is stated above, and the rule
                  itself stays the server's ([[DEC-068]]).
                */}
                <input
                  id="import-file"
                  data-testid="import-file"
                  type="file"
                  className={controlClassName}
                  onChange={(event) => {
                    const selected = event.target.files?.[0];
                    setFile(selected ?? null);
                  }}
                />
              </div>
              <Button
                type="button"
                disabled={file === null || upload.isPending}
                onClick={() => {
                  if (file !== null) upload.mutate({ entity: uploadEntity, file });
                }}
              >
                {upload.isPending ? "Uploading..." : "Upload"}
              </Button>
            </div>

            {upload.error !== null && (
              <div
                role="alert"
                data-testid="imports-upload-error"
                className="rounded-lg border border-destructive bg-destructive/10 p-4 text-sm text-destructive"
              >
                <p className="font-medium">The file was not accepted</p>
                {/* The server's own sentence, verbatim: it names the accepted
                    format, the size cap or the spreadsheet refusal, and no
                    client-side copy of that rule could say it better. */}
                <p>{userFacingImportError(upload.error)}</p>
              </div>
            )}

            {accepted !== null && (
              <div
                role="status"
                data-testid="imports-upload-accepted"
                className="space-y-1 rounded-lg border border-border bg-secondary p-4 text-sm text-secondary-foreground"
              >
                <p className="font-medium">Import accepted</p>
                <p>
                  The file is stored and the import is <strong>{accepted.state}</strong>. Open it to
                  preview what it will do.
                </p>
                <Link
                  data-testid="imports-upload-accepted-link"
                  href={`/app/imports/${accepted.importId}`}
                  className="text-primary underline-offset-4 hover:underline"
                >
                  Open the import
                </Link>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Card data-testid="imports-history">
        <CardHeader>
          <CardTitle>Import history</CardTitle>
          <CardDescription>
            Newest first, as the API lists them. Counts are the ones the import itself recorded.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {canRead ? (
            <>
              <div className="flex flex-wrap items-end gap-3">
                <div className="space-y-2">
                  <label htmlFor="import-entity-filter" className="text-sm font-medium">
                    Filter by entity
                  </label>
                  <select
                    id="import-entity-filter"
                    className={controlClassName}
                    value={entityFilter}
                    onChange={(event) => {
                      const value = event.target.value;
                      setEntityFilter(value === "CUSTOMER" || value === "PATIENT" ? value : "");
                    }}
                  >
                    <option value="">All entities</option>
                    {IMPORT_ENTITIES.map((entity) => (
                      <option key={entity} value={entity}>
                        {IMPORT_ENTITY_LABELS[entity]}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {commandFailed !== null && (
                <div
                  role="alert"
                  data-testid="imports-command-error"
                  className="rounded-lg border border-destructive bg-destructive/10 p-4 text-sm text-destructive"
                >
                  <p className="font-medium">The import was not started</p>
                  {/* The API's own refusal, verbatim: the lifecycle `409` says the
                      import is not in a state that allows the transition, and only
                      the API knows which state that is. */}
                  <p>{userFacingImportError(commandFailed)}</p>
                </div>
              )}

              {history.isLoading && (
                <p data-testid="imports-loading" className="text-sm text-muted-foreground">
                  Loading imports...
                </p>
              )}

              {historyError !== null && historyDenied && (
                <div
                  role="alert"
                  data-testid="imports-permission-denied"
                  className="rounded-lg border border-destructive bg-destructive/10 p-4 text-sm text-destructive"
                >
                  <p className="font-medium">Imports are not available to this account</p>
                  <p>{userFacingImportError(historyError)}</p>
                </div>
              )}

              {historyError !== null && !historyDenied && (
                <div
                  role="alert"
                  data-testid="imports-error"
                  className="rounded-lg border border-destructive bg-destructive/10 p-4 text-sm text-destructive"
                >
                  <p className="font-medium">The import history could not be loaded</p>
                  <p>{userFacingImportError(historyError)}</p>
                </div>
              )}

              {history.data !== undefined && rows.length === 0 && historyError === null && (
                <p data-testid="imports-empty" className="text-sm text-muted-foreground">
                  {entityFilter === ""
                    ? "This tenant has not run an import yet."
                    : `This tenant has not run an import for ${IMPORT_ENTITY_LABELS[entityFilter]}.`}
                </p>
              )}

              {rows.length > 0 && (
                <div className="overflow-x-auto rounded-lg border">
                  <table className="w-full text-sm">
                    <thead className="bg-secondary text-secondary-foreground">
                      <tr>
                        <th scope="col" className="px-3 py-2 text-left font-medium">
                          Entity
                        </th>
                        <th scope="col" className="px-3 py-2 text-left font-medium">
                          State
                        </th>
                        <th scope="col" className="px-3 py-2 text-left font-medium">
                          Created
                        </th>
                        <th scope="col" className="px-3 py-2 text-left font-medium">
                          Failed
                        </th>
                        <th scope="col" className="px-3 py-2 text-left font-medium">
                          Suspected duplicates
                        </th>
                        <th scope="col" className="px-3 py-2 text-left font-medium">
                          Imported at
                        </th>
                        <th scope="col" className="px-3 py-2 text-left font-medium">
                          Next action
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((job) => {
                        const state = stateOf(job);
                        const action = nextImportAction(state);
                        const isQueued = command.isPending && command.variables?.job.id === job.id;
                        return (
                          <tr
                            key={job.id}
                            data-testid="imports-row"
                            className="border-t border-border"
                          >
                            <td className="whitespace-nowrap px-3 py-2 text-foreground">
                              {IMPORT_ENTITY_LABELS[job.entity]}
                            </td>
                            <td
                              data-testid="imports-row-state"
                              className="whitespace-nowrap px-3 py-2 font-medium text-foreground"
                            >
                              {state}
                            </td>
                            <td
                              data-testid="imports-row-created"
                              className="whitespace-nowrap px-3 py-2 text-foreground"
                            >
                              {job.createdCount}
                            </td>
                            <td
                              data-testid="imports-row-failed"
                              className="whitespace-nowrap px-3 py-2 text-foreground"
                            >
                              {job.failedCount}
                            </td>
                            <td
                              data-testid="imports-row-suspected"
                              className="whitespace-nowrap px-3 py-2 text-foreground"
                            >
                              {job.suspectedDuplicateCount}
                            </td>
                            <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
                              <time dateTime={job.createdAt}>{job.createdAt}</time>
                            </td>
                            <td className="whitespace-nowrap px-3 py-2">
                              <div className="flex items-center gap-3">
                                {canRun && action !== null && (
                                  <Button
                                    type="button"
                                    variant="outline"
                                    data-testid="imports-row-action"
                                    disabled={isQueued}
                                    onClick={() => command.mutate({ job, action })}
                                  >
                                    {isQueued
                                      ? `${COMMAND_LABELS[action]}...`
                                      : COMMAND_LABELS[action]}
                                  </Button>
                                )}
                                <Link
                                  data-testid="imports-row-open"
                                  href={`/app/imports/${job.id}`}
                                  className="text-primary underline-offset-4 hover:underline"
                                >
                                  Open
                                </Link>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          ) : (
            <div
              role="alert"
              data-testid="imports-permission-denied"
              className="rounded-lg border border-destructive bg-destructive/10 p-4 text-sm text-destructive"
            >
              <p className="font-medium">Imports are not available to this account</p>
              <p>Reading the import history requires the imports.read permission.</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
