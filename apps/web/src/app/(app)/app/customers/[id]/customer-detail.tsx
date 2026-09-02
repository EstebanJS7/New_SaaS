"use client";

import type { JSX, ReactNode } from "react";
import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
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
  createAddress,
  createContact,
  deactivateAddress,
  deactivateContact,
  deactivateCustomer,
  getCustomer,
  listAddresses,
  listContacts,
  type CustomerAddress,
  type CustomerContact,
} from "../customers-api";

const inputClassName =
  "h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

const selectClassName =
  "h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

function SectionCard({
  title,
  description,
  children,
}: {
  readonly title: string;
  readonly description: string;
  readonly children: ReactNode;
}): JSX.Element {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">{children}</CardContent>
    </Card>
  );
}

function AddAddressForm({ customerId }: { readonly customerId: string }): JSX.Element {
  const queryClient = useQueryClient();
  const [values, setValues] = useState({
    label: "",
    line1: "",
    line2: "",
    city: "",
    state: "",
    postalCode: "",
    countryCode: "",
  });
  const [success, setSuccess] = useState(false);

  const mutation = useMutation({
    mutationFn: () =>
      createAddress(customerId, {
        label: values.label.trim() || undefined,
        line1: values.line1.trim(),
        line2: values.line2.trim() || undefined,
        city: values.city.trim() || undefined,
        state: values.state.trim() || undefined,
        postalCode: values.postalCode.trim() || undefined,
        countryCode: values.countryCode.trim() || undefined,
      }),
    onSuccess: () => {
      setValues({
        label: "",
        line1: "",
        line2: "",
        city: "",
        state: "",
        postalCode: "",
        countryCode: "",
      });
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
      void queryClient.invalidateQueries({ queryKey: ["customers", customerId, "addresses"] });
    },
  });

  function handleSubmit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    mutation.mutate();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      {mutation.error && (
        <div
          role="alert"
          className="rounded-lg border border-destructive bg-destructive/10 p-3 text-sm text-destructive"
        >
          {mutation.error.message}
        </div>
      )}
      {success && <span className="text-sm text-status-success">Address added.</span>}
      <div className="grid gap-3 sm:grid-cols-2">
        <input
          type="text"
          placeholder="Label (e.g. Billing)"
          value={values.label}
          onChange={(event) =>
            setValues((previous) => ({ ...previous, label: event.target.value }))
          }
          disabled={mutation.isPending}
          className={inputClassName}
        />
        <input
          type="text"
          placeholder="Line 1 *"
          value={values.line1}
          onChange={(event) =>
            setValues((previous) => ({ ...previous, line1: event.target.value }))
          }
          required
          disabled={mutation.isPending}
          className={inputClassName}
        />
        <input
          type="text"
          placeholder="Line 2"
          value={values.line2}
          onChange={(event) =>
            setValues((previous) => ({ ...previous, line2: event.target.value }))
          }
          disabled={mutation.isPending}
          className={inputClassName}
        />
        <input
          type="text"
          placeholder="City"
          value={values.city}
          onChange={(event) => setValues((previous) => ({ ...previous, city: event.target.value }))}
          disabled={mutation.isPending}
          className={inputClassName}
        />
        <input
          type="text"
          placeholder="State"
          value={values.state}
          onChange={(event) =>
            setValues((previous) => ({ ...previous, state: event.target.value }))
          }
          disabled={mutation.isPending}
          className={inputClassName}
        />
        <input
          type="text"
          placeholder="Postal code"
          value={values.postalCode}
          onChange={(event) =>
            setValues((previous) => ({ ...previous, postalCode: event.target.value }))
          }
          disabled={mutation.isPending}
          className={inputClassName}
        />
        <input
          type="text"
          placeholder="Country code (2 letters)"
          value={values.countryCode}
          onChange={(event) =>
            setValues((previous) => ({ ...previous, countryCode: event.target.value }))
          }
          disabled={mutation.isPending}
          className={inputClassName}
        />
      </div>
      <Button type="submit" disabled={mutation.isPending}>
        {mutation.isPending ? "Adding..." : "Add address"}
      </Button>
    </form>
  );
}

