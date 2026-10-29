"use client";

import type { JSX } from "react";
import { useState } from "react";
import { Input } from "@newsaas/ui/components/ui/input";
import { Icon } from "@newsaas/ui/components/ui/icon";
import { Badge } from "@newsaas/ui/components/ui/badge";
import { EmptyState, ErrorState, ListSkeleton } from "@/components/feedback";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@newsaas/ui/components/ui/button";
import { ConfirmActionDialog } from "@/components/confirm-action-dialog";
import {
  CustomerSearchError,
  searchCustomers,
  userFacingCustomerSearchError,
  type CustomerSearchRow,
} from "./customer-search-api";
import { deactivateCustomer } from "./customers-api";
import { useCustomersListState } from "./customers-list-state";

function userFacingErrorMessage(error: Error): string {
  const message = error.message;
  if (message.includes("UNAUTHENTICATED") || message.includes("Authentication required")) {
    return "Iniciá sesión para ver los clientes.";
  }
  if (message.includes("FORBIDDEN") || message.includes("Access denied")) {
    return "No tenés permiso para gestionar clientes.";
  }
  return "No pudimos actualizar el cliente. Revisá la conexión y volvé a intentar.";
}

function CustomerCard({ customer }: { readonly customer: CustomerSearchRow }): JSX.Element {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [confirmDeactivateOpen, setConfirmDeactivateOpen] = useState(false);
  const mutation = useMutation({
    mutationFn: () => deactivateCustomer(customer.id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["customers"] });
    },
  });

  return (
    <div className="record-row">
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-3">
          <span
            aria-hidden="true"
            className="flex size-9 items-center justify-center rounded-lg bg-secondary text-xs font-semibold text-secondary-foreground"
          >
            {customer.displayName.slice(0, 2).toUpperCase()}
          </span>
          <Link
            href={`/app/customers/${customer.id}`}
            className="truncate font-semibold text-foreground hover:text-primary hover:underline"
          >
            {customer.displayName}
          </Link>
          <Badge variant={customer.isActive ? "success" : "outline"}>
            {customer.isActive ? "Activo" : "Inactivo"}
          </Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          {customer.kind === "INDIVIDUAL"
            ? [customer.firstName, customer.lastName].filter(Boolean).join(" ") || "Persona"
            : (customer.legalName ?? "Empresa")}
        </p>
        {mutation.error ? (
          <p role="alert" className="text-xs text-destructive">
            {userFacingErrorMessage(mutation.error)}
          </p>
        ) : null}
      </div>
      <div className="flex shrink-0 gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => router.push(`/app/customers/${customer.id}/edit`)}
        >
          Editar
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setConfirmDeactivateOpen(true)}
          disabled={mutation.isPending || !customer.isActive}
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
        title="Desactivar cliente"
        description="El cliente dejará de estar disponible para nuevas operaciones. Sus registros se conservarán."
        confirmLabel="Desactivar cliente"
        pendingLabel="Desactivando…"
        pending={mutation.isPending}
        errorMessage={mutation.error ? userFacingErrorMessage(mutation.error) : undefined}
        onConfirm={() => mutation.mutateAsync()}
      />
    </div>
  );
}

export function CustomersList(): JSX.Element {
  const [state, setState] = useCustomersListState();
  const [search, setSearch] = useState(state.q);
  const [validation, setValidation] = useState<string>();
  const query = useQuery({
    queryKey: ["customers", "search", state],
    queryFn: ({ signal }) => searchCustomers(state, signal),
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
          <p className="page-eyebrow">Espacio de trabajo / Directorio</p>
          <h1 className="text-2xl font-semibold tracking-tight">Clientes</h1>
          <p className="text-sm text-muted-foreground">
            Encontrá clientes y consultá sus datos guardados.
          </p>
        </div>
        <Button type="button" asChild>
          <Link href="/app/customers/new">
            <Icon name="plus" />
            Nuevo cliente
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
        <label htmlFor="customer-search" className="text-sm font-medium">
          Buscar clientes
        </label>
        <div className="flex flex-wrap items-start gap-2">
          <div className="relative min-w-0 flex-1 sm:min-w-64">
            <Icon
              name="search"
              className="pointer-events-none absolute left-3 top-3 text-muted-foreground"
            />
            <Input
              id="customer-search"
              type="search"
              autoComplete="off"
              maxLength={80}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Nombre, razón social, documento o RUC"
              aria-invalid={Boolean(validation)}
              aria-describedby={
                validation ? "customer-search-help customer-search-error" : "customer-search-help"
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
        <p id="customer-search-help" className="text-xs text-muted-foreground">
          Buscá por nombre, razón social, documento o RUC. Mínimo 2 caracteres.
        </p>
        {validation && (
          <p id="customer-search-error" role="alert" className="text-sm text-destructive">
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
            <span className="block">Tipo de cliente</span>
            <select
              className="min-h-10 rounded-md border border-input bg-background px-3"
              value={state.kind}
              onChange={(event) => {
                const kind = event.target.value;
                if (kind === "all" || kind === "INDIVIDUAL" || kind === "COMPANY")
                  setState({ ...state, kind, page: 1 });
              }}
            >
              <option value="all">Todos los tipos</option>
              <option value="INDIVIDUAL">Personas</option>
              <option value="COMPANY">Empresas</option>
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
        <ListSkeleton label="Buscando clientes…" />
      ) : query.error ? (
        <ErrorState
          title="No pudimos cargar los clientes"
          retryLabel="Reintentar"
          message={
            query.error instanceof CustomerSearchError &&
            ["UNAUTHENTICATED", "FORBIDDEN", "VALIDATION_FAILED"].includes(query.error.code)
              ? userFacingCustomerSearchError(query.error)
              : "No pudimos completar la búsqueda. Revisá la conexión o los filtros y volvé a intentar."
          }
          onRetry={() => {
            void query.refetch();
          }}
        />
      ) : result?.items.length === 0 ? (
        <EmptyState
          icon="users"
          title="No encontramos clientes"
          description="Probá con otro nombre, documento, RUC o filtros."
        >
          <Button type="button" asChild>
            <Link href="/app/customers/new">Crear cliente</Link>
          </Button>
        </EmptyState>
      ) : (
        <div className="space-y-3" aria-label="Resultados de clientes">
          {result?.items.map((customer) => (
            <CustomerCard key={customer.id} customer={customer} />
          ))}
        </div>
      )}
      {!query.isFetching && !query.error && result && (
        <nav
          aria-label="Páginas de clientes"
          className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4"
        >
          <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
            {result.total === 0
              ? "0 clientes"
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
