"use client";

import type { JSX } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { PurchaseForm } from "../purchase-form";
import { createPurchase } from "../purchases-api";

/**
 * Staff create-purchase page.
 *
 * Mutation states: the form disables itself and reports the pending save, the
 * API's `400`/`403` envelope is rendered in the form alert (a `403` as the
 * permission-denied copy), and success invalidates the list cache before routing
 * to the new draft's edit page. No status is ever sent: a new purchase is always
 * the server-owned `DRAFT`.
 */
export default function NewPurchasePage(): JSX.Element {
  const router = useRouter();
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: createPurchase,
    onSuccess: (purchase) => {
      void queryClient.invalidateQueries({ queryKey: ["purchases", "list"] });
      router.push(`/app/purchases/${purchase.id}/edit`);
    },
  });

  return (
    <div className="mx-auto max-w-2xl">
      <PurchaseForm
        onSubmit={(body) => mutation.mutate(body)}
        isPending={mutation.isPending}
        error={mutation.error}
      />
    </div>
  );
}
