"use client";

import type { JSX } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CustomerForm } from "../customer-form";
import { createCustomer } from "../customers-api";
import { useCan } from "@/lib/capabilities";
import { CUSTOMER_ACTIONS, CustomersNoAccess } from "../customer-capabilities";

/**
 * Staff create-customer page.
 */
export default function NewCustomerPage(): JSX.Element {
  const router = useRouter();
  const queryClient = useQueryClient();
  const canCreate = useCan(CUSTOMER_ACTIONS.create);

  const mutation = useMutation({
    retry: false,
    mutationFn: createCustomer,
    onSuccess: (customer) => {
      queryClient.setQueryData(["customers"], (previous: unknown) => {
        const list = (previous as { id: string }[] | undefined) ?? [];
        return [customer, ...list];
      });
      router.push(`/app/customers/${customer.id}`);
    },
  });

  if (!canCreate) {
    return (
      <div className="mx-auto max-w-2xl">
        <CustomersNoAccess title="No tenés permiso para crear clientes" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl">
      <CustomerForm
        onSubmit={(body) => mutation.mutateAsync(body)}
        isPending={mutation.isPending}
        error={mutation.error}
      />
    </div>
  );
}
