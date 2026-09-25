"use client";

import type { JSX } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CatalogForm } from "../catalog-form";
import { createCatalogItem } from "../catalog-api";

/**
 * Staff create-catalog-item page.
 */
export default function NewCatalogItemPage(): JSX.Element {
  const router = useRouter();
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: createCatalogItem,
    onSuccess: (item) => {
      void queryClient.invalidateQueries({ queryKey: ["catalog"] });
      router.push(`/app/catalog/${item.id}/edit`);
    },
  });

  return (
    <div className="mx-auto max-w-2xl">
      <CatalogForm
        onSubmit={(body) => mutation.mutate(body)}
        isPending={mutation.isPending}
        error={mutation.error}
      />
    </div>
  );
}
