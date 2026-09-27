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
  getSupplier,
  isSupplierPermissionDenied,
  userFacingSupplierError,
  type Supplier,
} from "../suppliers-api";

/** An absent optional field is shown as "Not set"; no value is invented. */
function optionalFieldLabel(value: string | null): string {
  return value ?? "Not set";
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
 * Read-only staff detail for one supplier.
 *
 * It exists so a role that holds only `suppliers.read` can inspect a supplier
 * without being dropped into a form it cannot submit. This surface mutates
 * nothing: there is no deactivate command and no delete affordance here, and
 * Edit is a separate destination whose write the API, never a client-side
 * permission guess, decides to allow or refuse.
 *
 * The identity and contact fields rendered here are CONFIDENTIAL (DEC-011):
 * they are displayed to the authorized staff role the API already answered, and
 * the payload is never written to the console, error telemetry or analytics.
 *
 * Permission checks are UX-only; the backend enforces every gate and answers
 * `403` when the staff role does not hold `suppliers.read`.
 */
export function SupplierDetail(): JSX.Element {
  const params = useParams<{ id: string }>();
  const supplierId = params.id;

  const query = useQuery({
    queryKey: ["suppliers", "supplier", supplierId],
    queryFn: () => getSupplier(supplierId),
  });

  if (query.isLoading) {
    return <p className="text-sm text-muted-foreground">Loading supplier...</p>;
  }

  if (query.error) {
    return (
      <div
        role="alert"
        className="rounded-lg border border-destructive bg-destructive/10 p-4 text-sm text-destructive"
      >
        {isSupplierPermissionDenied(query.error) && (
          <p className="font-medium">Permission denied</p>
        )}
        <p>{userFacingSupplierError(query.error)}</p>
      </div>
    );
  }

  const supplier: Supplier | undefined = query.data;
  if (!supplier) {
    return <p className="text-sm text-muted-foreground">Supplier not found.</p>;
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="p-6">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h1 className="truncate text-2xl font-semibold tracking-tight">{supplier.name}</h1>
              <p className="text-sm text-muted-foreground">
                {supplier.isActive ? "Active supplier" : "Inactive supplier"}
              </p>
            </div>
            <div className="flex shrink-0 gap-2">
              <Button type="button" variant="outline" asChild>
                <Link href={`/app/suppliers/${supplier.id}/edit`}>Edit</Link>
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Supplier details</CardTitle>
          <CardDescription>
            Read-only view. Removal is a deactivation from the supplier list, never a delete.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <DetailRow label="Legal name" value={optionalFieldLabel(supplier.legalName)} />
          <DetailRow label="Tax identifier" value={optionalFieldLabel(supplier.taxId)} />
          <DetailRow label="Email" value={optionalFieldLabel(supplier.email)} />
          <DetailRow label="Phone" value={optionalFieldLabel(supplier.phone)} />
          <DetailRow label="Address" value={optionalFieldLabel(supplier.address)} />
          <DetailRow label="Status" value={supplier.isActive ? "Active" : "Inactive"} />
        </CardContent>
      </Card>
    </div>
  );
}
