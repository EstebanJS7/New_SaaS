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
  deactivateSupplier,
  isSupplierPermissionDenied,
  listSuppliers,
  userFacingSupplierError,
  type Supplier,
} from "./suppliers-api";

/** The tax identifier is CONFIDENTIAL: it is rendered or summarized, never logged. */
function taxIdentifierLabel(supplier: Supplier): string {
  return supplier.taxId === null ? "No tax identifier" : `Tax identifier ${supplier.taxId}`;
}

function SupplierCard({ supplier }: { readonly supplier: Supplier }): JSX.Element {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: () => deactivateSupplier(supplier.id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["suppliers"] });
    },
  });

  function handleDeactivate(): void {
    if (!window.confirm("Deactivate this supplier?")) return;
    mutation.mutate();
  }

  return (
    <div className="flex items-start justify-between rounded-lg border bg-card p-4 text-card-foreground shadow-sm">
      <div className="min-w-0 space-y-1">
        <div className="flex items-center gap-2">
          <Link
            href={`/app/suppliers/${supplier.id}`}
            className="truncate font-medium text-primary hover:underline"
          >
            {supplier.name}
          </Link>
          {!supplier.isActive && (
            <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
              Inactive
            </span>
          )}
        </div>
        <p className="text-sm text-muted-foreground">{taxIdentifierLabel(supplier)}</p>
        {mutation.error && (
          <div role="alert" className="text-xs text-destructive">
            {isSupplierPermissionDenied(mutation.error) && (
              <p className="font-medium">Permission denied</p>
            )}
            <p>{userFacingSupplierError(mutation.error)}</p>
          </div>
        )}
      </div>
      <div className="flex shrink-0 gap-2">
        <Button type="button" variant="outline" size="sm" asChild>
          <Link href={`/app/suppliers/${supplier.id}/edit`}>Edit</Link>
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleDeactivate}
          disabled={mutation.isPending || !supplier.isActive}
        >
          {mutation.isPending ? "Deactivating..." : "Deactivate"}
        </Button>
      </div>
    </div>
  );
}

/**
 * Staff supplier list with the status filter and the loading, empty, error and
 * permission-denied states.
 *
 * The status filter defaults to ACTIVE suppliers: an unfiltered list would mix
 * retired suppliers into daily purchasing work, so the caller must opt in to
 * see deactivated ones. That default is a presentation choice mapped onto the
 * API's one `isActive` key; the server remains the filter authority.
 *
 * The supplier name opens the READ-ONLY detail route so a role that only holds
 * `suppliers.read` is never dropped straight into a form it cannot submit; Edit
 * stays a separate, explicit destination because the API, not this list,
 * decides whether the write is allowed.
 *
 * Removal is deactivation only: there is no delete affordance anywhere, and
 * `isActive` is never written through the update form.
 *
 * Permission checks are UX-only; the backend enforces the real gates and
 * answers 403 when the staff role does not hold `suppliers.read`.
 */
export function SupplierList(): JSX.Element {
  const [includeInactive, setIncludeInactive] = useState(false);

  const query = useQuery({
    queryKey: ["suppliers", includeInactive],
    queryFn: () =>
      listSuppliers({
        // Default to active only; including deactivated drops the filter entirely.
        isActive: includeInactive ? undefined : true,
      }),
  });

  const emptyTitle = includeInactive ? "No suppliers yet" : "No active suppliers";
  const emptyDescription = includeInactive
    ? "Get started by registering the first supplier for this tenant."
    : "Every supplier for this tenant is deactivated. Include deactivated suppliers to review them.";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Suppliers</h1>
          <p className="text-sm text-muted-foreground">
            Manage the suppliers this tenant purchases from.
          </p>
        </div>
        <Button type="button" asChild>
          <Link href="/app/suppliers/new">New supplier</Link>
        </Button>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={includeInactive}
          onChange={(event) => setIncludeInactive(event.target.checked)}
          className="h-4 w-4 rounded border-input"
        />
        Include deactivated suppliers
      </label>

      {query.isLoading ? (
        <Card>
          <CardContent className="p-6">
            <p className="text-sm text-muted-foreground">Loading suppliers...</p>
          </CardContent>
        </Card>
      ) : query.error ? (
        <div
          role="alert"
          className="rounded-lg border border-destructive bg-destructive/10 p-4 text-sm text-destructive"
        >
          {isSupplierPermissionDenied(query.error) && (
            <p className="font-medium">Permission denied</p>
          )}
          <p>{userFacingSupplierError(query.error)}</p>
        </div>
      ) : query.data?.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>{emptyTitle}</CardTitle>
            <CardDescription>{emptyDescription}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button type="button" asChild>
              <Link href="/app/suppliers/new">Register supplier</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {query.data?.map((supplier) => (
            <SupplierCard key={supplier.id} supplier={supplier} />
          ))}
        </div>
      )}
    </div>
  );
}
