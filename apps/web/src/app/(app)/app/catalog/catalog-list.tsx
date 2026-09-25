"use client";

import type { JSX } from "react";
import { useState } from "react";
import Link from "next/link";
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
  ApiRequestError,
  CATALOG_ITEM_KINDS,
  deactivateCatalogItem,
  listCatalogItems,
  userFacingCatalogError,
  type CatalogItem,
  type CatalogItemKind,
} from "./catalog-api";

const selectClassName =
  "h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

const KIND_LABELS: Record<CatalogItemKind, string> = {
  PRODUCT: "Product",
  SERVICE: "Service",
  MEDICATION: "Medication",
  SUPPLY: "Supply",
};

/** 403 FORBIDDEN is the permission gate; other 403s (entitlement) keep their own copy. */
function isPermissionDenied(error: Error): boolean {
  return error instanceof ApiRequestError && error.code === "FORBIDDEN";
}

function referencePriceLabel(item: CatalogItem): string | null {
  if (item.referencePriceAmount === null || item.referencePriceCurrency === null) {
    return null;
  }
  return `${item.referencePriceAmount} ${item.referencePriceCurrency}`;
}

function CatalogItemCard({ item }: { readonly item: CatalogItem }): JSX.Element {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: () => deactivateCatalogItem(item.id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["catalog"] });
    },
  });

  function handleDeactivate(): void {
    if (!window.confirm("Deactivate this catalog item?")) return;
    mutation.mutate();
  }

  const price = referencePriceLabel(item);

  return (
    <div className="flex items-start justify-between rounded-lg border bg-card p-4 text-card-foreground shadow-sm">
      <div className="min-w-0 space-y-1">
        <div className="flex items-center gap-2">
          <Link
            href={`/app/catalog/${item.id}`}
            className="truncate font-medium text-primary hover:underline"
          >
            {item.name}
          </Link>
          {!item.isActive && (
            <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
              Inactive
            </span>
          )}
        </div>
        <p className="text-sm text-muted-foreground">
          {KIND_LABELS[item.kind]} · {item.taxRate.name}
          {price ? ` · ${price}` : ""}
        </p>
        {mutation.error && (
          <p role="alert" className="text-xs text-destructive">
            {userFacingCatalogError(mutation.error)}
          </p>
        )}
      </div>
      <div className="flex shrink-0 gap-2">
        <Button type="button" variant="outline" size="sm" asChild>
          <Link href={`/app/catalog/${item.id}/edit`}>Edit</Link>
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleDeactivate}
          disabled={mutation.isPending || !item.isActive}
        >
          {mutation.isPending ? "Deactivating..." : "Deactivate"}
        </Button>
      </div>
    </div>
  );
}

/**
 * Staff catalog list with kind and status filters and the loading, empty,
 * error and permission-denied states.
 *
 * The status filter defaults to ACTIVE items: an unfiltered list would mix
 * retired items into daily work, so the caller must opt in to see deactivated
 * ones. That default is a presentation choice mapped onto the API's one
 * `isActive` key; the server remains the filter authority.
 *
 * The item name opens the READ-ONLY detail route so a role that only holds
 * `catalog.read` is never dropped straight into a form it cannot submit; Edit
 * stays a separate, explicit destination because the API, not this list,
 * decides whether the write is allowed.
 *
 * Permission checks are UX-only; the backend enforces the real gates and
 * answers 403 when the staff role does not hold `catalog.read`.
 */
export function CatalogList(): JSX.Element {
  const [kind, setKind] = useState<CatalogItemKind | "">("");
  const [includeInactive, setIncludeInactive] = useState(false);

  const query = useQuery({
    queryKey: ["catalog", kind, includeInactive],
    queryFn: () =>
      listCatalogItems({
        kind: kind === "" ? undefined : kind,
        // Default to active only; including deactivated drops the filter entirely.
        isActive: includeInactive ? undefined : true,
      }),
  });

  const emptyTitle =
    kind !== ""
      ? "No items match these filters"
      : includeInactive
        ? "No catalog items yet"
        : "No active catalog items";
  const emptyDescription =
    kind !== ""
      ? "Try a different kind or include deactivated items."
      : includeInactive
        ? "Get started by creating the first catalog item for this tenant."
        : "Every catalog item for this tenant is deactivated. Include deactivated items to review them.";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Catalog</h1>
          <p className="text-sm text-muted-foreground">
            Manage tenant products, services, medications and supplies.
          </p>
        </div>
        <Button type="button" asChild>
          <Link href="/app/catalog/new">New item</Link>
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <label htmlFor="catalog-kind-filter" className="text-sm font-medium">
            Kind
          </label>
          <select
            id="catalog-kind-filter"
            value={kind}
            onChange={(event) => setKind(event.target.value as CatalogItemKind | "")}
            className={selectClassName}
          >
            <option value="">All kinds</option>
            {CATALOG_ITEM_KINDS.map((itemKind) => (
              <option key={itemKind} value={itemKind}>
                {KIND_LABELS[itemKind]}
              </option>
            ))}
          </select>
        </div>

        <label className="flex items-end gap-2 pb-2 text-sm">
          <input
            type="checkbox"
            checked={includeInactive}
            onChange={(event) => setIncludeInactive(event.target.checked)}
            className="h-4 w-4 rounded border-input"
          />
          Include deactivated items
        </label>
      </div>

      {query.isLoading ? (
        <Card>
          <CardContent className="p-6">
            <p className="text-sm text-muted-foreground">Loading catalog items...</p>
          </CardContent>
        </Card>
      ) : query.error ? (
        <div
          role="alert"
          className="rounded-lg border border-destructive bg-destructive/10 p-4 text-sm text-destructive"
        >
          {isPermissionDenied(query.error) && <p className="font-medium">Permission denied</p>}
          <p>{userFacingCatalogError(query.error)}</p>
        </div>
      ) : query.data?.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>{emptyTitle}</CardTitle>
            <CardDescription>{emptyDescription}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button type="button" asChild>
              <Link href="/app/catalog/new">Create item</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {query.data?.map((item) => (
            <CatalogItemCard key={item.id} item={item} />
          ))}
        </div>
      )}
    </div>
  );
}
