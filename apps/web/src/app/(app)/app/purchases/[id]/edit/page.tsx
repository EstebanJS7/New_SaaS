"use client";

import type { JSX } from "react";
import { useParams, useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PurchaseForm } from "../../purchase-form";
import {
  getPurchase,
  isPurchasePermissionDenied,
  updatePurchase,
  userFacingPurchaseError,
} from "../../purchases-api";

/**
 * Staff edit-draft page.
 *
 * Read states: an explicit loading state, a permission-denied state for a `403`
 * read, the mapped not-found state for a `404` — the same answer a cross-tenant
 * id receives — and the loaded form. Mutation states: pending on the form, the
 * API's `400`/`403` envelope rendered by the form (a `409` as the non-draft
 * conflict), and success updating the detail cache, invalidating the list and
 * returning to it.
 *
 * The form submits the FULL desired line set, so a removed line is dropped by
 * the API's reconciliation. It cannot write `status`: receiving and cancelling
 * are the API's own explicit commands, offered on the detail page.
 */
export default function EditPurchasePage(): JSX.Element {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const id = params.id;

  const query = useQuery({
    queryKey: ["purchases", "detail", id],
    queryFn: () => getPurchase(id),
  });

  const mutation = useMutation({
    mutationFn: (body: Record<string, unknown>) => updatePurchase(id, body),
    onSuccess: (purchase) => {
      queryClient.setQueryData(["purchases", "detail", id], purchase);
      void queryClient.invalidateQueries({ queryKey: ["purchases", "list"] });
      router.push("/app/purchases");
    },
  });

  if (query.isLoading) {
    return (
      <div className="mx-auto max-w-2xl">
        <p className="text-sm text-muted-foreground">Loading purchase...</p>
      </div>
    );
  }

  if (query.error) {
    return (
      <div
        role="alert"
        className="mx-auto max-w-2xl rounded-lg border border-destructive bg-destructive/10 p-4 text-sm text-destructive"
      >
        {isPurchasePermissionDenied(query.error) && (
          <p className="font-medium">Permission denied</p>
        )}
        <p>{userFacingPurchaseError(query.error)}</p>
      </div>
    );
  }

  if (!query.data) {
    return (
      <div className="mx-auto max-w-2xl">
        <p className="text-sm text-muted-foreground">Purchase not found.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl">
      <PurchaseForm
        purchase={query.data}
        onSubmit={(body) => mutation.mutate(body)}
        isPending={mutation.isPending}
        error={mutation.error}
      />
    </div>
  );
}
