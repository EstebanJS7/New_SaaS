"use client";

import type { JSX } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { SupplierForm } from "../supplier-form";
import { createSupplier } from "../suppliers-api";

/**
 * Staff create-supplier page.
 *
 * Mutation states: the form disables itself and reports the pending save, the
 * API's `400`/`403` envelope is rendered in the form alert (a `403` as the
 * permission-denied copy, a duplicate `taxId` `409` as the identifier conflict),
 * and success invalidates the list cache before routing to the edit page.
 */
export default function NewSupplierPage(): JSX.Element {
  const router = useRouter();
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: createSupplier,
    onSuccess: (supplier) => {
      void queryClient.invalidateQueries({ queryKey: ["suppliers"] });
      router.push(`/app/suppliers/${supplier.id}/edit`);
    },
  });

  return (
    <div className="mx-auto max-w-2xl">
      <SupplierForm
        onSubmit={(body) => mutation.mutate(body)}
        isPending={mutation.isPending}
        error={mutation.error}
      />
    </div>
  );
}
