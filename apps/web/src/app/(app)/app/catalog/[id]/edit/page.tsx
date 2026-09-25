"use client";

import type { JSX } from "react";
import { useParams, useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CatalogForm } from "../../catalog-form";
import { getCatalogItem, updateCatalogItem, userFacingCatalogError } from "../../catalog-api";

/**
 * Staff edit-catalog-item page.
 */
export default function EditCatalogItemPage(): JSX.Element {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const id = params.id;

  const query = useQuery({
    queryKey: ["catalog", "item", id],
    queryFn: () => getCatalogItem(id),
  });

  const mutation = useMutation({
    mutationFn: (body: Record<string, unknown>) => updateCatalogItem(id, body),
    onSuccess: (item) => {
      queryClient.setQueryData(["catalog", "item", id], item);
      void queryClient.invalidateQueries({ queryKey: ["catalog"] });
      router.push("/app/catalog");
    },
  });

  if (query.isLoading) {
    return (
      <div className="mx-auto max-w-2xl">
        <p className="text-sm text-muted-foreground">Loading catalog item...</p>
      </div>
    );
  }

  if (query.error) {
    return (
      <div
        role="alert"
        className="mx-auto max-w-2xl rounded-lg border border-destructive bg-destructive/10 p-4 text-sm text-destructive"
      >
        {userFacingCatalogError(query.error)}
      </div>
    );
  }

  if (!query.data) {
    return (
      <div className="mx-auto max-w-2xl">
        <p className="text-sm text-muted-foreground">Catalog item not found.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl">
      <CatalogForm
        item={query.data}
        onSubmit={(body) => mutation.mutate(body)}
        isPending={mutation.isPending}
        error={mutation.error}
      />
    </div>
  );
}
