"use client";

import type { JSX } from "react";
import { useState } from "react";
import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@newsaas/ui/components/ui/card";
import {
  CompletionOutcomeAlert,
  completionFailureCopy,
  completionNeedsStateCheck,
} from "../completion-outcome";
import { Button } from "@newsaas/ui/components/ui/button";
import { PaymentCapture } from "../payment-capture";
import {
  classifySaleCompletionError,
  completeSale,
  getSale,
  isSaleNotEntitled,
  isSaleNotFound,
  isSalePermissionDenied,
  userFacingSaleError,
  type CompleteSaleResult,
  type SalePaymentInput,
} from "../sales-api";
import {
  PAYMENT_METHOD_LABELS,
  SALE_STATUS_LABELS,
  formatAmount,
  formatDate,
  shortId,
  useCatalogItemNames,
  useCustomerNames,
} from "../sales-display";

function DetailRow({
  label,
  value,
}: {
  readonly label: string;
  readonly value: string;
}): JSX.Element {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-border pb-3 last:border-b-0 last:pb-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium text-foreground">{value}</span>
    </div>
  );
}

/**
 * The draft detail route (EPIC-12 POS-004).
 *
 * It reopens a sale by id and shows its lines, its payments when the completion
 * command produced them, and the honest status: `DRAFT`, `COMPLETED` or
 * `CANCELLED` straight from the API, never inferred locally. The sale read
 * deliberately exposes no payments, so a reopened draft states plainly that none
 * are recorded; the payments of a sale completed from this page come from the
 * completion response itself.
 *
 * A `DRAFT` can be completed from here through the same payment capture and the
 * same exact-sum guard as the counter, which is what makes a draft that was left
 * behind by a failed checkout recoverable. No control edits or deletes a
 * settled sale, and there is no refund or reversal affordance (TD-018).
 *
 * Permission and entitlement branches are UX only; the backend enforces every
 * gate and answers the same shared `404` for a foreign id as for an unknown one.
 */
