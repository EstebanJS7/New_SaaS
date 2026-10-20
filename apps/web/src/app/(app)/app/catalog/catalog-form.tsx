"use client";

import type { JSX } from "react";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
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
  CATALOG_ITEM_KINDS,
  CATALOG_REFERENCE_PRICE_CURRENCIES,
  listTaxRates,
  userFacingCatalogError,
  type CatalogItem,
  type CatalogItemKind,
  type CatalogReferencePriceCurrency,
} from "./catalog-api";
import { sortTaxRatesForDisplay } from "./tax-rate-order";

const inputClassName =
  "h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

const selectClassName =
  "h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

const KIND_LABELS: Record<CatalogItemKind, string> = {
  PRODUCT: "Product",
  SERVICE: "Service",
  MEDICATION: "Medication",
  SUPPLY: "Supply",
};

/**
 * Mirrors the API's `Decimal(14, 2)` amount shape: up to 12 integer digits and
 * 2 decimals. Client-side convenience only — the server re-validates and stays
 * the authority.
 */
const AMOUNT_PATTERN = /^\d{1,12}(\.\d{1,2})?$/;

/**
 * Mirrors the API's `Decimal(10, 3)` low-stock threshold shape: up to 7 integer
 * digits and 3 decimals — the stock ledger's quantity scale. Zero and negatives
 * are rejected by the value check below, exactly like the server. Client-side
 * convenience only; the server re-validates and stays the authority.
 */
const THRESHOLD_PATTERN = /^\d{1,7}(\.\d{1,3})?$/;

interface CatalogFormValues {
  name: string;
  kind: CatalogItemKind;
  taxRateId: string;
  referencePriceAmount: string;
  referencePriceCurrency: CatalogReferencePriceCurrency;
  lowStockThreshold: string;
}

function emptyValues(): CatalogFormValues {
  return {
    name: "",
    kind: "PRODUCT",
    taxRateId: "",
    referencePriceAmount: "",
    referencePriceCurrency: "PYG",
    // Empty means "not monitored": the API stores NULL, never a zero.
    lowStockThreshold: "",
  };
}

function itemToValues(item: CatalogItem): CatalogFormValues {
  return {
    name: item.name,
    kind: item.kind,
    taxRateId: item.taxRateId,
    referencePriceAmount: item.referencePriceAmount ?? "",
    referencePriceCurrency:
      (item.referencePriceCurrency as CatalogReferencePriceCurrency | null) ?? "PYG",
    lowStockThreshold: item.lowStockThreshold ?? "",
  };
}

function buildCreateBody(values: CatalogFormValues): Record<string, unknown> {
  const body: Record<string, unknown> = {
    name: values.name.trim(),
    kind: values.kind,
    taxRateId: values.taxRateId,
  };

  const amount = values.referencePriceAmount.trim();
  if (amount) {
    body.referencePriceAmount = amount;
    body.referencePriceCurrency = values.referencePriceCurrency;
  }

  // The threshold is opt-in and independent of the price pair: an empty field
  // sends nothing, which the API stores as NULL ("not monitored").
  const threshold = values.lowStockThreshold.trim();
  if (threshold) {
    body.lowStockThreshold = threshold;
  }

  return body;
}

function buildUpdateBody(values: CatalogFormValues, item: CatalogItem): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  const name = values.name.trim();

  if (name !== item.name) body.name = name;
  if (values.kind !== item.kind) body.kind = values.kind;
  if (values.taxRateId !== item.taxRateId) body.taxRateId = values.taxRateId;

  const amount = values.referencePriceAmount.trim();
  const currentAmount = item.referencePriceAmount ?? "";
  const currentCurrency =
    (item.referencePriceCurrency as CatalogReferencePriceCurrency | null) ?? "PYG";

  if (amount === "") {
    // Absent leaves the pair untouched; an existing price is cleared as one pair.
    if (currentAmount !== "") {
      body.referencePriceAmount = null;
      body.referencePriceCurrency = null;
    }
  } else if (amount !== currentAmount || values.referencePriceCurrency !== currentCurrency) {
    body.referencePriceAmount = amount;
    body.referencePriceCurrency = values.referencePriceCurrency;
  }

  // Threshold: absent leaves the stored value untouched, an emptied field CLEARS
  // it with an explicit null ("stop monitoring"), and a changed value replaces it.
  const threshold = values.lowStockThreshold.trim();
  const currentThreshold = item.lowStockThreshold ?? "";
  if (threshold === "") {
    if (currentThreshold !== "") body.lowStockThreshold = null;
  } else if (threshold !== currentThreshold) {
    body.lowStockThreshold = threshold;
  }

  return body;
}

interface CatalogFormProps {
  readonly item?: CatalogItem;
  readonly onSubmit: (body: Record<string, unknown>) => void;
  readonly isPending: boolean;
  readonly error: Error | null;
}

/**
 * Shared create/edit form for catalog items.
 *
 * The seeded tax rate is REQUIRED and is selected from the GLOBAL read-only
 * rate list, presented in human order (`EXEMPT`, `IVA_5`, `IVA_10`) by
 * `sortTaxRatesForDisplay`; the form cannot be submitted without one because no
 * rate-less item state is valid. The reference price is optional and is enforced client-side
 * as one amount/currency pair (PYG by default) for convenience, while the API
 * remains the validation and authorization authority.
 */
