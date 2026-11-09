"use client";

import type { JSX } from "react";
import { useState } from "react";
import Link from "next/link";
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
  isPurchasePermissionDenied,
  listPurchases,
  PURCHASE_STATUSES,
  userFacingPurchaseError,
  type Purchase,
  type PurchaseStatus,
} from "./purchases-api";
import { PURCHASE_STATUS_LABELS, formatDate, shortId, useSupplierNames } from "./purchase-display";

const selectClassName =
  "h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

function PurchaseCard({
  purchase,
  supplierName,
}: {
  readonly purchase: Purchase;
  readonly supplierName: string;
}): JSX.Element {
  return (
    <div className="flex items-start justify-between rounded-lg border bg-card p-4 text-card-foreground shadow-sm">
      <div className="min-w-0 space-y-1">
        <div className="flex items-center gap-2">
          <Link
            href={`/app/purchases/${purchase.id}`}
            className="truncate font-medium text-primary hover:underline"
          >
            Compra #{shortId(purchase.id)}
          </Link>
          <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
            {PURCHASE_STATUS_LABELS[purchase.status]}
          </span>
        </div>
        <p className="text-sm text-muted-foreground">
          {supplierName} · {purchase.lines.length}{" "}
          {purchase.lines.length === 1 ? "línea" : "líneas"} · {formatDate(purchase.createdAt)}
        </p>
      </div>
      <div className="flex shrink-0 gap-2">
        {purchase.status === "DRAFT" && (
          <Button type="button" variant="outline" size="sm" asChild>
            <Link href={`/app/purchases/${purchase.id}/edit`}>Editar</Link>
          </Button>
        )}
      </div>
    </div>
  );
}

/**
 * Staff purchase list with the lifecycle filter and the loading, empty, error
 * and permission-denied states.
 *
 * The lifecycle filter is a presentation choice mapped onto the API's one
 * `status` key; an unfiltered list applies NO implicit default, so the caller
 * opts in to a single status rather than the surface hiding one. The server
 * remains the filter authority.
 *
 * The purchase reference opens the detail route, where every transition lives:
 * the list offers no status control and no delete affordance, and Edit is a
 * separate destination the API authorizes.
 *
 * Permission checks are UX-only; the backend enforces the real gates and
 * answers `403` when the staff role does not hold `purchases.read`.
 */
export function PurchaseList(): JSX.Element {
  const [status, setStatus] = useState<PurchaseStatus | "">("");
  const supplierNames = useSupplierNames();

  const query = useQuery({
    queryKey: ["purchases", "list", status],
    queryFn: () => listPurchases({ status: status === "" ? undefined : status }),
  });

  const emptyTitle =
    status === "" ? "Todavía no hay compras" : "Ninguna compra coincide con este filtro";
  const emptyDescription =
    status === "" ? "Empezá registrando el primer borrador de compra." : "Probá con otro estado.";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Compras</h1>
          <p className="text-sm text-muted-foreground">
            Registrá, recibí y cancelá las compras de la organización.
          </p>
        </div>
        <Button type="button" asChild>
          <Link href="/app/purchases/new">Nueva compra</Link>
        </Button>
      </div>

      <div className="space-y-2 sm:max-w-xs">
        <label htmlFor="purchase-status-filter" className="text-sm font-medium">
          Estado
        </label>
        <select
          id="purchase-status-filter"
          value={status}
          onChange={(event) => setStatus(event.target.value as PurchaseStatus | "")}
          className={selectClassName}
        >
          <option value="">Todos los estados</option>
          {PURCHASE_STATUSES.map((value) => (
            <option key={value} value={value}>
              {PURCHASE_STATUS_LABELS[value]}
            </option>
          ))}
        </select>
      </div>

      {query.isLoading ? (
        <Card>
          <CardContent className="p-6">
            <p className="text-sm text-muted-foreground">Cargando compras…</p>
          </CardContent>
        </Card>
      ) : query.error ? (
        <div
          role="alert"
          className="rounded-lg border border-destructive bg-destructive/10 p-4 text-sm text-destructive"
        >
          {isPurchasePermissionDenied(query.error) && <p className="font-medium">Sin permiso</p>}
          <p>{userFacingPurchaseError(query.error)}</p>
        </div>
      ) : query.data?.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>{emptyTitle}</CardTitle>
            <CardDescription>{emptyDescription}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button type="button" asChild>
              <Link href="/app/purchases/new">Crear borrador de compra</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {query.data?.map((purchase) => (
            <PurchaseCard
              key={purchase.id}
              purchase={purchase}
              supplierName={supplierNames.nameFor(purchase.supplierId)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
