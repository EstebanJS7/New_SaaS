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
import { formatEsPyInstant } from "@/lib/es-py-format";
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
  importJobStateLabel,
  importPhaseNotice,
  importRowMessageText,
  importRowReasonText,
  importRowStatusLabel,
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
  preview: "Previsualizar",
  commit: "Confirmar",
};

const COMMAND_PENDING_LABELS: Readonly<Record<ImportCommand, string>> = {
  preview: "Iniciando previsualización…",
  commit: "Iniciando confirmación…",
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
            Importaciones
          </Link>
        </p>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Importación</h1>
        <p className="text-sm text-muted-foreground">
          {job === undefined
            ? "Una importación, su estado y el resultado de cada fila que leyó."
            : `Importación de ${IMPORT_ENTITY_LABELS[job.entity].toLowerCase()}. Cada resultado de abajo lo decidió el servidor.`}
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
          <p className="font-medium">Las importaciones no están disponibles para esta cuenta</p>
          <p>Ver una importación requiere el permiso imports.read.</p>
        </div>
      )}

      {canRead && detail.isLoading && (
        <p data-testid="imports-loading" className="text-sm text-muted-foreground">
          Cargando la importación…
        </p>
      )}

      {canRead && detailError !== null && denied && (
        <div
          role="alert"
          data-testid="imports-permission-denied"
          className="rounded-lg border border-destructive bg-destructive/10 p-4 text-sm text-destructive"
        >
          <p className="font-medium">Las importaciones no están disponibles para esta cuenta</p>
          <p>{userFacingImportError(detailError)}</p>
        </div>
      )}

      {canRead && detailError !== null && !denied && (
        <div
          role="alert"
          data-testid="imports-error"
          className="rounded-lg border border-destructive bg-destructive/10 p-4 text-sm text-destructive"
        >
          <p className="font-medium">No se pudo cargar la importación</p>
          {/* A foreign or unknown id answers the same `404`, so this is also the
              "not found" state. */}
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
              <CardTitle>Estado y conteos</CardTitle>
              <CardDescription>
                Los registra la misma transición que los produjo, así que coinciden con lo que la
                importación realmente hizo.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Entidad" testId="imports-entity">
                  {IMPORT_ENTITY_LABELS[job.entity]}
                </Field>
                <Field label="Estado" testId="imports-state">
                  {importJobStateLabel(job.state)}
                </Field>
                <Field label="Filas creadas" testId="imports-created">
                  {job.createdCount}
                </Field>
                <Field label="Filas con error" testId="imports-failed">
                  {job.failedCount}
                </Field>
                <Field label="Posibles duplicados" testId="imports-suspected">
                  {job.suspectedDuplicateCount}
                </Field>
                <Field label="Subida el" testId="imports-created-at">
                  <time dateTime={job.createdAt}>{formatEsPyInstant(job.createdAt)}</time>
                </Field>
              </dl>

              {job.failureReason !== null && (
                <div
                  role="alert"
                  data-testid="imports-failure-reason"
                  className="rounded-lg border border-destructive bg-destructive/10 p-4 text-sm text-destructive"
                >
                  <p className="font-medium">La importación falló</p>
                  <p>{job.failureReason}</p>
                </div>
              )}

              <p data-testid="imports-artefact" className="text-xs text-muted-foreground">
                {job.artefactDeletedAt === null
                  ? `El archivo subido se elimina después del ${formatEsPyInstant(job.artefactExpiresAt)}.`
                  : `El archivo subido se eliminó el ${formatEsPyInstant(job.artefactDeletedAt)}.`}
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
                      ? "La previsualización valida cada fila y no guarda nada."
                      : "La confirmación guarda las filas que aceptó la previsualización. No se puede deshacer desde acá."}
                  </p>
                </div>
              )}

              {command.error !== null && (
                <div
                  role="alert"
                  data-testid="imports-command-error"
                  className="rounded-lg border border-destructive bg-destructive/10 p-4 text-sm text-destructive"
                >
                  <p className="font-medium">El comando fue rechazado</p>
                  <p>{userFacingImportError(command.error)}</p>
                </div>
              )}
            </CardContent>
          </Card>

          <Card data-testid="imports-outcomes">
            <CardHeader>
              <CardTitle>Resultados por fila</CardTitle>
              <CardDescription>
                Un resultado guardado por cada fila de datos, en el orden del archivo. Una fila con
                error y un posible duplicado son hechos distintos, y los dos se indican con
                palabras.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {summary.isLoading && (
                <p data-testid="imports-summary-loading" className="text-sm text-muted-foreground">
                  Cargando los resultados de filas…
                </p>
              )}

              {summary.error !== null && (
                <div
                  role="alert"
                  data-testid="imports-summary-error"
                  className="rounded-lg border border-destructive bg-destructive/10 p-4 text-sm text-destructive"
                >
                  <p className="font-medium">No se pudieron cargar los resultados de filas</p>
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
                        ? "Todavía no hay resultados de filas guardados: el archivo no se previsualizó."
                        : "No hay resultados de filas guardados para esta importación."}
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
                        Anterior
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
                        Siguiente
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
              Fila
            </th>
            <th scope="col" className="px-3 py-2 text-left font-medium">
              Resultado
            </th>
            <th scope="col" className="px-3 py-2 text-left font-medium">
              Motivo
            </th>
            <th scope="col" className="px-3 py-2 text-left font-medium">
              Mensaje
            </th>
            <th scope="col" className="px-3 py-2 text-left font-medium">
              Advertencia
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
                {importRowStatusLabel(row.status)}
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
