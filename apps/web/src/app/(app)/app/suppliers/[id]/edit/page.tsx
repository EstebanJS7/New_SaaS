"use client";

import type { JSX } from "react";
import { useParams, useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { SupplierForm } from "../../supplier-form";
import {
  getSupplier,
  isSupplierPermissionDenied,
  updateSupplier,
  userFacingSupplierError,
} from "../../suppliers-api";

/**
 * Staff edit-supplier page.
 *
 * Read states: an explicit loading state, a permission-denied state for a `403`
 * read, the mapped not-found state for a `404` — the same answer a cross-tenant
 * id receives — and the loaded form. Mutation states: pending on the form, the
 * API's `400`/`409`/`403` envelope rendered by the form (the duplicate-`taxId`
 * `409` as the identifier conflict), and success updating the detail cache,
 * invalidating the list and returning to it.
 *
 * The form cannot write `isActive`: removal is the explicit deactivation command
 * on the list, which this page never offers.
 */
export default function EditSupplierPage(): JSX.Element {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const id = params.id;

  const query = useQuery({
    queryKey: ["suppliers", "supplier", id],
    queryFn: () => getSupplier(id),
  });

  const mutation = useMutation({
    mutationFn: (body: Record<string, unknown>) => updateSupplier(id, body),
    onSuccess: (supplier) => {
      queryClient.setQueryData(["suppliers", "supplier", id], supplier);
      void queryClient.invalidateQueries({ queryKey: ["suppliers"] });
      router.push("/app/suppliers");
    },
  });

  if (query.isLoading) {
    return (
      <div className="mx-auto max-w-2xl">
        <p className="text-sm text-muted-foreground">Loading supplier...</p>
      </div>
    );
  }

  if (query.error) {
    return (
      <div
        role="alert"
        className="mx-auto max-w-2xl rounded-lg border border-destructive bg-destructive/10 p-4 text-sm text-destructive"
      >
        {isSupplierPermissionDenied(query.error) && (
          <p className="font-medium">Permission denied</p>
        )}
        <p>{userFacingSupplierError(query.error)}</p>
      </div>
    );
  }

  if (!query.data) {
    return (
      <div className="mx-auto max-w-2xl">
        <p className="text-sm text-muted-foreground">Supplier not found.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl">
      <SupplierForm
        supplier={query.data}
        onSubmit={(body) => mutation.mutate(body)}
        isPending={mutation.isPending}
        error={mutation.error}
      />
    </div>
  );
}