function AddContactForm({ customerId }: { readonly customerId: string }): JSX.Element {
  const queryClient = useQueryClient();
  const [values, setValues] = useState({
    kind: "EMAIL" as "EMAIL" | "PHONE",
    label: "",
    value: "",
    isPrimary: false,
  });
  const [success, setSuccess] = useState(false);

  const mutation = useMutation({
    mutationFn: () =>
      createContact(customerId, {
        kind: values.kind,
        label: values.label.trim() || undefined,
        value: values.value.trim(),
        isPrimary: values.isPrimary,
      }),
    onSuccess: () => {
      setValues({ kind: "EMAIL", label: "", value: "", isPrimary: false });
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
      void queryClient.invalidateQueries({ queryKey: ["customers", customerId, "contacts"] });
    },
  });

  function handleSubmit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    mutation.mutate();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      {mutation.error && (
        <div
          role="alert"
          className="rounded-lg border border-destructive bg-destructive/10 p-3 text-sm text-destructive"
        >
          {mutation.error.message}
        </div>
      )}
      {success && <span className="text-sm text-status-success">Contact added.</span>}
      <div className="grid gap-3 sm:grid-cols-4">
        <select
          value={values.kind}
          onChange={(event) =>
            setValues((previous) => ({
              ...previous,
              kind: event.target.value as "EMAIL" | "PHONE",
            }))
          }
          disabled={mutation.isPending}
          className={selectClassName}
        >
          <option value="EMAIL">Email</option>
          <option value="PHONE">Phone</option>
        </select>
        <input
          type="text"
          placeholder="Label"
          value={values.label}
          onChange={(event) =>
            setValues((previous) => ({ ...previous, label: event.target.value }))
          }
          disabled={mutation.isPending}
          className={inputClassName}
        />
        <input
          type="text"
          placeholder={values.kind === "EMAIL" ? "email@example.com" : "+1 555 0000"}
          value={values.value}
          onChange={(event) =>
            setValues((previous) => ({ ...previous, value: event.target.value }))
          }
          required
          disabled={mutation.isPending}
          className={inputClassName}
        />
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={values.isPrimary}
            onChange={(event) =>
              setValues((previous) => ({ ...previous, isPrimary: event.target.checked }))
            }
            disabled={mutation.isPending}
            className="h-4 w-4 rounded border-input"
          />
          Primary
        </label>
      </div>
      <Button type="submit" disabled={mutation.isPending}>
        {mutation.isPending ? "Adding..." : "Add contact"}
      </Button>
    </form>
  );
}

function AddressItem({
  address,
  customerId,
}: {
  readonly address: CustomerAddress;
  readonly customerId: string;
}): JSX.Element {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: () => deactivateAddress(customerId, address.id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["customers", customerId, "addresses"] });
    },
  });

  return (
    <div className="flex items-start justify-between rounded-md border bg-card p-3">
      <div className="min-w-0 text-sm">
        {address.label && <p className="font-medium">{address.label}</p>}
        <p className="text-muted-foreground">
          {[address.line1, address.line2, address.city, address.state, address.postalCode]
            .filter(Boolean)
            .join(", ")}
        </p>
        {address.countryCode && <p className="text-muted-foreground">{address.countryCode}</p>}
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={mutation.isPending || !address.isActive}
        onClick={() => mutation.mutate()}
      >
        {mutation.isPending ? "Deactivating..." : "Deactivate"}
      </Button>
    </div>
  );
}

function ContactItem({
  contact,
  customerId,
}: {
  readonly contact: CustomerContact;
  readonly customerId: string;
}): JSX.Element {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: () => deactivateContact(customerId, contact.id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["customers", customerId, "contacts"] });
    },
  });

  return (
    <div className="flex items-start justify-between rounded-md border bg-card p-3">
      <div className="min-w-0 text-sm">
        <p className="font-medium">
          {contact.label ?? contact.kind}
          {contact.isPrimary && (
            <span className="ml-2 rounded bg-primary px-1.5 py-0.5 text-xs text-primary-foreground">
              Primary
            </span>
          )}
        </p>
        <p className="text-muted-foreground">{contact.value}</p>
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={mutation.isPending || !contact.isActive}
        onClick={() => mutation.mutate()}
      >
        {mutation.isPending ? "Deactivating..." : "Deactivate"}
      </Button>
    </div>
  );
}

