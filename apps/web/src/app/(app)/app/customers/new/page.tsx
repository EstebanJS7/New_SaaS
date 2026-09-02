"use client";

import type { JSX } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CustomerForm } from "../customer-form";
import { createCustomer } from "../customers-api";

/**
 * Staff create-customer page.
 */
export default function NewCustomerPage(): JSX.Element {
  const router = useRouter();
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: createCustomer,
    onSuccess: (customer) => {
      queryClient.setQueryData(["customers"], (previous: unknown) => {
        const list = (previous as { id: string }[] | undefined) ?? [];
        return [customer, ...list];
      });
      router.push(`/app/customers/${customer.id}`);
    },
  });

  return (
    <div className="mx-auto max-w-2xl">
      <CustomerForm
        onSubmit={(body) => mutation.mutate(body)}
        isPending={mutation.isPending}
        error={mutation.error}
      />
    </div>
  );
}
