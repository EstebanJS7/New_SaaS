"use client";

import { useStaffResumeTarget } from "@/providers/staff-resume-target";
import type { JSX } from "react";
import { formatEsPyDecimal } from "@/lib/es-py-format";
import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ClinicalAssociations } from "@/components/veterinary/clinical-associations";
import { AppointmentJourney } from "@/components/veterinary/appointment-journey";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@newsaas/ui/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@newsaas/ui/components/ui/card";
import { listCatalogItems, userFacingCatalogError, type CatalogItem } from "../catalog/catalog-api";
import {
  CompletionOutcomeAlert,
  completionFailureCopy,
  completionNeedsStateCheck,
} from "./completion-outcome";
import {
  buildSaleLines,
  cartLineFromItem,
  cartValidationError,
  filterCatalogItemsByName,
  type CartLine,
} from "./counter-cart";
import { CustomerSelector } from "./customer-selector";
import { LineEditor } from "./line-editor";
import { PaymentCapture } from "./payment-capture";
import {
  classifySaleCompletionError,
  completeSale,
  createSale,
  isSaleNotEntitled,
  isSalePermissionDenied,
  userFacingSaleError,
  type CompleteSaleResult,
  type Sale,
  type SalePaymentInput,
} from "./sales-api";
import { formatAmount, shortId, useCatalogItemNames } from "./sales-display";

const inputClassName =
  "h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

/**
 * The staff counter surface (EPIC-12 POS-004).
 *
 * Composition, per the Story's accepted resolution: the cart is LOCAL state, and
 * checkout performs create-then-complete exactly — `POST /sales` with the cart's
 * lines (which creates the `DRAFT` and returns the API's authoritative line
 * totals, tax and sale total), then `POST /sales/:id/complete` with the payment
 * set. The surface never shows a locally assumed completion: the completed state
 * only exists when the API returned a completed sale.
 *
 * The surface computes no money the API owns. It shows the applied prices and
 * quantities from the cart, then the API's own line totals and sale total, and
 * the only arithmetic it performs is the exact decimal sum of the entered
 * payments against that total. It applies no tax and allocates no number.
 *
 * Item resolution is a name search over the shipped tenant-scoped catalog read;
 * there is no barcode affordance and no scanner claim (DEC-025, TD-019). The
 * customer is optional and non-blocking (DEC-028). Permission and entitlement
 * branches are UX only — the backend enforces every gate.
 */
