"use client";

import type { JSX } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@newsaas/ui/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@newsaas/ui/components/ui/card";
import { deactivateCustomer, listCustomers, type Customer } from "./customers-api";

function userFacingErrorMessage(error: Error): string {
  const message = error.message;
  if (message.includes("UNAUTHENTICATED") || message.includes("Authentication required")) {
    return "You must be signed in to view customers.";
  }
  if (message.includes("FORBIDDEN") || message.includes("Access denied")) {
    return "You do not have permission to manage customers.";
  }
  return message;
}

function CustomerCard({ customer }: { readonly customer: Customer }): JSX.Element {
  const router = useRouter();
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: () => deactivateCustomer(customer.id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["customers"] });
    },
  });

  function handleDeactivate(): void {
    if (!window.confirm("Deactivate this customer?")) return;
    mutation.mutate();
  }

  return (
    <div className="flex items-start justify-between rounded-lg border bg-card p-4 text-card-foreground shadow-sm">
      <div className="min-w-0 space-y-1">
        <Link
          href={`/app/customers/${customer.id}`}
          className="truncate font-medium text-primary hover:underline"
        >
          {customer.displayName}
        </Link>
        <p className="text-sm text-muted-foreground">
          {customer.kind === "INDIVIDUAL"
            ? [customer.firstName, customer.lastName].filter(Boolean).join(" ") || "Individual"
            : (customer.legalName ?? "Company")}
        </p>
      </div>
      <div className="flex shrink-0 gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => router.push(`/app/customers/${customer.id}/edit`)}
        >
          Edit
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleDeactivate}
          disabled={mutation.isPending || !customer.isActive}
        >
          {mutation.isPending ? "Deactivating..." : "Deactivate"}
        </Button>
      </div>
    </div>
  );
}

/**
 * Staff customer list with loading, empty, error, and deactivate states.
 *
 * Permission checks are UX-only; the backend enforces the actual gates and
 * returns 403 when the staff role does not hold the required permission.
 */
export function CustomersList(): JSX.Element {
  const query = useQuery({
    queryKey: ["customers"],
    queryFn: listCustomers,
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Customers</h1>
          <p className="text-sm text-muted-foreground">
            Manage tenant customers, addresses, and contacts.
          </p>
        </div>
        <Button type="button" asChild>
          <Link href="/app/customers/new">New customer</Link>
        </Button>
      </div>

      {query.isLoading ? (
        <Card>
          <CardContent className="p-6">
            <p className="text-sm text-muted-foreground">Loading customers...</p>
          </CardContent>
        </Card>
      ) : query.error ? (
        <div
          role="alert"
          className="rounded-lg border border-destructive bg-destructive/10 p-4 text-sm text-destructive"
        >
          {userFacingErrorMessage(query.error)}
        </div>
      ) : query.data?.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>No customers yet</CardTitle>
            <CardDescription>
              Get started by creating the first customer for this tenant.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button type="button" asChild>
              <Link href="/app/customers/new">Create customer</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {query.data?.map((customer) => (
            <CustomerCard key={customer.id} customer={customer} />
          ))}
        </div>
      )}
    </div>
  );
}
