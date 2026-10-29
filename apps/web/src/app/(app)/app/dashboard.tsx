"use client";

import type { JSX, ReactNode } from "react";
import { useState } from "react";
import Link from "next/link";
import { Button } from "@newsaas/ui/components/ui/button";
import { Icon } from "@newsaas/ui/components/ui/icon";
import { Skeleton } from "@newsaas/ui/components/ui/skeleton";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@newsaas/ui/components/ui/card";
import type { ReportCode } from "@/app/api/reports/report-codes";
import { formatEsPyDecimal, formatStaffMoney } from "@/lib/es-py-format";
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
 * - the card displays the report's own fields, using exact-string es-PY
 *   punctuation for money and decimals ([[DEC-080]]). The API remains the only
 *   aggregation path: no amount is summed, divided or rounded here, and the
 *   signed cash difference preserves every nonzero fractional digit.
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

const valueClassName = "text-3xl font-semibold tracking-tight tabular-nums text-foreground";

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
    <Card data-testid={testId} className="flex flex-col transition-colors hover:border-primary/30">
      <CardHeader className="flex-row items-start justify-between gap-3 space-y-0 pb-4">
        <div className="space-y-2">
          <CardTitle className="text-sm font-medium">
            <Link
              data-testid={`${testId}-link`}
              href={`/app/reports/${code}`}
              className="text-foreground underline-offset-4 hover:text-primary hover:underline"
            >
              {title}
            </Link>
          </CardTitle>
          <CardDescription className="min-h-10 text-xs leading-relaxed">
            {description}
          </CardDescription>
        </div>
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-secondary text-secondary-foreground">
          <Icon
            name={code === "low-stock" ? "box" : code === "cash-sessions" ? "wallet" : "chart"}
          />
        </span>
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
      <div data-testid={`${testId}-loading`} role="status" className="space-y-3">
        <span className="sr-only">Cargando…</span>
        <Skeleton className="h-9 w-28" />
        <Skeleton className="h-3 w-40" />
      </div>
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
          {denied ? "No disponible para esta cuenta" : "No se pudo cargar este valor"}
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
    <div data-testid="app-dashboard" className="space-y-8 text-foreground">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-2">
          <p className="page-eyebrow">Resumen del espacio de trabajo</p>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Panel</h1>
          <p className="text-sm text-muted-foreground">
            Una vista clara de tus ventas, caja e inventario. Elegí un período para revisar los
            resultados.
          </p>
        </div>
        <div className="space-y-2">
          <label htmlFor="dashboard-period" className="text-sm font-medium">
            Período
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
          title="Ventas brutas"
          code="sales-by-period"
          description="Ingresos de ventas completadas."
          query={sales}
          renderValue={(response) =>
            response.report === "sales-by-period" ? (
              <>
                {/* Localized for reading only; the exact API decimal remains the source of truth. */}
                <p className={valueClassName}>
                  {formatStaffMoney(response.totalGross, response.currency)}
                </p>
                <p className="text-xs text-muted-foreground">Ventas completadas</p>
              </>
            ) : (
              NO_VALUE
            )
          }
        />

        <DashboardCard
          testId="dashboard-card-sales"
          title="Ventas"
          code="sales-by-period"
          description="Cantidad de ventas completadas en el período."
          query={sales}
          renderValue={(response) =>
            response.report === "sales-by-period" ? (
              <>
                {/* A count from the API; the frontend does not recompute it. */}
                <p className={valueClassName}>{response.saleCount}</p>
                <p className="text-xs text-muted-foreground">
                  Ventas completadas en el período seleccionado.
                </p>
              </>
            ) : (
              NO_VALUE
            )
          }
        />

        <DashboardCard
          testId="dashboard-card-cash-difference"
          title="Diferencia de caja"
          code="cash-sessions"
          description="Diferencia entre el monto contado y el esperado en cajas cerradas."
          query={cashSessions}
          renderValue={(response) =>
            response.report === "cash-sessions" ? (
              <>
                {/* May be negative, and the sign IS the information: a drawer
                    that was short must not read like one that was over. */}
                <p className={valueClassName}>{formatEsPyDecimal(response.totals.difference)}</p>
                <p className="text-xs text-muted-foreground">
                  En {response.rows.length} caja{response.rows.length === 1 ? "" : "s"} cerrada
                  {response.rows.length === 1 ? "" : "s"} durante el período.
                </p>
              </>
            ) : (
              NO_VALUE
            )
          }
        />

        <DashboardCard
          testId="dashboard-card-low-stock"
          title="Stock bajo"
          code="low-stock"
          description="Alertas actuales de stock, sin depender del período."
          query={lowStock}
          renderValue={(response) =>
            response.report === "low-stock" ? (
              response.thresholdsConfigured ? (
                <>
                  <p className={valueClassName}>{response.rows.length}</p>
                  <p className="text-xs text-muted-foreground">
                    {response.rows.length === 1 ? "Artículo en" : "Artículos en"} su umbral mínimo o
                    por debajo.
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
                    Aún no hay artículos con umbral de stock bajo
                  </p>
                  <p className="text-xs text-muted-foreground">
                    No se supervisa el stock hasta que se configure un umbral.
                  </p>
                  <Link
                    data-testid="dashboard-card-low-stock-configure"
                    href="/app/catalog"
                    className="inline-flex text-xs font-medium text-primary underline-offset-4 hover:underline"
                  >
                    Configurar un umbral en el catálogo
                  </Link>
                </>
              )
            ) : (
              NO_VALUE
            )
          }
        />
      </div>
      <section aria-label="Accesos rápidos" className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">¿Por dónde querés empezar?</CardTitle>
            <CardDescription>Tené a mano las tareas de todos los días.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-3">
            {(
              [
                {
                  href: "/app/agenda",
                  title: "Abrir agenda",
                  description: "Turnos y disponibilidad",
                  icon: "calendar",
                },
                {
                  href: "/app/patients",
                  title: "Buscar un paciente",
                  description: "Ficha e historial clínico",
                  icon: "activity",
                },
                {
                  href: "/app/sales",
                  title: "Abrir punto de venta",
                  description: "Productos, servicios y cobros",
                  icon: "receipt",
                },
              ] as const
            ).map((action) => (
              <Link
                key={action.href}
                href={action.href}
                className="group rounded-lg border bg-background/50 p-4 transition-colors hover:border-primary/40 hover:bg-secondary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <div className="mb-5 flex items-center justify-between text-primary">
                  <Icon name={action.icon} className="size-5" />
                  <Icon
                    name="arrow"
                    className="size-4 text-muted-foreground transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 motion-reduce:transform-none"
                  />
                </div>
                <p className="text-sm font-semibold">{action.title}</p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  {action.description}
                </p>
              </Link>
            ))}
          </CardContent>
        </Card>
        <Card className="bg-secondary/40">
          <CardHeader>
            <div className="mb-3 flex size-10 items-center justify-center rounded-lg border bg-card text-primary">
              <Icon name="chart" className="size-5" />
            </div>
            <CardTitle className="text-base">Revisá más en detalle</CardTitle>
            <CardDescription>
              Consultá con más detalle los informes de ventas, stock y operaciones.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline" className="w-full justify-between">
              <Link href="/app/reports">
                Ver informes
                <Icon name="arrow" />
              </Link>
            </Button>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