export function SaleDetail(): JSX.Element {
  const params = useParams<{ id: string }>();
  const saleId = params.id;
  const queryClient = useQueryClient();
  const catalogNames = useCatalogItemNames();
  const customerNames = useCustomerNames();
  const [completed, setCompleted] = useState<CompleteSaleResult | null>(null);
  const [refreshNotice, setRefreshNotice] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ["sales", "detail", saleId],
    queryFn: () => getSale(saleId),
    retry: false,
  });

  const completeMutation = useMutation({
    mutationFn: (payments: SalePaymentInput[]) => completeSale(saleId, { payments }),
    retry: false,
    onSuccess: (result) => {
      setCompleted(result);
      void queryClient.invalidateQueries({ queryKey: ["sales", "detail", saleId] });
    },
  });

  if (query.isLoading) {
    return (
      <div className="mx-auto max-w-3xl">
        <p data-testid="sale-loading" className="text-sm text-muted-foreground">
          Cargando venta…
        </p>
      </div>
    );
  }

  if (query.error) {
    const permissionDenied = isSalePermissionDenied(query.error);
    const entitlementDenied = isSaleNotEntitled(query.error);
    const notFound = isSaleNotFound(query.error);
    return (
      <div
        role="alert"
        className="mx-auto max-w-3xl rounded-lg border border-destructive bg-destructive/10 p-4 text-sm text-destructive"
      >
        {permissionDenied && <p className="font-medium">Sin permiso</p>}
        {entitlementDenied && <p className="font-medium">Ventas no habilitadas</p>}
        {notFound && <p className="font-medium">No encontrada</p>}
        <p>{userFacingSaleError(query.error)}</p>
      </div>
    );
  }

  if (!query.data) {
    return (
      <div className="mx-auto max-w-3xl">
        <p data-testid="sale-not-found" className="text-sm text-muted-foreground">
          No encontramos la venta.
        </p>
      </div>
    );
  }

  const sale = completed?.sale ?? query.data;
  const completionFailure =
    completeMutation.error === null ? null : classifySaleCompletionError(completeMutation.error);
  const isDraft = sale.status === "DRAFT";
  const payments = completed?.sale.payments ?? [];

  async function refreshCompletionState(): Promise<void> {
    setRefreshNotice(null);
    const result = await query.refetch();
    if (!result.isSuccess) return;
    completeMutation.reset();
    setRefreshNotice(
      result.data.status === "DRAFT"
        ? "El servidor confirma que la venta sigue en borrador. Revisá los pagos antes de reintentar."
        : "Estado actualizado desde el servidor. No se envió un nuevo cobro."
    );
  }

  function handleComplete(submitted: SalePaymentInput[]): Promise<CompleteSaleResult> {
    if (completionNeedsStateCheck(completionFailure) || query.isFetching)
      return Promise.reject(new Error("Consultá el estado actual de la venta."));
    return completeMutation.mutateAsync(submitted);
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <CompletionOutcomeAlert completed={completed} />
      {refreshNotice && (
        <p role="status" className="rounded-lg border border-border bg-secondary p-3 text-sm">
          {refreshNotice}
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{`Venta #${shortId(sale.id)}`}</CardTitle>
          <CardDescription>
            {`Venta ${SALE_STATUS_LABELS[sale.status].toLowerCase()}. El estado proviene del sistema.`}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <DetailRow label="Estado" value={SALE_STATUS_LABELS[sale.status]} />
          <DetailRow
            label="Cliente"
            value={
              sale.customerId === null
                ? "Venta directa (sin cliente)"
                : customerNames.nameFor(sale.customerId)
            }
          />
          <DetailRow label="Total" value={formatAmount(sale.total, sale.currency)} />
          <DetailRow label="Referencia" value={`#${shortId(sale.id)}`} />
          <DetailRow label="Creada" value={formatDate(sale.createdAt)} />
          <DetailRow label="Actualizada" value={formatDate(sale.updatedAt)} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Artículos</CardTitle>
          <CardDescription>
            {`${sale.lines.length} ${sale.lines.length === 1 ? "artículo" : "artículos"}. Los importes exactos provienen del sistema.`}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {sale.lines.map((line) => (
            <div
              key={line.id}
              className="flex items-start justify-between gap-4 border-b border-border pb-3 last:border-b-0 last:pb-0"
            >
              <div className="min-w-0">
                <p className="truncate text-foreground">
                  {catalogNames.nameFor(line.catalogItemId)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {`Cant. ${line.quantity} · unitario ${formatAmount(line.unitPrice, sale.currency)} · ${line.rateCode}`}
                </p>
              </div>
              <div className="shrink-0 text-right text-foreground">
                <p>{formatAmount(line.lineTotal, sale.currency)}</p>
                <p className="text-xs text-muted-foreground">
                  {`base ${formatAmount(line.taxableBase, sale.currency)} · impuesto ${formatAmount(line.taxAmount, sale.currency)}`}
                </p>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Pagos</CardTitle>
          <CardDescription>
            Los pagos se registran al completar la venta y se muestran con la respuesta de esa
            operación.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {payments.length === 0 ? (
            <p data-testid="no-payments" className="text-muted-foreground">
              {sale.status === "DRAFT"
                ? "Este borrador todavía no tiene pagos confirmados."
                : "El detalle de pagos no está disponible en esta lectura. El estado de la venta es el informado por el servidor."}
            </p>
          ) : (
            <ul className="space-y-2">
              {payments.map((payment) => (
                <li
                  key={payment.id}
                  className="flex items-center justify-between gap-4 border-b border-border pb-2 last:border-b-0 last:pb-0"
                >
                  <span className="text-foreground">{PAYMENT_METHOD_LABELS[payment.method]}</span>
                  <span className="font-medium text-foreground" data-testid="payment-amount">
                    {formatAmount(payment.amount, sale.currency)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {isDraft && completed === null && (
        <Card>
          <CardHeader>
            <CardTitle>Completar este borrador</CardTitle>
            <CardDescription>
              {`Ingresá pagos que sumen exactamente ${formatAmount(sale.total, sale.currency)}. Si el sistema rechaza la operación, el borrador seguirá abierto.`}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <CompletionOutcomeAlert failure={completionFailure} />
            {completionNeedsStateCheck(completionFailure) && (
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">
                  Volvé desde la confirmación y consultá el estado antes de volver a cobrar. Los
                  pagos ingresados se conservan mientras la venta siga en borrador.
                </p>
                <Button
                  type="button"
                  variant="outline"
                  disabled={query.isFetching || completeMutation.isPending}
                  onClick={() => void refreshCompletionState()}
                >
                  {query.isFetching ? "Consultando estado…" : "Consultar estado actual"}
                </Button>
              </div>
            )}
            <PaymentCapture
              total={sale.total}
              currency={sale.currency}
              onSubmit={handleComplete}
              isPending={completeMutation.isPending}
              disabled={completionNeedsStateCheck(completionFailure) || query.isFetching}
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
