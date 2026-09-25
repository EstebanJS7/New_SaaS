"use client";

import type { JSX } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
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
  getCatalogItem,
  userFacingCatalogError,
  type CatalogItem,
  type CatalogItemKind,
} from "../catalog-api";

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

/**
 * The reference price travels as the API's exact two-decimal text; the browser
 * never sums, rounds or reformats it, and only the currency label is appended.
 */
function referencePriceLabel(item: CatalogItem): string {
  if (item.referencePriceAmount === null || item.referencePriceCurrency === null) {
    return "Not set";
  }
  return `${item.referencePriceAmount} ${item.referencePriceCurrency}`;
}

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
 * Read-only staff detail for one catalog item.
 *
 * It exists so a role that holds only `catalog.read` can inspect an item without
 * being dropped into a form it cannot submit. This surface mutates nothing and
 * offers no deactivate command; Edit is a separate destination whose write the
 * API, never a client-side permission guess, decides to allow or refuse.
 *
 * Permission checks are UX-only; the backend enforces every gate and answers
 * `403` when the staff role does not hold `catalog.read`.
 */
export function CatalogItemDetail(): JSX.Element {
  const params = useParams<{ id: string }>();
  const itemId = params.id;

  const query = useQuery({
    queryKey: ["catalog", "item", itemId],
    queryFn: () => getCatalogItem(itemId),
  });

  if (query.isLoading) {
    return <p className="text-sm text-muted-foreground">Loading catalog item...</p>;
  }

  if (query.error) {
    return (
      <div
        role="alert"
        className="rounded-lg border border-destructive bg-destructive/10 p-4 text-sm text-destructive"
      >
        {isPermissionDenied(query.error) && <p className="font-medium">Permission denied</p>}
        <p>{userFacingCatalogError(query.error)}</p>
      </div>
    );
  }

  const item = query.data;
  if (!item) {
    return <p className="text-sm text-muted-foreground">Catalog item not found.</p>;
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="p-6">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h1 className="truncate text-2xl font-semibold tracking-tight">{item.name}</h1>
              <p className="text-sm text-muted-foreground">
                {KIND_LABELS[item.kind]} · {item.taxRate.name}
              </p>
            </div>
            <div className="flex shrink-0 gap-2">
              <Button type="button" variant="outline" asChild>
                <Link href={`/app/catalog/${item.id}/edit`}>Edit</Link>
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Item details</CardTitle>
          <CardDescription>
            Read-only view. Tax rates are global; this item only selects one.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <DetailRow label="Kind" value={KIND_LABELS[item.kind]} />
          <DetailRow label="Tax rate" value={item.taxRate.name} />
          <DetailRow label="Reference price" value={referencePriceLabel(item)} />
          <DetailRow label="Status" value={item.isActive ? "Active" : "Inactive"} />
        </CardContent>
      </Card>
    </div>
  );
}
