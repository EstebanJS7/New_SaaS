"use client";

import type { JSX } from "react";
import { useState } from "react";
import { Input } from "@newsaas/ui/components/ui/input";
import { Icon } from "@newsaas/ui/components/ui/icon";
import { EmptyState, ErrorState, ListSkeleton } from "@/components/feedback";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@newsaas/ui/components/ui/button";
import { ConfirmActionDialog } from "@/components/confirm-action-dialog";
import {
  searchCatalog,
  userFacingCatalogSearchError,
  type CatalogSearchRow,
  type CatalogSearchInput,
} from "./catalog-search-api";
import {
  ApiRequestError,
  CATALOG_ITEM_KINDS,
  deactivateCatalogItem,
  userFacingCatalogError,
  type CatalogItemKind,
} from "./catalog-api";
import { formatStaffMoney } from "@/lib/es-py-format";
import { useCatalogListState } from "./catalog-list-state";

function catalogActionError(error: Error): string {
  return error instanceof ApiRequestError &&
    ["UNAUTHENTICATED", "FORBIDDEN", "FEATURE_NOT_ENTITLED", "NOT_FOUND"].includes(error.code)
    ? userFacingCatalogError(error)
    : "No pudimos actualizar el artículo. Revisá la conexión y volvé a intentar.";
}
const KIND_LABELS: Record<CatalogItemKind, string> = {
  PRODUCT: "Producto",
  SERVICE: "Servicio",
  MEDICATION: "Medicamento",
  SUPPLY: "Insumo",
};

function referencePriceLabel(item: CatalogSearchRow): string | null {
  if (item.referencePriceAmount === null || item.referencePriceCurrency === null) {
    return null;
  }
  return formatStaffMoney(item.referencePriceAmount, item.referencePriceCurrency);
}

function CatalogItemCard({ item }: { readonly item: CatalogSearchRow }): JSX.Element {
  const queryClient = useQueryClient();
  const [confirmDeactivateOpen, setConfirmDeactivateOpen] = useState(false);
  const mutation = useMutation({
    mutationFn: () => deactivateCatalogItem(item.id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["catalog"] });
    },
  });

  const price = referencePriceLabel(item);

  return (
    <div className="record-row">
      <div className="min-w-0 space-y-1">
        <div className="flex items-center gap-2">
          <Link
            href={`/app/catalog/${item.id}`}
            className="truncate font-semibold text-foreground hover:text-primary hover:underline"
          >
            {item.name}
          </Link>
          {!item.isActive && (
            <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
              Inactivo
            </span>
          )}
        </div>
        <p className="text-sm text-muted-foreground">
          {KIND_LABELS[item.kind]} · {item.taxRateName}
          {price ? ` · ${price}` : ""}
        </p>
        {mutation.error && (
          <p role="alert" className="text-xs text-destructive">
            {catalogActionError(mutation.error)}
          </p>
        )}
      </div>
      <div className="flex shrink-0 gap-2">
        <Button type="button" variant="outline" size="sm" asChild>
          <Link href={`/app/catalog/${item.id}/edit`}>Editar</Link>
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setConfirmDeactivateOpen(true)}
          disabled={mutation.isPending || !item.isActive}
          loading={mutation.isPending}
        >
          {mutation.isPending ? "Desactivando…" : "Desactivar"}
        </Button>
      </div>
      <ConfirmActionDialog
        open={confirmDeactivateOpen}
        onOpenChange={(open) => {
          if (!open && !mutation.isPending) setConfirmDeactivateOpen(false);
        }}
        title="Desactivar artículo"
        description="El artículo dejará de estar disponible para nuevas operaciones. Sus movimientos y registros se conservarán."
        confirmLabel="Desactivar artículo"
        pendingLabel="Desactivando…"
        pending={mutation.isPending}
        errorMessage={mutation.error ? catalogActionError(mutation.error) : undefined}
        onConfirm={() => mutation.mutateAsync()}
      />
    </div>
  );
}

