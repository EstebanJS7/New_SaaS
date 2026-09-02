"use client";

import type { JSX } from "react";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@newsaas/ui/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@newsaas/ui/components/ui/card";
import type { Customer } from "./customers-api";

const inputClassName =
  "h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

const selectClassName =
  "h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

interface CustomerFormValues {
  kind: "INDIVIDUAL" | "COMPANY";
  displayName: string;
  firstName: string;
  lastName: string;
  documentNumber: string;
  legalName: string;
  taxId: string;
}

function emptyValues(): CustomerFormValues {
  return {
    kind: "INDIVIDUAL",
    displayName: "",
    firstName: "",
    lastName: "",
    documentNumber: "",
    legalName: "",
    taxId: "",
  };
}

function customerToValues(customer: Customer): CustomerFormValues {
  return {
    kind: customer.kind,
    displayName: customer.displayName,
    firstName: customer.firstName ?? "",
    lastName: customer.lastName ?? "",
    documentNumber: customer.documentNumber ?? "",
    legalName: customer.legalName ?? "",
    taxId: customer.taxId ?? "",
  };
}

function buildCreateBody(values: CustomerFormValues): Record<string, unknown> {
  const body: Record<string, unknown> = {
    kind: values.kind,
    displayName: values.displayName.trim(),
  };

  if (values.kind === "INDIVIDUAL") {
    const firstName = values.firstName.trim();
    const lastName = values.lastName.trim();
    const documentNumber = values.documentNumber.trim();
    if (firstName) body.firstName = firstName;
    if (lastName) body.lastName = lastName;
    if (documentNumber) body.documentNumber = documentNumber;
  } else {
    body.legalName = values.legalName.trim();
    body.taxId = values.taxId.trim();
  }

  return body;
}

function buildUpdateBody(values: CustomerFormValues, customer: Customer): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  const displayName = values.displayName.trim();

  if (displayName !== customer.displayName) {
    body.displayName = displayName;
  }

  if (customer.kind === "INDIVIDUAL") {
    const firstName = values.firstName.trim();
    const lastName = values.lastName.trim();
    const documentNumber = values.documentNumber.trim();
    if (firstName && firstName !== (customer.firstName ?? "")) body.firstName = firstName;
    if (lastName && lastName !== (customer.lastName ?? "")) body.lastName = lastName;
    if (documentNumber && documentNumber !== (customer.documentNumber ?? "")) {
      body.documentNumber = documentNumber;
    }
  } else {
    const legalName = values.legalName.trim();
    const taxId = values.taxId.trim();
    if (legalName && legalName !== (customer.legalName ?? "")) body.legalName = legalName;
    if (taxId && taxId !== (customer.taxId ?? "")) body.taxId = taxId;
  }

  return body;
}

interface CustomerFormProps {
  readonly customer?: Customer;
  readonly onSubmit: (body: Record<string, unknown>) => void;
  readonly isPending: boolean;
  readonly error: Error | null;
}

/**
 * Shared create/edit form for Customers.
 *
 * Fields are conditionally shown by kind to match the server-side kind-scoped
 * validation. The submit body is built so only populated/changed fields are
 * sent, keeping network payloads minimal and avoiding kind-mismatched keys.
 */
export function CustomerForm({
  customer,
  onSubmit,
  isPending,
  error,
}: CustomerFormProps): JSX.Element {
  const router = useRouter();
  const isEdit = customer !== undefined;
  const initialValues = useMemo(
    () => (customer ? customerToValues(customer) : emptyValues()),
    [customer]
  );
  const [values, setValues] = useState<CustomerFormValues>(initialValues);

  function handleSubmit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const body = isEdit && customer ? buildUpdateBody(values, customer) : buildCreateBody(values);
    onSubmit(body);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{isEdit ? "Edit customer" : "New customer"}</CardTitle>
        <CardDescription>
          {isEdit
            ? "Update the customer record. Kind cannot be changed."
            : "Create an individual or company customer."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {error && (
          <div
            role="alert"
            className="mb-4 rounded-lg border border-destructive bg-destructive/10 p-4 text-sm text-destructive"
          >
            {error.message}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="kind" className="text-sm font-medium">
              Kind
            </label>
            {isEdit ? (
              <input
                id="kind"
                type="text"
                value={values.kind}
                disabled
                className={inputClassName}
              />
            ) : (
              <select
                id="kind"
                value={values.kind}
                onChange={(event) =>
                  setValues((previous) => ({
                    ...previous,
                    kind: event.target.value as "INDIVIDUAL" | "COMPANY",
                  }))
                }
                disabled={isPending}
                className={selectClassName}
              >
                <option value="INDIVIDUAL">Individual</option>
                <option value="COMPANY">Company</option>
              </select>
            )}
          </div>

          <div className="space-y-2">
            <label htmlFor="displayName" className="text-sm font-medium">
              Display name
            </label>
            <input
              id="displayName"
              type="text"
              value={values.displayName}
              onChange={(event) =>
                setValues((previous) => ({ ...previous, displayName: event.target.value }))
              }
              required
              disabled={isPending}
              placeholder="How this customer appears across the app"
              className={inputClassName}
            />
          </div>

          {values.kind === "INDIVIDUAL" ? (
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <label htmlFor="firstName" className="text-sm font-medium">
                  First name
                </label>
                <input
                  id="firstName"
                  type="text"
                  value={values.firstName}
                  onChange={(event) =>
                    setValues((previous) => ({ ...previous, firstName: event.target.value }))
                  }
                  disabled={isPending}
                  className={inputClassName}
                />
              </div>
              <div className="space-y-2">
                <label htmlFor="lastName" className="text-sm font-medium">
                  Last name
                </label>
                <input
                  id="lastName"
                  type="text"
                  value={values.lastName}
                  onChange={(event) =>
                    setValues((previous) => ({ ...previous, lastName: event.target.value }))
                  }
                  disabled={isPending}
                  className={inputClassName}
                />
              </div>
              <div className="space-y-2">
                <label htmlFor="documentNumber" className="text-sm font-medium">
                  Document number
                </label>
                <input
                  id="documentNumber"
                  type="text"
                  value={values.documentNumber}
                  onChange={(event) =>
                    setValues((previous) => ({ ...previous, documentNumber: event.target.value }))
                  }
                  disabled={isPending}
                  className={inputClassName}
                />
              </div>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <label htmlFor="legalName" className="text-sm font-medium">
                  Legal name
                </label>
                <input
                  id="legalName"
                  type="text"
                  value={values.legalName}
                  onChange={(event) =>
                    setValues((previous) => ({ ...previous, legalName: event.target.value }))
                  }
                  required
                  disabled={isPending}
                  className={inputClassName}
                />
              </div>
              <div className="space-y-2">
                <label htmlFor="taxId" className="text-sm font-medium">
                  Tax ID
                </label>
                <input
                  id="taxId"
                  type="text"
                  value={values.taxId}
                  onChange={(event) =>
                    setValues((previous) => ({ ...previous, taxId: event.target.value }))
                  }
                  required
                  disabled={isPending}
                  className={inputClassName}
                />
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3 pt-4">
            <Button type="submit" disabled={isPending}>
              {isPending ? "Saving..." : isEdit ? "Save changes" : "Create customer"}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => router.back()}
              disabled={isPending}
            >
              Cancel
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
