"use client";

import type { JSX } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
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
    return "Permission denied";
  }
  if (isPurchaseNotFound(error)) {
    return "Purchase not found";
  }
  if (isPurchaseNotEditableConflict(error)) {
    return "This purchase is no longer a draft";
  }
  if (isPurchaseInactiveItemConflict(error)) {
    return "A line's catalog item is inactive";
  }
  if (isPurchaseUntrackedItemConflict(error)) {
    return "A line's catalog item does not track stock";
  }
  if (isPurchaseTransportError(error)) {
    return "Could not reach the server";
  }
  return "Receive failed";
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
  const params = useParams<{ id: string }>();
  const purchaseId = params.id;
  const queryClient = useQueryClient();
  const supplierNames = useSupplierNames();
  const catalogItemNames = useCatalogItemNames();

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
    return <p className="text-sm text-muted-foreground">Loading purchase...</p>;
  }

  if (query.error) {
    return (
      <div
        role="alert"
        className="rounded-lg border border-destructive bg-destructive/10 p-4 text-sm text-destructive"
      >
        {isPurchasePermissionDenied(query.error) && (
          <p className="font-medium">Permission denied</p>
        )}
        {isPurchaseNotFound(query.error) && <p className="font-medium">Not found</p>}
        <p>{userFacingPurchaseError(query.error)}</p>
      </div>
    );
  }

  const purchase = query.data;
  if (!purchase) {
    return <p className="text-sm text-muted-foreground">Purchase not found.</p>;
  }

  const isDraft = purchase.status === "DRAFT";

  function handleReceive(): void {
    if (
      !window.confirm(
        "Receive this purchase? This writes the purchase into stock and cannot be undone by editing."
      )
    ) {
      return;
    }
    receiveMutation.mutate();
  }

  function handleCancel(): void {
    if (
      !window.confirm(
        "Cancel this draft purchase? It stays readable and can no longer be received."
      )
    ) {
      return;
    }
    cancelMutation.mutate();
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="p-6">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h1 className="truncate text-2xl font-semibold tracking-tight">
                Purchase #{shortId(purchase.id)}
              </h1>
              <p className="text-sm text-muted-foreground">
                {PURCHASE_STATUS_LABELS[purchase.status]} purchase
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              {isDraft && (
                <>
                  <Button type="button" variant="outline" asChild>
                    <Link href={`/app/purchases/${purchase.id}/edit`}>Edit</Link>
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleCancel}
                    disabled={cancelMutation.isPending || receiveMutation.isPending}
                  >
                    {cancelMutation.isPending ? "Cancelling..." : "Cancel purchase"}
                  </Button>
                  <Button
                    type="button"
                    onClick={handleReceive}
                    disabled={receiveMutation.isPending || cancelMutation.isPending}
                  >
                    {receiveMutation.isPending ? "Receiving..." : "Receive purchase"}
                  </Button>
                </>
              )}
            </div>
          </div>

          {isDraft && (
            <p className="mt-4 text-xs text-muted-foreground">
              Receiving writes stock for every line and cannot be undone by editing; a received
              purchase is corrected only by a deliberate, audited reversal. Cancelling keeps the
              draft readable but removes it from the receiving path.
            </p>
          )}
        </CardContent>
      </Card>

      {receiveMutation.isSuccess && (
        <div
          role="status"
          className="rounded-lg border border-border bg-muted p-4 text-sm text-foreground"
        >
          <p className="font-medium">Purchase received</p>
          <p>
            Stock has been written for every line and the purchase is now RECEIVED. This cannot be
            undone by editing.
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
              The purchase already moved on, so this was not applied. Reload to see its current
              status; retrying the same receive will not change it.
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
              ? "This purchase is no longer a draft"
              : isPurchasePermissionDenied(cancelMutation.error)
                ? "Permission denied"
                : "Cancel failed"}
          </p>
          <p>{userFacingPurchaseError(cancelMutation.error)}</p>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Purchase details</CardTitle>
          <CardDescription>
            Read-only view. No status control and no delete: the transitions are the explicit
            receive and cancel actions above.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <DetailRow label="Supplier" value={supplierNames.nameFor(purchase.supplierId)} />
          <DetailRow label="Status" value={PURCHASE_STATUS_LABELS[purchase.status]} />
          <DetailRow label="Reference" value={`#${shortId(purchase.id)}`} />
          <DetailRow label="Created" value={formatDate(purchase.createdAt)} />
          <DetailRow label="Updated" value={formatDate(purchase.updatedAt)} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Lines</CardTitle>
          <CardDescription>
            {purchase.lines.length} {purchase.lines.length === 1 ? "line" : "lines"}. Quantities and
            costs are the API&apos;s exact decimal strings; no total is derived.
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
              <span className="text-muted-foreground">Qty {line.quantity}</span>
              <span className="text-right font-medium text-foreground">
                {line.unitCost === null ? "No unit cost" : `Unit cost ${line.unitCost}`}
              </span>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