function CustomerHeader({ customerId }: { readonly customerId: string }): JSX.Element {
  const router = useRouter();
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["customers", customerId],
    queryFn: () => getCustomer(customerId),
  });

  const deactivateMutation = useMutation({
    mutationFn: () => deactivateCustomer(customerId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["customers"] });
      void queryClient.invalidateQueries({ queryKey: ["customers", customerId] });
    },
  });

  function handleDeactivate(): void {
    if (!window.confirm("Deactivate this customer?")) return;
    deactivateMutation.mutate();
  }

  if (query.isLoading) {
    return <p className="text-sm text-muted-foreground">Loading customer...</p>;
  }

  if (query.error) {
    return (
      <div
        role="alert"
        className="rounded-lg border border-destructive bg-destructive/10 p-4 text-sm text-destructive"
      >
        {query.error.message}
      </div>
    );
  }

  const customer = query.data;
  if (!customer) {
    return <p className="text-sm text-muted-foreground">Customer not found.</p>;
  }

  return (
    <Card>
      <CardContent className="p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{customer.displayName}</h1>
            <p className="text-sm text-muted-foreground">
              {customer.kind === "INDIVIDUAL"
                ? [customer.firstName, customer.lastName].filter(Boolean).join(" ") || "Individual"
                : (customer.legalName ?? "Company")}
              {customer.kind === "COMPANY" && customer.taxId && ` · Tax ID ${customer.taxId}`}
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => router.push(`/app/customers/${customer.id}/edit`)}
            >
              Edit
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={deactivateMutation.isPending || !customer.isActive}
              onClick={handleDeactivate}
            >
              {deactivateMutation.isPending ? "Deactivating..." : "Deactivate"}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function AddressSection({ customerId }: { readonly customerId: string }): JSX.Element {
  const query = useQuery({
    queryKey: ["customers", customerId, "addresses"],
    queryFn: () => listAddresses(customerId),
  });

  return (
    <SectionCard title="Addresses" description="Manage billing, shipping, and other addresses.">
      <AddAddressForm customerId={customerId} />
      {query.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading addresses...</p>
      ) : query.error ? (
        <p className="text-sm text-destructive">{query.error.message}</p>
      ) : query.data?.length === 0 ? (
        <p className="text-sm text-muted-foreground">No addresses yet.</p>
      ) : (
        <div className="space-y-2">
          {query.data?.map((address) => (
            <AddressItem key={address.id} address={address} customerId={customerId} />
          ))}
        </div>
      )}
    </SectionCard>
  );
}

function ContactSection({ customerId }: { readonly customerId: string }): JSX.Element {
  const query = useQuery({
    queryKey: ["customers", customerId, "contacts"],
    queryFn: () => listContacts(customerId),
  });

  return (
    <SectionCard title="Contacts" description="Manage email and phone contacts.">
      <AddContactForm customerId={customerId} />
      {query.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading contacts...</p>
      ) : query.error ? (
        <p className="text-sm text-destructive">{query.error.message}</p>
      ) : query.data?.length === 0 ? (
        <p className="text-sm text-muted-foreground">No contacts yet.</p>
      ) : (
        <div className="space-y-2">
          {query.data?.map((contact) => (
            <ContactItem key={contact.id} contact={contact} customerId={customerId} />
          ))}
        </div>
      )}
    </SectionCard>
  );
}

/**
 * Staff customer detail with address and contact management.
 *
 * Permission checks are UX-only; the backend enforces the actual gates.
 */
export function CustomerDetail(): JSX.Element {
  const params = useParams<{ id: string }>();
  const customerId = params.id;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <CustomerHeader customerId={customerId} />
      <AddressSection customerId={customerId} />
      <ContactSection customerId={customerId} />
    </div>
  );
}
