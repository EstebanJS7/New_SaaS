"use client";

import type { JSX } from "react";
import { useState } from "react";
import Link from "next/link";
import { useCan } from "@/lib/capabilities";
import { PURCHASE_ACTIONS } from "../purchase-capabilities";
import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@newsaas/ui/components/ui/button";
import { ConfirmActionDialog } from "@/components/confirm-action-dialog";
import { useWorkingBranches } from "@/lib/working-branches";
import { formatEsPyDecimal } from "@/lib/es-py-format";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@newsaas/ui/components/ui/card";
import {
  cancelPurchase,
  getPurchase,
  isPurchaseInactiveItemConflict,
  isPurchaseNotEditableConflict,
  isPurchaseNotFound,
  isPurchasePermissionDenied,
  isPurchaseTransportError,
  isPurchaseUntrackedItemConflict,
  receivePurchase,
  userFacingPurchaseError,
} from "../purchases-api";
import {
  PURCHASE_STATUS_HEADLINES,
  PURCHASE_STATUS_LABELS,
  formatDate,
  shortId,
  useCatalogItemNames,
  useSupplierNames,
} from "../purchase-display";

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
 * Gives each refused receive its own heading so the distinct conditions the API
 * reports are never collapsed into one generic failure. All of them share the
 * `CONFLICT` code, so the branches read the API's stable, value-free message.
 */
function receiveErrorTitle(error: Error): string {
  if (isPurchasePermissionDenied(error)) {
    return "Sin permiso";
  }
  if (isPurchaseNotFound(error)) {
    return "No encontramos la compra";
  }
  if (isPurchaseNotEditableConflict(error)) {
    return "Esta compra ya no es un borrador";
  }
  if (isPurchaseInactiveItemConflict(error)) {
    return "El artículo de una línea está inactivo";
  }
  if (isPurchaseUntrackedItemConflict(error)) {
    return "El artículo de una línea no controla stock";
  }
  if (isPurchaseTransportError(error)) {
    return "No se pudo conectar con el servidor";
  }
  return "No se pudo recibir la compra";
}

/**
 * Staff purchase detail: the purchase header, its full line set and the two
 * explicit transitions.
 *
 * Receiving is the purchase's ONLY stock effect, so it is guarded by an
 * explicit confirmation that states it writes stock and cannot be undone by
 * editing, and it is single-shot: a `409` is rendered as the terminal conflict
 * it is, never as a transient failure to retry blindly, and this surface never
 * retries a transition on its own. Cancelling a draft is a separate explicit
 * command. No control writes the status directly and there is no delete
 * affordance anywhere.
 *
 * Supplier and item references carry no names, so they are resolved read-only
 * through the existing supplier and catalog clients and degrade to a short id
 * fragment when a referenced record is not readable.
 *
 * Permission checks are UX-only; the backend enforces every gate.
 */