export function CounterSurface({
  appointmentId,
  patientId,
  encounterId,
}: { appointmentId?: string; patientId?: string; encounterId?: string } = {}): JSX.Element {
  const queryClient = useQueryClient();
  const catalogNames = useCatalogItemNames();
  const nextKeyRef = useRef(0);

  const [searchQuery, setSearchQuery] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [customerId, setCustomerId] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const [createdSale, setCreatedSale] = useState<Sale | null>(null);
  useStaffResumeTarget(createdSale ? `/app/sales/${createdSale.id}` : undefined);
  const [completed, setCompleted] = useState<CompleteSaleResult | null>(null);

  const itemsQuery = useQuery({
    queryKey: ["catalog", "pos-search"],
    queryFn: () => listCatalogItems({ isActive: true }),
    retry: false,
  });

  const createMutation = useMutation({
    mutationFn: (input: { customerId: string | null; lines: ReturnType<typeof buildSaleLines> }) =>
      createSale(input),
    // A command is never retried silently by this surface.
    retry: false,
    onSuccess: (sale) => {
      setCreatedSale(sale);
      void queryClient.invalidateQueries({ queryKey: ["sales", "list"] });
    },
  });

  const completeMutation = useMutation({
    mutationFn: (input: { id: string; payments: SalePaymentInput[] }) =>
      completeSale(input.id, { payments: input.payments }),
    retry: false,
    onSuccess: (result) => {
      setCompleted(result);
      void queryClient.invalidateQueries({ queryKey: ["sales", "list"] });
    },
  });

  const items = useMemo(() => itemsQuery.data ?? [], [itemsQuery.data]);
  const matches = useMemo(() => filterCatalogItemsByName(items, searchQuery), [items, searchQuery]);

  const mutationError = createMutation.error ?? completeMutation.error;
  const permissionDenied = mutationError !== null && isSalePermissionDenied(mutationError);
  const entitlementDenied = mutationError !== null && isSaleNotEntitled(mutationError);
  const completionFailure =
    completeMutation.error === null ? null : classifySaleCompletionError(completeMutation.error);

  function addItem(item: CatalogItem): void {
    const key = `cart-${nextKeyRef.current}`;
    nextKeyRef.current += 1;
    setCart((previous) => [...previous, cartLineFromItem(item, key)]);
    setLocalError(null);
  }

  function patchLine(key: string, patch: Partial<Omit<CartLine, "key">>): void {
    setCart((previous) =>
      previous.map((line) => (line.key === key ? { ...line, ...patch } : line))
    );
  }

  function removeLine(key: string): void {
    setCart((previous) => previous.filter((line) => line.key !== key));
  }

  function handleCheckout(): void {
    const error = cartValidationError(cart);
    if (error !== null) {
      setLocalError(error);
      return;
    }
    setLocalError(null);
    createMutation.mutate({
      customerId: customerId.length > 0 ? customerId : null,
      lines: buildSaleLines(cart),
    });
  }

  function handleComplete(payments: SalePaymentInput[]): Promise<CompleteSaleResult> {
    if (createdSale === null) {
      return Promise.reject(new Error("No hay una venta abierta para completar."));
    }
    return completeMutation.mutateAsync({ id: createdSale.id, payments });
  }

  function startNewSale(): void {
    setCart([]);
    setCustomerId("");
    setSearchQuery("");
    setCreatedSale(null);
    setCompleted(null);
    setLocalError(null);
    createMutation.reset();
    completeMutation.reset();
  }

  if (entitlementDenied) {
    // UX gate only: the backend answers the same `403 FEATURE_NOT_ENTITLED` for
    // every sale call, so the surface hides itself instead of offering actions
    // that can only fail.
    return (
      <div className="mx-auto max-w-3xl space-y-6">
        <div>
          <Link href="/app/sales/history" className="text-sm text-primary hover:underline">
            Listado de ventas
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight">Punto de venta</h1>
          <p className="text-sm text-muted-foreground">Ventas de esta organización.</p>
        </div>
        <div
          role="alert"
          data-testid="entitlement-denied"
          className="rounded-lg border border-destructive bg-destructive/10 p-4 text-sm text-destructive"
        >
          <p className="font-medium">Ventas no habilitadas</p>
          <p>
            Esta organización no tiene habilitada la función de ventas, por lo que el punto de venta
            no está disponible.
          </p>
        </div>
      </div>
    );
  }

  const locked = createdSale !== null || completed !== null || createMutation.isPending;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Link href="/app/sales/history" className="text-sm text-primary hover:underline">
          Listado de ventas
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">Punto de venta</h1>
        <p className="text-sm text-muted-foreground">
          Buscá artículos por nombre, armá la venta y registrá los medios de pago. El sistema
          calcula los impuestos y el total.
        </p>
      </div>

      {appointmentId !== undefined && (
        <AppointmentJourney
          key={appointmentId}
          appointmentId={appointmentId}
          onAddService={
            locked || itemsQuery.isPending || itemsQuery.isError
              ? undefined
              : (serviceId) => {
                  const item = items.find((value) => value.id === serviceId);
                  if (item) addItem(item);
                  else
                    setLocalError(
                      "El servicio de la cita no está disponible en el catálogo activo. Elegí otro artículo o revisá el catálogo."
                    );
                }
          }
        />
      )}
      {patientId && encounterId && (
        <ClinicalAssociations
          key={`${patientId}-${encounterId}`}
          patientId={patientId}
          encounterId={encounterId}
          appointmentId={appointmentId}
          currentSaleId={createdSale?.id}
          inPOS
        />
      )}
      <CompletionOutcomeAlert completed={completed} />

      {completed !== null && (
        <Button type="button" onClick={startNewSale}>
          Iniciar otra venta
        </Button>
      )}

      {localError !== null && (
        <div
          role="alert"
          className="rounded-lg border border-destructive bg-destructive/10 p-4 text-sm text-destructive"
        >
          {localError}
        </div>
      )}

      {createMutation.error !== null && (
        <div
          role="alert"
          data-testid="create-error"
          className="rounded-lg border border-destructive bg-destructive/10 p-4 text-sm text-destructive"
        >
          {permissionDenied && <p className="font-medium">Sin permiso</p>}
          <p>{userFacingSaleError(createMutation.error)}</p>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Buscar artículos</CardTitle>
          <CardDescription>
            Buscá en el catálogo por nombre. Podés escribir con teclado o pantalla táctil; todavía
            no está disponible la lectura de códigos de barras.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <label htmlFor="pos-item-search" className="text-sm font-medium">
            Nombre del artículo
          </label>
          <input
            id="pos-item-search"
            type="search"
            autoComplete="off"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            disabled={locked}
            placeholder="Escribí parte del nombre"
            className={inputClassName}
          />

          {itemsQuery.isLoading ? (
            <p className="text-sm text-muted-foreground">Cargando artículos…</p>
          ) : itemsQuery.error ? (
            <p role="alert" className="text-sm text-destructive">
              {userFacingCatalogError(itemsQuery.error)}
            </p>
          ) : matches.length === 0 ? (
            <p data-testid="catalog-empty" className="text-sm text-muted-foreground">
              No encontramos artículos con esa búsqueda.
            </p>
          ) : (
            <ul className="space-y-2">
              {matches.map((item) => (
                <li
                  key={item.id}
                  className="flex items-center justify-between gap-4 rounded-lg border border-border p-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">{item.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {item.referencePriceAmount === null
                        ? "Sin precio de referencia"
                        : `Referencia: ${formatAmount(item.referencePriceAmount, item.referencePriceCurrency)}`}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => addItem(item)}
                    disabled={locked}
                  >
                    Agregar a la venta
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Venta</CardTitle>
          <CardDescription>
            {`${cart.length} ${cart.length === 1 ? "artículo" : "artículos"}. El sistema calcula los subtotales, impuestos y total al continuar.`}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {cart.length === 0 ? (
            <p data-testid="cart-empty" className="text-sm text-muted-foreground">
              Todavía no agregaste artículos. Buscá un artículo para comenzar.
            </p>
          ) : (
            <div className="space-y-3">
              {cart.map((line) => (
                <LineEditor
                  key={line.key}
                  line={line}
                  disabled={locked}
                  onChange={patchLine}
                  onRemove={removeLine}
                />
              ))}
            </div>
          )}

          <CustomerSelector customerId={customerId} onChange={setCustomerId} disabled={locked} />

          <div className="flex items-center justify-between border-t border-border pt-4 text-sm">
            <span className="text-muted-foreground">{`Artículos: ${cart.length}`}</span>
            <span data-testid="sale-total" className="font-medium text-foreground">
              {createdSale === null
                ? "El total se calculará al continuar"
                : `Total: ${formatAmount(createdSale.total, createdSale.currency)}`}
            </span>
          </div>

          <Button type="button" onClick={handleCheckout} disabled={locked || cart.length === 0}>
            {createMutation.isPending ? "Creando venta…" : "Continuar al pago"}
          </Button>
        </CardContent>
      </Card>

      {createdSale !== null && completed === null && (
        <Card>
          <CardHeader>
            <CardTitle>Pago</CardTitle>
            <CardDescription>
              {`Borrador #${shortId(createdSale.id)} creado. El total calculado es ${formatAmount(createdSale.total, createdSale.currency)}. Ingresá pagos que coincidan exactamente.`}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <ul className="space-y-2 text-sm" data-testid="draft-lines">
              {createdSale.lines.map((line) => (
                <li
                  key={line.id}
                  className="flex items-center justify-between gap-4 border-b border-border pb-2 last:border-b-0 last:pb-0"
                >
                  <span className="min-w-0 truncate text-foreground">
                    {catalogNames.nameFor(line.catalogItemId)}
                  </span>
                  <span className="text-muted-foreground">{`Cant. ${formatEsPyDecimal(line.quantity)}`}</span>
                  <span className="text-right text-foreground">
                    {`${formatAmount(line.lineTotal, createdSale.currency)} · impuesto ${formatAmount(line.taxAmount, createdSale.currency)}`}
                  </span>
                </li>
              ))}
            </ul>

            <CompletionOutcomeAlert failure={completionFailure} />

            {completeMutation.error !== null && (
              <p className="text-sm text-muted-foreground">
                {completionNeedsStateCheck(completionFailure)
                  ? `Consultá el estado actual de la venta #${shortId(createdSale.id)} antes de volver a cobrar. `
                  : `La finalización de la venta #${shortId(createdSale.id)} fue rechazada. Revisá el motivo antes de continuar. `}
                <Link
                  href={`/app/sales/${createdSale.id}`}
                  className="text-primary hover:underline"
                >
                  Consultar venta
                </Link>
                .
              </p>
            )}

            <PaymentCapture
              total={createdSale.total}
              currency={createdSale.currency}
              onSubmit={handleComplete}
              isPending={completeMutation.isPending}
              disabled={completionNeedsStateCheck(completionFailure)}
              errorMessage={
                completionFailure === null
                  ? undefined
                  : `${completionFailureCopy(completionFailure).title}. ${completionFailureCopy(completionFailure).description}`
              }
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