export function CatalogForm({ item, onSubmit, isPending, error }: CatalogFormProps): JSX.Element {
  const router = useRouter();
  const isEdit = item !== undefined;
  const initialValues = useMemo(() => (item ? itemToValues(item) : emptyValues()), [item]);
  const [values, setValues] = useState<CatalogFormValues>(initialValues);
  const [localError, setLocalError] = useState<string | null>(null);

  const rates = useQuery({ queryKey: ["catalog", "tax-rates"], queryFn: listTaxRates });

  function handleSubmit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();

    const name = values.name.trim();
    if (!name) {
      setLocalError("Name is required.");
      return;
    }
    if (!values.taxRateId) {
      setLocalError("Select a tax rate.");
      return;
    }
    const amount = values.referencePriceAmount.trim();
    if (amount && !AMOUNT_PATTERN.test(amount)) {
      setLocalError("Reference price must be a non-negative decimal with at most 2 decimals.");
      return;
    }
    const threshold = values.lowStockThreshold.trim();
    if (threshold && (!THRESHOLD_PATTERN.test(threshold) || !(Number(threshold) > 0))) {
      setLocalError("Low-stock threshold must be greater than zero with at most 3 decimals.");
      return;
    }

    setLocalError(null);
    const body = isEdit && item ? buildUpdateBody(values, item) : buildCreateBody(values);
    onSubmit(body);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{isEdit ? "Edit catalog item" : "New catalog item"}</CardTitle>
        <CardDescription>
          {isEdit
            ? "Update the item. The tax rate is required and stays selected."
            : "Create a catalog item with one required tax rate."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {(localError ?? error) && (
          <div
            role="alert"
            className="mb-4 rounded-lg border border-destructive bg-destructive/10 p-4 text-sm text-destructive"
          >
            {localError ?? (error ? userFacingCatalogError(error) : null)}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="name" className="text-sm font-medium">
              Name
            </label>
            <input
              id="name"
              type="text"
              value={values.name}
              onChange={(event) =>
                setValues((previous) => ({ ...previous, name: event.target.value }))
              }
              required
              maxLength={200}
              disabled={isPending}
              placeholder="How this item appears across the app"
              className={inputClassName}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <label htmlFor="kind" className="text-sm font-medium">
                Kind
              </label>
              <select
                id="kind"
                value={values.kind}
                onChange={(event) =>
                  setValues((previous) => ({
                    ...previous,
                    kind: event.target.value as CatalogItemKind,
                  }))
                }
                disabled={isPending}
                className={selectClassName}
              >
                {CATALOG_ITEM_KINDS.map((itemKind) => (
                  <option key={itemKind} value={itemKind}>
                    {KIND_LABELS[itemKind]}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <label htmlFor="taxRateId" className="text-sm font-medium">
                Tax rate
              </label>
              <select
                id="taxRateId"
                value={values.taxRateId}
                onChange={(event) =>
                  setValues((previous) => ({ ...previous, taxRateId: event.target.value }))
                }
                required
                disabled={isPending || rates.isLoading}
                className={selectClassName}
              >
                <option value="">Select tax rate</option>
                {sortTaxRatesForDisplay(rates.data ?? []).map((rate) => (
                  <option key={rate.id} value={rate.id}>
                    {rate.name}
                  </option>
                ))}
              </select>
              {rates.error && (
                <p role="alert" className="text-xs text-destructive">
                  {rates.error.message}
                </p>
              )}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <label htmlFor="referencePriceAmount" className="text-sm font-medium">
                Reference price
              </label>
              <input
                id="referencePriceAmount"
                type="text"
                inputMode="decimal"
                value={values.referencePriceAmount}
                onChange={(event) =>
                  setValues((previous) => ({
                    ...previous,
                    referencePriceAmount: event.target.value,
                  }))
                }
                disabled={isPending}
                placeholder="Optional amount"
                className={inputClassName}
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="referencePriceCurrency" className="text-sm font-medium">
                Currency
              </label>
              <select
                id="referencePriceCurrency"
                value={values.referencePriceCurrency}
                onChange={(event) =>
                  setValues((previous) => ({
                    ...previous,
                    referencePriceCurrency: event.target.value as CatalogReferencePriceCurrency,
                  }))
                }
                disabled={isPending}
                className={selectClassName}
              >
                {CATALOG_REFERENCE_PRICE_CURRENCIES.map((currency) => (
                  <option key={currency} value={currency}>
                    {currency}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            The reference price is informational. It is stored as an exact amount and currency; it
            is never a sale, invoice or fiscal total.
          </p>

          <div className="space-y-2">
            <label htmlFor="lowStockThreshold" className="text-sm font-medium">
              Low-stock threshold
            </label>
            <input
              id="lowStockThreshold"
              type="text"
              inputMode="decimal"
              value={values.lowStockThreshold}
              onChange={(event) =>
                setValues((previous) => ({
                  ...previous,
                  lowStockThreshold: event.target.value,
                }))
              }
              disabled={isPending}
              placeholder="Leave empty if this item is not monitored"
              aria-describedby="lowStockThreshold-hint"
              className={inputClassName}
            />
            <p id="lowStockThreshold-hint" className="text-xs text-muted-foreground">
              Optional quantity, at most 3 decimals. When the stock balance falls to or below it the
              item is reported as low stock. Leave it empty and the item is not monitored, so it
              never appears in that report.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3 pt-4">
            <Button type="submit" disabled={isPending}>
              {isPending ? "Saving..." : isEdit ? "Save changes" : "Create item"}
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