export function CatalogList(): JSX.Element {
  const [state, setState] = useCatalogListState();
  const [search, setSearch] = useState(state.q);
  const [validation, setValidation] = useState<string>();
  const query = useQuery({
    queryKey: ["catalog", "search", state],
    queryFn: ({ signal }) => searchCatalog(state, signal),
    staleTime: 0,
  });
  const result = query.data;
  const reset = () => {
    setSearch("");
    setValidation(undefined);
    setState({ q: "", page: 1, status: "active", kind: "all", sort: "name" });
  };
  const count = (value: number) => value.toLocaleString("es-PY");
  return (
    <div className="space-y-6">
      <div className="page-heading">
        <div>
          <p className="page-eyebrow">Comercio / Catálogo</p>
          <h1 className="text-2xl font-semibold tracking-tight">Catálogo</h1>
          <p className="text-sm text-muted-foreground">
            Encontrá productos, servicios, medicamentos e insumos.
          </p>
        </div>
        <Button type="button" asChild>
          <Link href="/app/catalog/new">
            <Icon name="plus" />
            Nuevo artículo
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
        <label htmlFor="catalog-search" className="text-sm font-medium">
          Buscar en el catálogo
        </label>
        <div className="flex flex-wrap items-start gap-2">
          <div className="relative min-w-0 flex-1 sm:min-w-64">
            <Icon
              name="search"
              className="pointer-events-none absolute left-3 top-3 text-muted-foreground"
            />
            <Input
              id="catalog-search"
              type="search"
              autoComplete="off"
              maxLength={80}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Nombre del artículo o servicio"
              aria-invalid={Boolean(validation)}
              aria-describedby={
                validation ? "catalog-search-help catalog-search-error" : "catalog-search-help"
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
        <p id="catalog-search-help" className="text-xs text-muted-foreground">
          Buscá por nombre del artículo o servicio. Mínimo 2 caracteres.
        </p>
        {validation && (
          <p id="catalog-search-error" role="alert" className="text-sm text-destructive">
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
                if (status === "active" || status === "inactive" || status === "all")
                  setState({ ...state, status, page: 1 });
              }}
            >
              <option value="active">Activos</option>
              <option value="inactive">Inactivos</option>
              <option value="all">Todos</option>
            </select>
          </label>
          <label className="space-y-1 text-sm">
            <span className="block">Tipo de artículo</span>
            <select
              className="min-h-10 rounded-md border border-input bg-background px-3"
              value={state.kind}
              onChange={(event) => {
                const kind = event.target.value;
                if (kind === "all" || CATALOG_ITEM_KINDS.some((value) => value === kind))
                  setState({ ...state, kind: kind as CatalogSearchInput["kind"], page: 1 });
              }}
            >
              <option value="all">Todos los tipos</option>
              {CATALOG_ITEM_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {KIND_LABELS[kind]}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-sm">
            <span className="block">Ordenar por</span>
            <select
              className="min-h-10 rounded-md border border-input bg-background px-3"
              value={state.sort}
              onChange={(e) => {
                const sort = e.target.value;
                if (sort === "name" || sort === "recent") setState({ ...state, sort, page: 1 });
              }}
            >
              <option value="name">Nombre, A–Z</option>
              <option value="recent">Más recientes</option>
            </select>
          </label>
        </div>
      </form>

      {query.isFetching ? (
        <ListSkeleton label="Buscando artículos…" />
      ) : query.error ? (
        <ErrorState
          title="No pudimos cargar el catálogo"
          retryLabel="Reintentar"
          message={userFacingCatalogSearchError(query.error)}
          onRetry={() => {
            void query.refetch();
          }}
        />
      ) : result?.items.length === 0 ? (
        <EmptyState
          icon="box"
          title="No encontramos artículos"
          description="Probá con otro nombre o cambiá los filtros."
        >
          <Button type="button" asChild>
            <Link href="/app/catalog/new">Crear artículo</Link>
          </Button>
        </EmptyState>
      ) : (
        <div className="space-y-3" aria-label="Resultados del catálogo">
          {result?.items.map((item) => (
            <CatalogItemCard key={item.id} item={item} />
          ))}
        </div>
      )}
      {!query.isFetching && !query.error && result && (
        <nav
          aria-label="Páginas del catálogo"
          className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4"
        >
          <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
            {result.total === 0
              ? "0 artículos"
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
