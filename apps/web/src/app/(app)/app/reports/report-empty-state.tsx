"use client";

import type { JSX } from "react";
import Link from "next/link";
import { formatEsPyDateOnly } from "@/lib/es-py-format";
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
          title="Ningún ítem está en su umbral o por debajo"
          body="Hay umbrales configurados y cada ítem controlado está por encima del suyo, así que hoy no hace falta reponer nada."
          action={null}
        />
      ) : (
        <EmptyPanel
          testId="report-empty-low-stock-thresholds"
          title="Ningún ítem tiene un umbral de stock bajo todavía"
          body="Este informe lista solo los ítems que tienen su propio umbral cargado, y ninguno lo tiene: sin umbral, el ítem no se controla. Queda vacío a propósito hasta que cargues un umbral en un ítem del catálogo, no porque el stock esté bien."
          action={{ href: "/app/catalog", label: "Abrí el catálogo para cargar un umbral" }}
        />
      );
    case "vaccines-due":
    case "deworming-due":
      return (
        <EmptyPanel
          testId="report-empty-due"
          title={
            response.report === "vaccines-due"
              ? "Ninguna vacunación tiene fecha de vencimiento"
              : "Ninguna desparasitación tiene fecha de vencimiento"
          }
          body={`Este informe lista solo los registros en los que el personal cargó la próxima fecha de vencimiento; no se calcula ningún intervalo de refuerzo. No hay nada vencido ni por vencer dentro de ${response.horizonDays} días desde el ${formatEsPyDateOnly(response.asOfDate)} porque ningún registro tiene fecha de vencimiento.`}
          action={{
            href: "/app/patients",
            label: "Abrí pacientes para cargar una fecha de vencimiento",
          }}
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
          title="No se registró nada en este período"
          body={`No hay filas del ${formatEsPyDateOnly(fromDate)} al ${formatEsPyDateOnly(toDate)} (${timeZone}).`}
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
