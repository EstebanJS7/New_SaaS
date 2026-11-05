"use client";

import type { JSX } from "react";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@newsaas/ui/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@newsaas/ui/components/ui/card";
import { useWorkingBranches } from "@/lib/working-branches";
import {
  createStockTransfer,
  listStockBalances,
  listStockBranches,
  userFacingInventoryError,
  type StockBalance,
} from "./inventory-api";

const inputClassName =
  "h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

const ALL_BRANCHES = "";

/**
 * MB-003 (DEC-094 §10): stock per branch and transfers between branches.
 *
 * The list shows one row per (item, branch) and defaults to «Todas», so the
 * numbers do not change for someone who did not ask for a branch (§5). The
 * transfer form offers as origin only the branches the person works at, and
 * as destination every other active branch; the API re-checks both, refuses
 * an origin that would go below zero, and requires `inventory.stock.transfer`.
 */
export function StockSurface(): JSX.Element {
  const [branchFilter, setBranchFilter] = useState(ALL_BRANCHES);
  const branchesQuery = useQuery({
    queryKey: ["inventory", "branches"],
    queryFn: listStockBranches,
    retry: false,
  });
  const balancesQuery = useQuery({
    queryKey: ["inventory", "balances", branchFilter],
    queryFn: () => listStockBalances(branchFilter === ALL_BRANCHES ? null : branchFilter),
    retry: false,
  });

  const branches = branchesQuery.data ?? [];
  const rows = useMemo(
    () =>
      [...(balancesQuery.data ?? [])].sort(
        (left, right) =>
          left.item.name.localeCompare(right.item.name, "es") ||
          (left.branchName ?? "").localeCompare(right.branchName ?? "", "es")
      ),
    [balancesQuery.data]
  );

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Stock por sucursal</CardTitle>
          <CardDescription>
            Cada sucursal tiene su propio stock. Las ventas descuentan de la sucursal de la venta y
            las compras ingresan en la sucursal que las recibe.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="max-w-xs space-y-2">
            <label htmlFor="stock-branch-filter" className="text-sm font-medium">
              Sucursal
            </label>
            <select
              id="stock-branch-filter"
              value={branchFilter}
              onChange={(event) => setBranchFilter(event.target.value)}
              className={inputClassName}
            >
              <option value={ALL_BRANCHES}>Todas</option>
              {branches.map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {branch.name}
                </option>
              ))}
            </select>
          </div>

          {balancesQuery.isLoading ? (
            <p className="text-sm text-muted-foreground">Cargando stock…</p>
          ) : balancesQuery.error ? (
            <div
              role="alert"
              className="rounded-lg border border-destructive bg-destructive/10 p-4 text-sm text-destructive"
            >
              {userFacingInventoryError(balancesQuery.error)}
            </div>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">Todavía no hay stock registrado.</p>
          ) : (
            <BalanceTable rows={rows} />
          )}
        </CardContent>
      </Card>

      <TransferForm balances={balancesQuery.data ?? []} branches={branches} />
    </div>
  );
}

