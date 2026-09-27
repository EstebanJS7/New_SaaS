"use client";

import type { JSX } from "react";
import { useState } from "react";
import Link from "next/link";
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
  isPurchasePermissionDenied,
  listPurchases,
  PURCHASE_STATUSES,
  userFacingPurchaseError,
  type Purchase,
  type PurchaseStatus,
} from "./purchases-api";
import { PURCHASE_STATUS_LABELS, formatDate, shortId, useSupplierNames } from "./purchase-display";

const selectClassName =
  "h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

function PurchaseCard({
  purchase,
  supplierName,
}: {
  readonly purchase: Purchase;
  readonly supplierName: string;
}): JSX.Element {
  return (
    <div className="flex items-start justify-between rounded-lg border bg-card p-4 text-card-foreground shadow-sm">
      <div className="min-w-0 space-y-1">
        <div className="flex items-center gap-2">
          <Link
            href={`/app/purchases/${purchase.id}`}
            className="truncate font-medium text-primary hover:underline"
          >
            Purchase #{shortId(purchase.id)}
          </Link>
          <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
            {PURCHASE_STATUS_LABELS[purchase.status]}
          </span>
        </div>
        <p className="text-sm text-muted-foreground">
          {supplierName} · {purchase.lines.length} {purchase.lines.length === 1 ? "line" : "lines"}{" "}
          · {formatDate(purchase.createdAt)}
        </p>
      </div>
      <div className="flex shrink-0 gap-2">
        {purchase.status === "DRAFT" && (
          <Button type="button" variant="outline" size="sm" asChild>
            <Link href={`/app/purchases/${purchase.id}/edit`}>Edit</Link>
          </Button>
        )}
      </div>
    </div>
  );
}

/**
 * Staff purchase list with the lifecycle filter and the loading, empty, error
 * and permission-denied states.
 *
 * The lifecycle filter is a presentation choice mapped onto the API's one
 * `status` key; an unfiltered list applies NO implicit default, so the caller
 * opts in to a single status rather than the surface hiding one. The server
 * remains the filter authority.
 *
 * The purchase reference opens the detail route, where every transition lives:
 * the list offers no status control and no delete affordance, and Edit is a
 * separate destination the API authorizes.
 *
 * Permission checks are UX-only; the backend enforces the real gates and
 * answers `403` when the staff role does not hold `purchases.read`.
 */
export function PurchaseList(): JSX.Element {
  const [status, setStatus] = useState<PurchaseStatus | "">("");
  const supplierNames = useSupplierNames();

  const query = useQuery({
    queryKey: ["purchases", "list", status],
    queryFn: () => listPurchases({ status: status === "" ? undefined : status }),
  });

  const emptyTitle = status === "" ? "No purchases yet" : "No purchases match this filter";
  const emptyDescription =
    status === ""
      ? "Get started by drafting the first purchase for this tenant."
      : "Try a different lifecycle status.";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Purchases</h1>
          <p className="text-sm text-muted-foreground">
            Draft, receive and cancel the purchases this tenant makes.
          </p>
        </div>
        <Button type="button" asChild>
          <Link href="/app/purchases/new">New purchase</Link>
        </Button>
      </div>

      <div className="space-y-2 sm:max-w-xs">
        <label htmlFor="purchase-status-filter" className="text-sm font-medium">
          Status
        </label>
        <select
          id="purchase-status-filter"
          value={status}
          onChange={(event) => setStatus(event.target.value as PurchaseStatus | "")}
          className={selectClassName}
        >
          <option value="">All statuses</option>
          {PURCHASE_STATUSES.map((value) => (
            <option key={value} value={value}>
              {PURCHASE_STATUS_LABELS[value]}
            </option>
          ))}
        </select>
      </div>

      {query.isLoading ? (
        <Card>
          <CardContent className="p-6">
            <p className="text-sm text-muted-foreground">Loading purchases...</p>
          </CardContent>
        </Card>
      ) : query.error ? (
        <div
          role="alert"
          className="rounded-lg border border-destructive bg-destructive/10 p-4 text-sm text-destructive"
        >
          {isPurchasePermissionDenied(query.error) && (
            <p className="font-medium">Permission denied</p>
          )}
          <p>{userFacingPurchaseError(query.error)}</p>
        </div>
      ) : query.data?.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>{emptyTitle}</CardTitle>
            <CardDescription>{emptyDescription}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button type="button" asChild>
              <Link href="/app/purchases/new">Draft purchase</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {query.data?.map((purchase) => (
            <PurchaseCard
              key={purchase.id}
              purchase={purchase}
              supplierName={supplierNames.nameFor(purchase.supplierId)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
