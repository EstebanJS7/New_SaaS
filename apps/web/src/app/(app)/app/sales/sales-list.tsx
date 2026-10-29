"use client";

import type { JSX } from "react";
import { useState } from "react";
import { Input } from "@newsaas/ui/components/ui/input";
import { Icon } from "@newsaas/ui/components/ui/icon";
import { Badge } from "@newsaas/ui/components/ui/badge";
import { EmptyState, ErrorState, ListSkeleton } from "@/components/feedback";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@newsaas/ui/components/ui/button";
import { SALE_STATUS_LABELS, formatDate } from "./sales-display";
import { ApiRequestError, searchSales, userFacingSaleError } from "./sale-search-api";
import { useSalesListState } from "./sales-list-state";

export function SalesList(): JSX.Element {
  const [state, setState] = useSalesListState();
  const [search, setSearch] = useState(state.q);
  const [validation, setValidation] = useState<string>();
  const query = useQuery({
    queryKey: ["sales", "list", "search", state],
    queryFn: ({ signal }) => searchSales(state, signal),
    staleTime: 0,
  });
  const result = query.data;
  const reset = () => {
    setSearch("");
    setValidation(undefined);
    setState({ q: "", page: 1, status: "all", sort: "recent" });
  };
  const count = (value: number) => value.toLocaleString("es-PY");
  return (
    <div className="space-y-6">
      <div className="page-heading">
        <div>
          <p className="page-eyebrow">Comercio / Ventas</p>
          <h1 className="text-2xl font-semibold tracking-tight">Ventas</h1>
          <p className="text-sm text-muted-foreground">
            Buscá ventas guardadas y consultá su estado.
          </p>
        </div>
        <Button type="button" asChild>
          <Link href="/app/sales">
            <Icon name="plus" />
            Punto de venta
          </Link>
        </Button>
      </div>

      <form
        className="space-y-3 rounded-lg border border-border bg-card p-4"
        onSubmit={(event) => {
          event.preventDefault();
          const q = search.trim();
          if ((q.length > 0 && q.length < 2) || q.length > 80) {
            setValidation("Ingresá entre 2 y 80 caracteres o dejá la búsqueda vacía.");
            return;
          }
          setValidation(undefined);
          setState({ ...state, q, page: 1 });
        }}
      >
        <label htmlFor="sale-search" className="text-sm font-medium">
          Buscar ventas
        </label>
        <div className="flex flex-wrap items-start gap-2">
          <div className="relative min-w-0 flex-1 sm:min-w-64">
            <Icon
              name="search"
              className="pointer-events-none absolute left-3 top-3 text-muted-foreground"
            />
            <Input
              id="sale-search"
              type="search"
              autoComplete="off"
              maxLength={80}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={
                result?.canReadCustomers
                  ? "UUID completo o nombre del cliente"
                  : "UUID completo de la venta"
              }
              aria-invalid={Boolean(validation)}
              aria-describedby={
                validation ? "sale-search-help sale-search-error" : "sale-search-help"
              }
              className="pl-10"
            />
          </div>
          <Button type="submit" disabled={query.isFetching}>
            Buscar
          </Button>
          <Button type="button" variant="outline" onClick={reset}>
            Limpiar filtros
          </Button>
        </div>
        <p id="sale-search-help" className="text-xs text-muted-foreground">
          {result?.canReadCustomers === false
            ? "Buscá por UUID completo. No tenés acceso a nombres de clientes."
            : "Buscá por UUID completo o nombre del cliente (mínimo 2 caracteres)."}
        </p>
        {validation && (
          <p id="sale-search-error" role="alert" className="text-sm text-destructive">
            {validation}
          </p>
        )}
        <div className="flex flex-wrap gap-4">
          <label className="space-y-1 text-sm">
            <span className="block">Estado</span>
            <select
              className="min-h-10 rounded-md border border-input bg-background px-3"
              value={state.status}
              onChange={(e) => {
                const status = e.target.value;
                if (
                  status === "DRAFT" ||
                  status === "COMPLETED" ||
                  status === "CANCELLED" ||
                  status === "all"
                )
                  setState({ ...state, status, page: 1 });
              }}
            >
              <option value="all">Todos</option>
              <option value="DRAFT">Borradores</option>
              <option value="COMPLETED">Completadas</option>
              <option value="CANCELLED">Canceladas</option>
            </select>
          </label>
          <label className="space-y-1 text-sm">
            <span className="block">Ordenar por</span>
            <select
              className="min-h-10 rounded-md border border-input bg-background px-3"
              value={state.sort}
              onChange={(e) => {
                const sort = e.target.value;
                if (sort === "oldest" || sort === "recent") setState({ ...state, sort, page: 1 });
              }}
            >
              <option value="oldest">Creación, más antiguas</option>
              <option value="recent">Creación, más recientes</option>
            </select>
          </label>
        </div>
      </form>

      {query.isFetching ? (
        <ListSkeleton label="Buscando ventas…" />
      ) : query.error ? (
        <ErrorState
          title="No pudimos cargar las ventas"
          retryLabel="Reintentar"
          message={
            query.error instanceof ApiRequestError &&
            ["UNAUTHENTICATED", "FORBIDDEN", "FEATURE_NOT_ENTITLED"].includes(query.error.code)
              ? userFacingSaleError(query.error)
              : "No pudimos completar la búsqueda. Revisá la conexión o los filtros y volvé a intentar."
          }
          onRetry={() => {
            void query.refetch();
          }}
        />
      ) : result?.items.length === 0 ? (
        <EmptyState
          icon="activity"
          title="No encontramos ventas"
          description="Probá con otro UUID, cliente o estado, o limpiá los filtros."
        >
          <Button type="button" asChild>
            <Link href="/app/sales">Ir al punto de venta</Link>
          </Button>
        </EmptyState>
      ) : (
        <div className="space-y-3" aria-label="Resultados de ventas">
          {result?.items.map((sale) => (
            <div key={sale.id} className="record-row">
              <div className="min-w-0 space-y-2">
                <Link
                  href={`/app/sales/${sale.id}`}
                  className="break-all font-semibold text-primary hover:underline"
                >
                  Venta {sale.id}
                </Link>
                <p className="text-sm text-muted-foreground">
                  Creada: {formatDate(sale.createdAt)}
                </p>
                <p className="text-sm text-muted-foreground">
                  {!sale.hasCustomer
                    ? "Sin cliente asociado"
                    : !result.canReadCustomers
                      ? "Cliente: acceso restringido"
                      : (sale.customerName ?? "Cliente no disponible")}
                </p>
              </div>
              <Badge variant="outline">{SALE_STATUS_LABELS[sale.status]}</Badge>
            </div>
          ))}
        </div>
      )}
      {!query.isFetching && !query.error && result && (
        <nav
          aria-label="Páginas de ventas"
          className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4"
        >
          <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
            {result.total === 0
              ? "0 ventas"
              : `Mostrando ${count((result.page - 1) * result.pageSize + 1)}–${count(Math.min(result.page * result.pageSize, result.total))} de ${count(result.total)}`}
          </p>
          <div className="flex items-center gap-3">
            <Button
              type="button"
              variant="outline"
              disabled={result.page <= 1}
              onClick={() => setState({ ...state, page: result.page - 1 })}
            >
              Anterior
            </Button>
            <span className="text-sm">
              Página {count(result.page)} de {count(Math.max(1, result.totalPages))}
            </span>
            <Button
              type="button"
              variant="outline"
              disabled={result.page >= result.totalPages}
              onClick={() => setState({ ...state, page: result.page + 1 })}
            >
              Siguiente
            </Button>
          </div>
        </nav>
      )}
    </div>
  );
}
