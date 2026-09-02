"use client";

import type { JSX } from "react";
import { useParams, useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CustomerForm } from "../../customer-form";
import { getCustomer, updateCustomer } from "../../customers-api";

/**
 * Staff edit-customer page.
 */
export default function EditCustomerPage(): JSX.Element {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const id = params.id;

  const query = useQuery({
    queryKey: ["customers", id],
    queryFn: () => getCustomer(id),
  });

  const mutation = useMutation({
    mutationFn: (body: Record<string, unknown>) => updateCustomer(id, body),
    onSuccess: (customer) => {
      queryClient.setQueryData(["customers", id], customer);
      void queryClient.invalidateQueries({ queryKey: ["customers"] });
      router.push(`/app/customers/${customer.id}`);
    },
  });

  if (query.isLoading) {
    return (
      <div className="mx-auto max-w-2xl">
        <p className="text-sm text-muted-foreground">Loading customer...</p>
      </div>
    );
  }

  if (query.error) {
    return (
      <div
        role="alert"
        className="mx-auto max-w-2xl rounded-lg border border-destructive bg-destructive/10 p-4 text-sm text-destructive"
      >
        {query.error.message}
      </div>
    );
  }

  if (!query.data) {
    return (
      <div className="mx-auto max-w-2xl">
        <p className="text-sm text-muted-foreground">Customer not found.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl">
      <CustomerForm
        customer={query.data}
        onSubmit={(body) => mutation.mutate(body)}
        isPending={mutation.isPending}
        error={mutation.error}
      />
    </div>
  );
}
