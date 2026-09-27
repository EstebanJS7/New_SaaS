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
import { isSupplierConflict, userFacingSupplierError, type Supplier } from "./suppliers-api";

const inputClassName =
  "h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

/**
 * Client-side bounds mirroring the SUP-001 Zod contract and the column widths
 * (`name`/`legalName` 200, `taxId` 50, `email` 320, `phone` 50, `address` 500).
 * They are input affordances only — the API re-validates and stays the
 * authority.
 */
const NAME_MAX_LENGTH = 200;
const LEGAL_NAME_MAX_LENGTH = 200;
const TAX_ID_MAX_LENGTH = 50;
const EMAIL_MAX_LENGTH = 320;
const PHONE_MAX_LENGTH = 50;
const ADDRESS_MAX_LENGTH = 500;

/** The five optional identity/contact fields, in form order. */
const OPTIONAL_FIELDS = ["legalName", "taxId", "email", "phone", "address"] as const;

type OptionalField = (typeof OPTIONAL_FIELDS)[number];

/** Every field is a string in the form; "empty" maps to `null` or to "omitted". */
interface SupplierFormValues extends Record<OptionalField, string> {
  name: string;
}

function emptyValues(): SupplierFormValues {
  return { name: "", legalName: "", taxId: "", email: "", phone: "", address: "" };
}

function supplierToValues(supplier: Supplier): SupplierFormValues {
  return {
    name: supplier.name,
    legalName: supplier.legalName ?? "",
    taxId: supplier.taxId ?? "",
    email: supplier.email ?? "",
    phone: supplier.phone ?? "",
    address: supplier.address ?? "",
  };
}

/**
 * A trimmed optional field value, or `null` when the user left it empty. The API
 * stores an absent optional field as an explicit `NULL` and clears it only on an
 * explicit `null`, so an empty input must become `null` — never `""`, which the
 * API rejects with `400 VALIDATION_FAILED`.
 */
