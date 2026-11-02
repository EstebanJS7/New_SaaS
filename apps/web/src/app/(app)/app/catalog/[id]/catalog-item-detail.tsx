"use client";

import type { JSX } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ErrorState } from "@/components/feedback";
import { formatStaffMoney, formatEsPyDecimal } from "@/lib/es-py-format";
import { Button } from "@newsaas/ui/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@newsaas/ui/components/ui/card";
import {
  ApiRequestError,
  getCatalogItem,
  userFacingCatalogError,
  type CatalogItem,
  type CatalogItemKind,
} from "../catalog-api";

const KIND_LABELS: Record<CatalogItemKind, string> = {
  PRODUCT: "Producto",
  SERVICE: "Servicio",
  MEDICATION: "Medicamento",
  SUPPLY: "Insumo",
};

/** 403 FORBIDDEN is the permission gate; other 403s (entitlement) keep their own copy. */
function isPermissionDenied(error: Error): boolean {
  return error instanceof ApiRequestError && error.code === "FORBIDDEN";
}

/**
 * The reference price travels as the API's exact two-decimal text; the browser
 * uses exact es-PY display without sums, rounding or currency conversion.
 */
function referencePriceLabel(item: CatalogItem): string {
  if (item.referencePriceAmount === null || item.referencePriceCurrency === null) {
    return "Sin precio informado";
  }
  return formatStaffMoney(item.referencePriceAmount, item.referencePriceCurrency);
}

function DetailRow({
  label,
  value,
}: {
  readonly label: string;
  readonly value: string;
}): JSX.Element {
  return (
    <div className="flex flex-col gap-1 border-b sm:flex-row sm:items-start sm:justify-between sm:gap-4 border-border pb-3 last:border-b-0 last:pb-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="break-words font-medium text-foreground sm:text-right">{value}</span>
    </div>
  );
}

/**
 * Read-only staff detail for one catalog item.
 *
 * It exists so a role that holds only `catalog.read` can inspect an item without
 * being dropped into a form it cannot submit. This surface mutates nothing and
 * offers no deactivate command; Edit is a separate destination whose write the
 * API, never a client-side permission guess, decides to allow or refuse.
 *
 * Permission checks are UX-only; the backend enforces every gate and answers
 * `403` when the staff role does not hold `catalog.read`.
 */
export function CatalogItemDetail(): JSX.Element {
  const params = useParams<{ id: string }>();
  const itemId = params.id;

  const query = useQuery({
    queryKey: ["catalog", "item", itemId],
    queryFn: () => getCatalogItem(itemId),
    retry: false,
  });

  if (query.isLoading) {
    return <p className="text-sm text-muted-foreground">Cargando artículo…</p>;
  }

  if (query.error) {
    return (
      <ErrorState
        title={isPermissionDenied(query.error) ? "Acceso denegado" : undefined}
        message={userFacingCatalogError(query.error)}
        onRetry={() => void query.refetch()}
      />
    );
  }

  const item = query.data;
  if (!item) {
    return (
      <p className="text-sm text-muted-foreground">No encontramos el artículo del catálogo.</p>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <h1 className="break-words text-2xl font-semibold tracking-tight">{item.name}</h1>
              <p className="text-sm text-muted-foreground">
                {KIND_LABELS[item.kind]} · {item.taxRate.name}
              </p>
            </div>
            <div className="flex shrink-0 gap-2">
              <Button type="button" variant="outline" asChild>
                <Link href={`/app/catalog/${item.id}/edit`}>Editar artículo</Link>
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Datos del artículo</CardTitle>
          <CardDescription>
            Vista de lectura. Los impuestos son globales; cada artículo selecciona uno.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <DetailRow label="Tipo" value={KIND_LABELS[item.kind]} />
          <DetailRow label="Impuesto" value={item.taxRate.name} />
          <DetailRow label="Precio de referencia" value={referencePriceLabel(item)} />
          <DetailRow
            label="Umbral de stock bajo"
            value={
              item.lowStockThreshold === null || item.lowStockThreshold === undefined
                ? "Sin umbral informado"
                : formatEsPyDecimal(item.lowStockThreshold)
            }
          />
          <DetailRow label="Estado" value={item.isActive ? "Activo" : "Inactivo"} />
        </CardContent>
      </Card>
    </div>
  );
}
