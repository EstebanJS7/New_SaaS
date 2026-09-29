"use client";

import type { JSX } from "react";
import { useQuery } from "@tanstack/react-query";
import { listCustomers } from "../customers/customers-api";

const selectClassName =
  "h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

interface CustomerSelectorProps {
  readonly customerId: string;
  readonly onChange: (customerId: string) => void;
  readonly disabled: boolean;
}

/**
 * The optional customer selector (EPIC-12 POS-004, DEC-028).
 *
 * The customer is optional and the sale is never blocked without one: the empty
 * option is a walk-in sale, and a failed or empty customer read is a hint, not a
 * gate. There is deliberately no discount field, no appointment picker and no
 * patient picker, and the selector sends only the customer reference the API
 * resolves in-tenant.
 */
export function CustomerSelector({
  customerId,
  onChange,
  disabled,
}: CustomerSelectorProps): JSX.Element {
  const query = useQuery({
    queryKey: ["customers", "pos-options"],
    queryFn: () => listCustomers(),
    retry: false,
  });

  return (
    <div className="space-y-2">
      <label htmlFor="pos-customer" className="text-sm font-medium">
        Customer (optional)
      </label>
      <select
        id="pos-customer"
        value={customerId}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        className={selectClassName}
      >
        <option value="">Walk-in sale (no customer)</option>
        {query.data?.map((customer) => (
          <option key={customer.id} value={customer.id}>
            {customer.displayName}
          </option>
        ))}
      </select>
      {query.isLoading && <p className="text-xs text-muted-foreground">Loading customers...</p>}
      {query.data?.length === 0 && (
        <p className="text-xs text-muted-foreground">
          No customers are available; the sale continues as a walk-in.
        </p>
      )}
      {query.error && (
        <p className="text-xs text-muted-foreground">
          Customers could not be loaded; the sale can continue without one.
        </p>
      )}
    </div>
  );
}