function optionalValue(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Create body: the required name plus only the optional fields the user filled in. */
function buildCreateBody(values: SupplierFormValues): Record<string, unknown> {
  const body: Record<string, unknown> = { name: values.name.trim() };
  for (const field of OPTIONAL_FIELDS) {
    const value = optionalValue(values[field]);
    if (value !== null) {
      body[field] = value;
    }
  }
  return body;
}

/**
 * Update body: only the fields whose value actually changed.
 *
 * An omitted key leaves the stored value untouched and an explicit `null` clears
 * it, so an unchanged field is left out entirely and a field the user emptied is
 * sent as `null`. `name` is never nullable, so it is only included when it
 * changed and is never sent as `null`.
 */
function buildUpdateBody(values: SupplierFormValues, supplier: Supplier): Record<string, unknown> {
  const body: Record<string, unknown> = {};

  const name = values.name.trim();
  if (name !== supplier.name) {
    body.name = name;
  }

  for (const field of OPTIONAL_FIELDS) {
    const value = optionalValue(values[field]);
    if (value !== supplier[field]) {
      body[field] = value;
    }
  }

  return body;
}

interface SupplierFormProps {
  readonly supplier?: Supplier;
  readonly onSubmit: (body: Record<string, unknown>) => void;
  readonly isPending: boolean;
  readonly error: Error | null;
}

/**
 * Shared create/edit form for suppliers.
 *
 * It carries identity and contact data only. There is deliberately NO `isActive`
 * control and no delete affordance: removal is the explicit deactivate command
 * on the list, so `suppliers.update` can never perform a lifecycle change.
 *
 * A duplicate present `taxId` is the supplier API's only `409`, so that refusal
 * is presented as a conflict on the identifier field rather than as a generic
 * failure — and it renders the API's own stable, value-free copy, because the
 * submitted identifier is CONFIDENTIAL and is never echoed back or logged.
 *
 * The API remains the validation and authorization authority; the client-side
 * bounds and the required-name check are input affordances only.
 */
export function SupplierForm({
  supplier,
  onSubmit,
  isPending,
  error,
}: SupplierFormProps): JSX.Element {
  const router = useRouter();
  const isEdit = supplier !== undefined;
  const initialValues = useMemo(
    () => (supplier ? supplierToValues(supplier) : emptyValues()),
    [supplier]
  );
  const [values, setValues] = useState<SupplierFormValues>(initialValues);
  const [localError, setLocalError] = useState<string | null>(null);

  const serverError = error === null ? null : userFacingSupplierError(error);
  const conflictError = error !== null && isSupplierConflict(error) ? serverError : null;

  function setField(field: keyof SupplierFormValues, value: string): void {
    setValues((previous) => ({ ...previous, [field]: value }));
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();

    if (!values.name.trim()) {
      setLocalError("Name is required.");
      return;
    }

    setLocalError(null);
    const body = isEdit && supplier ? buildUpdateBody(values, supplier) : buildCreateBody(values);
    onSubmit(body);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{isEdit ? "Edit supplier" : "New supplier"}</CardTitle>
        <CardDescription>
          {isEdit
            ? "Update the supplier's identity and contact data."
            : "Register a supplier with a required trading name."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {localError !== null ? (
          <div
            role="alert"
            className="mb-4 rounded-lg border border-destructive bg-destructive/10 p-4 text-sm text-destructive"
          >
            {localError}
          </div>
        ) : conflictError !== null ? (
          <div
            role="alert"
            className="mb-4 rounded-lg border border-destructive bg-destructive/10 p-4 text-sm text-destructive"
          >
            <p className="font-medium">Tax identifier conflict</p>
            <p id="supplier-tax-id-conflict">{conflictError}</p>
          </div>
        ) : serverError !== null ? (
          <div
            role="alert"
            className="mb-4 rounded-lg border border-destructive bg-destructive/10 p-4 text-sm text-destructive"
          >
            {serverError}
          </div>
        ) : null}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="name" className="text-sm font-medium">
              Name
            </label>
            <input
              id="name"
              type="text"
              value={values.name}
              onChange={(event) => setField("name", event.target.value)}
              required
              maxLength={NAME_MAX_LENGTH}
              disabled={isPending}
              placeholder="How this supplier appears across the app"
              className={inputClassName}
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="legalName" className="text-sm font-medium">
              Legal name
            </label>
            <input
              id="legalName"
              type="text"
              value={values.legalName}
              onChange={(event) => setField("legalName", event.target.value)}
              maxLength={LEGAL_NAME_MAX_LENGTH}
              disabled={isPending}
              placeholder="Optional registered name"
              className={inputClassName}
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="taxId" className="text-sm font-medium">
              Tax identifier
            </label>
            <input
              id="taxId"
              type="text"
              value={values.taxId}
              onChange={(event) => setField("taxId", event.target.value)}
              maxLength={TAX_ID_MAX_LENGTH}
              disabled={isPending}
              placeholder="Optional, unique per tenant when present"
              className={inputClassName}
              aria-invalid={conflictError !== null ? true : undefined}
              aria-describedby={conflictError !== null ? "supplier-tax-id-conflict" : undefined}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <label htmlFor="email" className="text-sm font-medium">
                Email
              </label>
              <input
                id="email"
                type="text"
                value={values.email}
                onChange={(event) => setField("email", event.target.value)}
                maxLength={EMAIL_MAX_LENGTH}
                disabled={isPending}
                placeholder="Optional contact email"
                className={inputClassName}
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="phone" className="text-sm font-medium">
                Phone
              </label>
              <input
                id="phone"
                type="text"
                value={values.phone}
                onChange={(event) => setField("phone", event.target.value)}
                maxLength={PHONE_MAX_LENGTH}
                disabled={isPending}
                placeholder="Optional contact phone"
                className={inputClassName}
              />
            </div>
          </div>

          <div className="space-y-2">
            <label htmlFor="address" className="text-sm font-medium">
              Address
            </label>
            <input
              id="address"
              type="text"
              value={values.address}
              onChange={(event) => setField("address", event.target.value)}
              maxLength={ADDRESS_MAX_LENGTH}
              disabled={isPending}
              placeholder="Optional address"
              className={inputClassName}
            />
          </div>

          <p className="text-xs text-muted-foreground">
            Removal is a deactivation, never a delete: this form changes identity and contact data
            only.
          </p>

          <div className="flex flex-wrap items-center gap-3 pt-4">
            <Button type="submit" disabled={isPending}>
              {isPending ? "Saving..." : isEdit ? "Save changes" : "Create supplier"}
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