function BalanceTable({ rows }: { readonly rows: readonly StockBalance[] }): JSX.Element {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-muted-foreground">
            <th className="py-2 pr-4 font-medium">Ítem</th>
            <th className="py-2 pr-4 font-medium">Sucursal</th>
            <th className="py-2 text-right font-medium">Cantidad</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-b last:border-0">
              <td className="py-2 pr-4">{row.item.name}</td>
              <td className="py-2 pr-4">{row.branchName ?? "—"}</td>
              <td className="py-2 text-right tabular-nums">{row.quantity}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TransferForm({
  balances,
  branches,
}: {
  readonly balances: readonly StockBalance[];
  readonly branches: readonly { id: string; name: string }[];
}): JSX.Element | null {
  const queryClient = useQueryClient();
  const working = useWorkingBranches();
  const [fromBranchId, setFromBranchId] = useState("");
  const [toBranchId, setToBranchId] = useState("");
  const [catalogItemId, setCatalogItemId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [reason, setReason] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const mutation = useMutation({
    mutationFn: createStockTransfer,
    onSuccess: () => {
      setDone(true);
      setQuantity("");
      setReason("");
      void queryClient.invalidateQueries({ queryKey: ["inventory", "balances"] });
    },
  });

  // Items that have stock at the chosen origin (deduplicated, by name).
  const items = useMemo(() => {
    const byId = new Map<string, string>();
    for (const row of balances) {
      if (fromBranchId !== "" && row.branchId !== fromBranchId) continue;
      if (Number(row.quantity) <= 0) continue;
      byId.set(row.catalogItemId, row.item.name);
    }
    return [...byId.entries()].sort((left, right) => left[1].localeCompare(right[1], "es"));
  }, [balances, fromBranchId]);

  // Transfers need two active branches; with one there is nothing to offer.
  if (branches.length < 2) return null;

  function handleSubmit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    setDone(false);
    if (fromBranchId === "" || toBranchId === "") {
      setLocalError("Elegí la sucursal de origen y la de destino.");
      return;
    }
    if (fromBranchId === toBranchId) {
      setLocalError("El origen y el destino deben ser sucursales distintas.");
      return;
    }
    if (catalogItemId === "" || quantity.trim() === "" || reason.trim() === "") {
      setLocalError("Completá el ítem, la cantidad y el motivo.");
      return;
    }
    setLocalError(null);
    mutation.mutate({
      catalogItemId,
      fromBranchId,
      toBranchId,
      quantity: quantity.trim(),
      reason: reason.trim(),
    });
  }

  const error = localError ?? (mutation.error ? userFacingInventoryError(mutation.error) : null);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Transferir entre sucursales</CardTitle>
        <CardDescription>
          Registra una salida en el origen y una entrada en el destino. El origen no puede quedar
          con stock negativo.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {error !== null && (
          <div
            role="alert"
            className="mb-4 rounded-lg border border-destructive bg-destructive/10 p-4 text-sm text-destructive"
          >
            {error}
          </div>
        )}
        {done && error === null && (
          <div role="status" className="mb-4 rounded-lg border p-4 text-sm">
            Transferencia registrada.
          </div>
        )}
        <form onSubmit={handleSubmit} className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <label htmlFor="transfer-from" className="text-sm font-medium">
              Desde
            </label>
            <select
              id="transfer-from"
              value={fromBranchId}
              onChange={(event) => {
                setFromBranchId(event.target.value);
                setCatalogItemId("");
              }}
              disabled={mutation.isPending}
              className={inputClassName}
            >
              <option value="">Elegí el origen</option>
              {working.branches.map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {branch.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <label htmlFor="transfer-to" className="text-sm font-medium">
              Hacia
            </label>
            <select
              id="transfer-to"
              value={toBranchId}
              onChange={(event) => setToBranchId(event.target.value)}
              disabled={mutation.isPending}
              className={inputClassName}
            >
              <option value="">Elegí el destino</option>
              {branches
                .filter((branch) => branch.id !== fromBranchId)
                .map((branch) => (
                  <option key={branch.id} value={branch.id}>
                    {branch.name}
                  </option>
                ))}
            </select>
          </div>
          <div className="space-y-2">
            <label htmlFor="transfer-item" className="text-sm font-medium">
              Ítem
            </label>
            <select
              id="transfer-item"
              value={catalogItemId}
              onChange={(event) => setCatalogItemId(event.target.value)}
              disabled={mutation.isPending}
              className={inputClassName}
            >
              <option value="">Elegí el ítem</option>
              {items.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <label htmlFor="transfer-quantity" className="text-sm font-medium">
              Cantidad
            </label>
            <input
              id="transfer-quantity"
              inputMode="decimal"
              value={quantity}
              onChange={(event) => setQuantity(event.target.value)}
              disabled={mutation.isPending}
              className={inputClassName}
            />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <label htmlFor="transfer-reason" className="text-sm font-medium">
              Motivo
            </label>
            <input
              id="transfer-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              disabled={mutation.isPending}
              maxLength={200}
              className={inputClassName}
            />
          </div>
          <div className="sm:col-span-2">
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? "Transfiriendo…" : "Transferir"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