export function PurchaseDetail(): JSX.Element {
  const canEdit = useCan(PURCHASE_ACTIONS.update);
  const canCancel = useCan(PURCHASE_ACTIONS.cancel);
  const canReceive = useCan(PURCHASE_ACTIONS.receive);
  const params = useParams<{ id: string }>();
  const purchaseId = params.id;
  const queryClient = useQueryClient();
  const supplierNames = useSupplierNames();
  const workingBranches = useWorkingBranches();
  const catalogItemNames = useCatalogItemNames();
  const [confirmAction, setConfirmAction] = useState<"cancel" | "receive" | null>(null);

  const query = useQuery({
    queryKey: ["purchases", "detail", purchaseId],
    queryFn: () => getPurchase(purchaseId),
  });

  const cancelMutation = useMutation({
    mutationFn: () => cancelPurchase(purchaseId),
    // A transition is never retried silently.
    retry: false,
    onSuccess: (purchase) => {
      queryClient.setQueryData(["purchases", "detail", purchaseId], purchase);
      void queryClient.invalidateQueries({ queryKey: ["purchases", "list"] });
    },
  });

  const receiveMutation = useMutation({
    mutationFn: () => receivePurchase(purchaseId),
    // A transition is never retried silently.
    retry: false,
    onSuccess: (purchase) => {
      queryClient.setQueryData(["purchases", "detail", purchaseId], purchase);
      void queryClient.invalidateQueries({ queryKey: ["purchases", "list"] });
    },
  });

  if (query.isLoading) {
    return <p className="text-sm text-muted-foreground">Cargando compra…</p>;
  }

  if (query.error) {
    return (
      <div
        role="alert"
        className="rounded-lg border border-destructive bg-destructive/10 p-4 text-sm text-destructive"
      >
        {isPurchasePermissionDenied(query.error) && <p className="font-medium">Sin permiso</p>}
        {isPurchaseNotFound(query.error) && <p className="font-medium">No encontrada</p>}
        <p>{userFacingPurchaseError(query.error)}</p>
      </div>
    );
  }

  const purchase = query.data;
  if (!purchase) {
    return <p className="text-sm text-muted-foreground">No encontramos la compra.</p>;
  }

  const isDraft = purchase.status === "DRAFT";

  const transitionPending = receiveMutation.isPending || cancelMutation.isPending;
  const transitionError =
    confirmAction === "receive" ? receiveMutation.error : cancelMutation.error;

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="p-6">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h1 className="truncate text-2xl font-semibold tracking-tight">
                Compra #{shortId(purchase.id)}
              </h1>
              <p className="text-sm text-muted-foreground">
                {PURCHASE_STATUS_HEADLINES[purchase.status]}
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              {isDraft && (
                <>
                  {canEdit && (
                    <Button type="button" variant="outline" asChild>
                      <Link href={`/app/purchases/${purchase.id}/edit`}>Editar</Link>
                    </Button>
                  )}
                  {canCancel && (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setConfirmAction("cancel")}
                      disabled={cancelMutation.isPending || receiveMutation.isPending}
                    >
                      {cancelMutation.isPending ? "Cancelando…" : "Cancelar compra"}
                    </Button>
                  )}
                  {canReceive && (
                    <Button
                      type="button"
                      onClick={() => setConfirmAction("receive")}
                      disabled={receiveMutation.isPending || cancelMutation.isPending}
                    >
                      {receiveMutation.isPending ? "Recibiendo…" : "Recibir compra"}
                    </Button>
                  )}
                </>
              )}
            </div>
          </div>

          {isDraft && (
            <p className="mt-4 text-xs text-muted-foreground">
              Recibir la compra registra los movimientos de stock y no se corrige editando; una
              corrección posterior requiere una reversión auditada. Cancelar conserva la lectura del
              borrador y quita la opción de recibirlo.
            </p>
          )}
        </CardContent>
      </Card>

      <ConfirmActionDialog
        open={confirmAction !== null}
        onOpenChange={(open) => {
          if (!open && !transitionPending) setConfirmAction(null);
        }}
        title={confirmAction === "receive" ? "Recibir compra" : "Cancelar borrador de compra"}
        description={
          confirmAction === "receive"
            ? "Se registrará el ingreso de stock de todos los artículos. La compra recibida no se puede modificar; cualquier corrección posterior debe hacerse con una reversión auditada."
            : "La compra seguirá disponible para consulta, pero dejará de poder recibirse."
        }
        confirmLabel={confirmAction === "receive" ? "Recibir compra" : "Cancelar compra"}
        confirmVariant={confirmAction === "receive" ? "default" : "destructive"}
        pending={transitionPending}
        pendingLabel="Procesando…"
        errorMessage={
          transitionError === null ? undefined : userFacingPurchaseError(transitionError)
        }
        onConfirm={async () => {
          if (confirmAction === "receive") await receiveMutation.mutateAsync();
          if (confirmAction === "cancel") await cancelMutation.mutateAsync();
        }}
      />

      {receiveMutation.isSuccess && (
        <div
          role="status"
          className="rounded-lg border border-border bg-muted p-4 text-sm text-foreground"
        >
          <p className="font-medium">Recepción registrada</p>
          <p>
            Se registró el stock de todas las líneas y la compra quedó recibida. Esto no se corrige
            editando.
          </p>
        </div>
      )}

      {receiveMutation.error && (
        <div
          role="alert"
          className="rounded-lg border border-destructive bg-destructive/10 p-4 text-sm text-destructive"
        >
          <p className="font-medium">{receiveErrorTitle(receiveMutation.error)}</p>
          <p>{userFacingPurchaseError(receiveMutation.error)}</p>
          {isPurchaseNotEditableConflict(receiveMutation.error) && (
            <p className="mt-1 text-xs">
              La compra ya cambió de estado, así que esto no se aplicó. Recargá para ver su estado
              actual; repetir la recepción no la va a cambiar.
            </p>
          )}
        </div>
      )}

      {cancelMutation.error && (
        <div
          role="alert"
          className="rounded-lg border border-destructive bg-destructive/10 p-4 text-sm text-destructive"
        >
          <p className="font-medium">
            {isPurchaseNotEditableConflict(cancelMutation.error)
              ? "Esta compra ya no es un borrador"
              : isPurchasePermissionDenied(cancelMutation.error)
                ? "Sin permiso"
                : "No se pudo cancelar la compra"}
          </p>
          <p>{userFacingPurchaseError(cancelMutation.error)}</p>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Detalle de la compra</CardTitle>
          <CardDescription>
            Vista de solo lectura. Sin control de estado ni eliminación: los cambios de estado son
            las acciones explícitas de recibir y cancelar de arriba.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <DetailRow label="Proveedor" value={supplierNames.nameFor(purchase.supplierId)} />
          <DetailRow label="Estado" value={PURCHASE_STATUS_LABELS[purchase.status]} />
          <DetailRow
            label="Sucursal"
            value={
              workingBranches.branches.find((branch) => branch.id === purchase.branchId)?.name ??
              "Otra sucursal"
            }
          />
          <DetailRow label="Referencia" value={`#${shortId(purchase.id)}`} />
          <DetailRow label="Creada" value={formatDate(purchase.createdAt)} />
          <DetailRow label="Actualizada" value={formatDate(purchase.updatedAt)} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Líneas</CardTitle>
          <CardDescription>
            {purchase.lines.length} {purchase.lines.length === 1 ? "línea" : "líneas"}. Cantidades y
            costos tal como se registraron; no se calcula ningún total.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {purchase.lines.map((line) => (
            <div
              key={line.id}
              className="flex items-center justify-between gap-4 border-b border-border pb-3 last:border-b-0 last:pb-0"
            >
              <span className="min-w-0 flex-1 truncate text-foreground">
                {catalogItemNames.nameFor(line.catalogItemId)}
              </span>
              <span className="text-muted-foreground">{`Cant. ${formatEsPyDecimal(line.quantity)}`}</span>
              <span className="text-right font-medium text-foreground">
                {line.unitCost === null
                  ? "Sin costo unitario"
                  : `Costo unitario ${formatEsPyDecimal(line.unitCost)}`}
              </span>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
