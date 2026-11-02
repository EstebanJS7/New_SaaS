"use client";

import type { JSX } from "react";
import { useParams, useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ErrorState } from "@/components/feedback";
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
    retry: false,
  });

  const mutation = useMutation({
    retry: false,
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
        <p className="text-sm text-muted-foreground">Cargando artículo…</p>
      </div>
    );
  }

  if (query.error) {
    return (
      <div className="mx-auto max-w-2xl">
        <ErrorState
          message={userFacingCatalogError(query.error)}
          onRetry={() => void query.refetch()}
        />
      </div>
    );
  }

  if (!query.data) {
    return (
      <div className="mx-auto max-w-2xl">
        <p className="text-sm text-muted-foreground">No encontramos el artículo del catálogo.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl">
      <CatalogForm
        item={query.data}
        onSubmit={(body) => mutation.mutateAsync(body)}
        isPending={mutation.isPending}
        error={mutation.error}
      />
    </div>
  );
}
