"use client";

import type { JSX } from "react";
import { useMemo, useRef, useState } from "react";
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
  catalogWriteBlocked,
  userFacingCatalogError,
  type CatalogItem,
  type CatalogItemKind,
  type CatalogReferencePriceCurrency,
} from "./catalog-api";
import { ErrorState } from "@/components/feedback";
import { useCatalogExit } from "./catalog-form-interaction";
import { formatEsPyDecimalInput, normalizeEsPyDecimalInput } from "@/lib/es-py-format";
import { sortTaxRatesForDisplay } from "./tax-rate-order";

const inputClassName =
  "h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

const selectClassName =
  "h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

const KIND_LABELS: Record<CatalogItemKind, string> = {
  PRODUCT: "Producto",
  SERVICE: "Servicio",
  MEDICATION: "Medicamento",
  SUPPLY: "Insumo",
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
    referencePriceAmount:
      item.referencePriceAmount === null ? "" : formatEsPyDecimalInput(item.referencePriceAmount),
    referencePriceCurrency:
      (item.referencePriceCurrency as CatalogReferencePriceCurrency | null) ?? "PYG",
    lowStockThreshold:
      item.lowStockThreshold === null || item.lowStockThreshold === undefined
        ? ""
        : formatEsPyDecimalInput(item.lowStockThreshold),
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
  readonly onSubmit: (body: Record<string, unknown>) => Promise<unknown> | void;
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
  const [errors, setErrors] = useState<Record<string, string>>({});
  const sending = useRef(false);
  const exit = useCatalogExit(JSON.stringify(values) !== JSON.stringify(initialValues));
  const blocked = catalogWriteBlocked(error);
  const rates = useQuery({
    queryKey: ["catalog", "tax-rates"],
    queryFn: listTaxRates,
    retry: false,
  });
  const unavailable = rates.isPending || rates.isError || !rates.data?.length;
  async function handleSubmit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (sending.current || isPending || blocked || unavailable) return;
    const form = event.currentTarget;
    const next: Record<string, string> = {};
    const name = values.name.trim();
    if (!name) next.name = "Ingresá el nombre.";
    else if (name.length > 200) next.name = "Usá hasta 200 caracteres.";
    if (!values.taxRateId) next.taxRateId = "Seleccioná un impuesto.";
    const amount = values.referencePriceAmount.trim()
      ? normalizeEsPyDecimalInput(values.referencePriceAmount)
      : "";
    if (amount === null || (amount && !AMOUNT_PATTERN.test(amount)))
      next.referencePriceAmount =
        "Ingresá un importe no negativo: hasta 12 dígitos enteros y 2 decimales, con coma decimal.";
    const threshold = values.lowStockThreshold.trim()
      ? normalizeEsPyDecimalInput(values.lowStockThreshold)
      : "";
    if (
      threshold === null ||
      (threshold && (!THRESHOLD_PATTERN.test(threshold) || !/[1-9]/.test(threshold)))
    )
      next.lowStockThreshold =
        "Ingresá un umbral mayor que cero: hasta 7 dígitos enteros y 3 decimales, con coma decimal.";
    setErrors(next);
    if (Object.keys(next).length) {
      requestAnimationFrame(() => form.querySelector<HTMLElement>("[aria-invalid=true]")?.focus());
      return;
    }
    // Normalization is a presentation boundary only; the wire stays exact decimal text.
    const normalized = {
      ...values,
      referencePriceAmount: amount ?? "",
      lowStockThreshold: threshold ?? "",
    };
    const body = isEdit && item ? buildUpdateBody(normalized, item) : buildCreateBody(normalized);
    sending.current = true;
    try {
      await onSubmit(body);
    } catch {
      /* Mutation owner renders the safe error; values stay in memory. */
    } finally {
      sending.current = false;
    }
  }

  return (
    <Card lang="es-PY">
      <CardHeader>
        <CardTitle>
          <h1>{isEdit ? "Editar artículo" : "Nuevo artículo"}</h1>
        </CardTitle>
        <CardDescription>
          {isEdit
            ? "Actualizá el artículo conservando su impuesto obligatorio."
            : "Registrá un artículo con el impuesto que le corresponde."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {rates.isPending && <p role="status">Cargando impuestos…</p>}
        {rates.error && (
          <ErrorState
            message={userFacingCatalogError(rates.error)}
            onRetry={() => void rates.refetch()}
          />
        )}
        {rates.isSuccess && !rates.data.length && (
          <p role="status">
            No hay impuestos disponibles. Solicitá la revisión del catálogo antes de guardar.
          </p>
        )}
        {error && (
          <div
            role="alert"
            className="mb-4 rounded-lg border border-destructive bg-destructive/10 p-4 text-sm text-destructive"
          >
            {userFacingCatalogError(error)}
          </div>
        )}

        <form
          noValidate
          onSubmit={(event) => void handleSubmit(event)}
          onChange={() => setErrors({})}
          className="space-y-4"
        >
          <div className="space-y-2">
            <label htmlFor="name" className="text-sm font-medium">
              Nombre (obligatorio)
            </label>
            <input
              id="name"
              aria-invalid={Boolean(errors.name)}
              aria-describedby="name-hint"
              type="text"
              value={values.name}
              onChange={(event) =>
                setValues((previous) => ({ ...previous, name: event.target.value }))
              }
              required
              disabled={isPending}
              placeholder="Nombre del artículo"
              className={inputClassName}
            />
            <p
              id="name-hint"
              role={errors.name ? "alert" : undefined}
              className={errors.name ? "text-xs text-destructive" : "text-xs text-muted-foreground"}
            >
              {errors.name ?? "Hasta 200 caracteres."}
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <label htmlFor="kind" className="text-sm font-medium">
                Tipo de artículo
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
                Impuesto (obligatorio)
              </label>
              <select
                id="taxRateId"
                aria-invalid={Boolean(errors.taxRateId)}
                aria-describedby="taxRateId-hint"
                value={values.taxRateId}
                onChange={(event) =>
                  setValues((previous) => ({ ...previous, taxRateId: event.target.value }))
                }
                required
                disabled={isPending || unavailable}
                className={selectClassName}
              >
                <option value="">Seleccioná un impuesto</option>
                {sortTaxRatesForDisplay(rates.data ?? []).map((rate) => (
                  <option key={rate.id} value={rate.id}>
                    {rate.name}
                  </option>
                ))}
              </select>
              <p
                id="taxRateId-hint"
                role={errors.taxRateId ? "alert" : undefined}
                className={
                  errors.taxRateId ? "text-xs text-destructive" : "text-xs text-muted-foreground"
                }
              >
                {errors.taxRateId ?? "Seleccioná un impuesto de la lista disponible."}
              </p>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <label htmlFor="referencePriceAmount" className="text-sm font-medium">
                Precio de referencia (opcional)
              </label>
              <input
                id="referencePriceAmount"
                aria-invalid={Boolean(errors.referencePriceAmount)}
                aria-describedby="referencePriceAmount-hint"
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
                placeholder="Ej.: 120.000,50"
                className={inputClassName}
              />
              <p
                id="referencePriceAmount-hint"
                role={errors.referencePriceAmount ? "alert" : undefined}
                className={
                  errors.referencePriceAmount
                    ? "text-xs text-destructive"
                    : "text-xs text-muted-foreground"
                }
              >
                {errors.referencePriceAmount ??
                  "Usá coma decimal y, si querés, puntos de miles. Hasta 2 decimales. Vaciar al editar quita importe y moneda."}
              </p>
            </div>

            <div className="space-y-2">
              <label htmlFor="referencePriceCurrency" className="text-sm font-medium">
                Moneda
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
            El precio de referencia es informativo y conserva el importe y la moneda exactos. No
            representa un total de venta, factura o documento fiscal.
          </p>

          <div className="space-y-2">
            <label htmlFor="lowStockThreshold" className="text-sm font-medium">
              Umbral de stock bajo (opcional)
            </label>
            <input
              id="lowStockThreshold"
              aria-invalid={Boolean(errors.lowStockThreshold)}
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
              placeholder="Ej.: 10,500; vacío para no hacer seguimiento"
              aria-describedby="lowStockThreshold-hint"
              className={inputClassName}
            />
            <p
              id="lowStockThreshold-hint"
              role={errors.lowStockThreshold ? "alert" : undefined}
              className={
                errors.lowStockThreshold
                  ? "text-xs text-destructive"
                  : "text-xs text-muted-foreground"
              }
            >
              {errors.lowStockThreshold ??
                "Cantidad opcional, hasta 3 decimales. El reporte de stock bajo compara el saldo con este umbral. Vacío significa sin seguimiento; vaciarlo al editar quita el umbral. Esto no modifica existencias. Usá coma decimal y, opcionalmente, puntos de miles."}
            </p>
          </div>

          <p className="text-xs text-muted-foreground">
            Los cambios sin guardar se mantienen solo en esta pantalla. Recargar o salir los
            descarta.
          </p>
          <div className="flex flex-wrap items-center gap-3 pt-4">
            <Button type="submit" disabled={isPending || blocked || unavailable}>
              {isPending ? "Guardando…" : isEdit ? "Guardar cambios" : "Crear artículo"}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() =>
                exit.leave(() => router.push(isEdit ? `/app/catalog/${item.id}` : "/app/catalog"))
              }
              disabled={isPending}
            >
              Cancelar
            </Button>
          </div>
        </form>
        {exit.dialog}
      </CardContent>
    </Card>
  );
}
