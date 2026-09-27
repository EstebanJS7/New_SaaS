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
import { listCatalogItems } from "../catalog/catalog-api";
import { listSuppliers } from "../suppliers/suppliers-api";
import {
  isPurchaseNotEditableConflict,
  isPurchasePermissionDenied,
  userFacingPurchaseError,
  type Purchase,
} from "./purchases-api";

const inputClassName =
  "h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

/** One editable line in the form; every value is a string until submit. */
interface LineDraft {
  readonly key: string;
  readonly catalogItemId: string;
  readonly quantity: string;
  readonly unitCost: string;
}

function emptyLine(key: string): LineDraft {
  return { key, catalogItemId: "", quantity: "", unitCost: "" };
}

function initialLines(purchase: Purchase | undefined): LineDraft[] {
  if (purchase === undefined || purchase.lines.length === 0) {
    return [emptyLine("line-0")];
  }
  return purchase.lines.map((line) => ({
    key: line.id,
    catalogItemId: line.catalogItemId,
    quantity: line.quantity,
    unitCost: line.unitCost ?? "",
  }));
}

/**
 * Builds one submitted line. `quantity` and `unitCost` are sent as the exact
 * decimal strings the user typed; the browser never parses them into a float,
 * and an empty cost is OMITTED (DEC-013: an omitted cost means the line carries
 * none, never a zero).
 */
function buildLine(line: LineDraft): Record<string, unknown> {
  const submitted: Record<string, unknown> = {
    catalogItemId: line.catalogItemId,
    quantity: line.quantity.trim(),
  };
  const unitCost = line.unitCost.trim();
  if (unitCost.length > 0) {
    submitted.unitCost = unitCost;
  }
  return submitted;
}

/**
 * Builds the create/update body. The submitted array is the authoritative line
 * set the API reconciles by `catalogItemId`: a matched item is updated in place,
 * a new one is inserted, and an item absent from the payload is removed from the
 * draft (DEC-019). No `status` and no `tenantId` is ever sent — the lifecycle is
 * server-owned and tenant identity is resolved server-side.
 */
function buildBody(supplierId: string, lines: readonly LineDraft[]): Record<string, unknown> {
  return {
    supplierId,
    lines: lines.map(buildLine),
  };
}

interface PurchaseFormProps {
  readonly purchase?: Purchase;
  readonly onSubmit: (body: Record<string, unknown>) => void;
  readonly isPending: boolean;
  readonly error: Error | null;
}

/**
 * Shared create/edit form for purchase drafts.
 *
 * It edits the supplier reference and the FULL line set — adding a line,
 * changing a quantity or cost, and removing a line — because the update contract
 * makes the submitted array authoritative. There is deliberately NO status
 * control and no delete affordance: receiving and cancelling are the API's own
 * explicit commands, reached from the detail page, and removal here means
 * dropping a line from a draft, never deleting a purchase.
 *
 * The API remains the validation and authorization authority. The required
 * supplier, the at-least-one-line rule and the item/quantity presence checks are
 * input affordances only, and the decimal strings are sent verbatim so the
 * server's exact-decimal validation sees the user's own input.
 *
 * A `409` here is the non-`DRAFT` mutability rule — the purchase already moved
 * on — and is rendered as the API's stable, value-free conflict copy rather
 * than as a transient failure to retry blindly.
 */
export function PurchaseForm({
  purchase,
  onSubmit,
  isPending,
  error,
}: PurchaseFormProps): JSX.Element {
  const router = useRouter();
  const isEdit = purchase !== undefined;
  const initial = useMemo(() => initialLines(purchase), [purchase]);
  const [supplierId, setSupplierId] = useState(purchase?.supplierId ?? "");
  const [lines, setLines] = useState<LineDraft[]>(initial);
  const [localError, setLocalError] = useState<string | null>(null);
  const nextKeyRef = useRef(initial.length);

  const suppliersQuery = useQuery({
    queryKey: ["suppliers", "options"],
    queryFn: () => listSuppliers(),
    retry: false,
  });
  const itemsQuery = useQuery({
    queryKey: ["catalog", "options"],
    queryFn: () => listCatalogItems(),
    retry: false,
  });

  const serverError = error === null ? null : userFacingPurchaseError(error);
  const permissionError = error !== null && isPurchasePermissionDenied(error) ? serverError : null;
  const conflictError = error !== null && isPurchaseNotEditableConflict(error) ? serverError : null;

  function setLine(key: string, patch: Partial<Omit<LineDraft, "key">>): void {
    setLines((previous) =>
      previous.map((line) => (line.key === key ? { ...line, ...patch } : line))
    );
  }

  function addLine(): void {
    const key = `line-${nextKeyRef.current}`;
    nextKeyRef.current += 1;
    setLines((previous) => [...previous, emptyLine(key)]);
  }

  function removeLine(key: string): void {
    setLines((previous) =>
      previous.length > 1 ? previous.filter((line) => line.key !== key) : previous
    );
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();

    if (supplierId.trim().length === 0) {
      setLocalError("Select a supplier.");
      return;
    }
    if (lines.length === 0) {
      setLocalError("Add at least one line.");
      return;
    }
    if (lines.some((line) => line.catalogItemId.trim().length === 0)) {
      setLocalError("Select an item for every line.");
      return;
    }
    if (lines.some((line) => line.quantity.trim().length === 0)) {
      setLocalError("Enter a quantity for every line.");
      return;
    }

    setLocalError(null);
    onSubmit(buildBody(supplierId.trim(), lines));
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{isEdit ? "Edit draft purchase" : "New purchase"}</CardTitle>
        <CardDescription>
          {isEdit
            ? "Change the supplier or the line set. A line you remove is dropped from the draft."
            : "Draft a purchase with a required supplier and at least one line."}
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
        ) : permissionError !== null ? (
          <div
            role="alert"
            className="mb-4 rounded-lg border border-destructive bg-destructive/10 p-4 text-sm text-destructive"
          >
            <p className="font-medium">Permission denied</p>
            <p>{permissionError}</p>
          </div>
        ) : conflictError !== null ? (
          <div
            role="alert"
            className="mb-4 rounded-lg border border-destructive bg-destructive/10 p-4 text-sm text-destructive"
          >
            <p className="font-medium">This purchase is no longer a draft</p>
            <p>{conflictError}</p>
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
            <label htmlFor="purchase-supplier" className="text-sm font-medium">
              Supplier
            </label>
            <select
              id="purchase-supplier"
              value={supplierId}
              onChange={(event) => setSupplierId(event.target.value)}
              disabled={isPending}
              className={inputClassName}
            >
              <option value="">Select a supplier</option>
              {suppliersQuery.data?.map((supplier) => (
                <option key={supplier.id} value={supplier.id}>
                  {supplier.name}
                </option>
              ))}
            </select>
            {suppliersQuery.isLoading && (
              <p className="text-xs text-muted-foreground">Loading suppliers...</p>
            )}
            {suppliersQuery.data?.length === 0 && (
              <p className="text-xs text-muted-foreground">No suppliers are available yet.</p>
            )}
            {suppliersQuery.error && (
              <p className="text-xs text-destructive">Could not load suppliers.</p>
            )}
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Lines</span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addLine}
                disabled={isPending}
              >
                Add line
              </Button>
            </div>

            {lines.map((line, index) => (
              <div key={line.key} className="space-y-3 rounded-lg border border-input p-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-2">
                    <label htmlFor={`${line.key}-item`} className="text-sm font-medium">
                      Item {index + 1}
                    </label>
                    <select
                      id={`${line.key}-item`}
                      value={line.catalogItemId}
                      onChange={(event) => setLine(line.key, { catalogItemId: event.target.value })}
                      disabled={isPending}
                      className={inputClassName}
                    >
                      <option value="">Select an item</option>
                      {itemsQuery.data?.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-2">
                      <label htmlFor={`${line.key}-quantity`} className="text-sm font-medium">
                        Quantity
                      </label>
                      <input
                        id={`${line.key}-quantity`}
                        type="text"
                        inputMode="decimal"
                        value={line.quantity}
                        onChange={(event) => setLine(line.key, { quantity: event.target.value })}
                        disabled={isPending}
                        placeholder="e.g. 2.000"
                        className={inputClassName}
                      />
                    </div>
                    <div className="space-y-2">
                      <label htmlFor={`${line.key}-cost`} className="text-sm font-medium">
                        Unit cost
                      </label>
                      <input
                        id={`${line.key}-cost`}
                        type="text"
                        inputMode="decimal"
                        value={line.unitCost}
                        onChange={(event) => setLine(line.key, { unitCost: event.target.value })}
                        disabled={isPending}
                        placeholder="Optional"
                        className={inputClassName}
                      />
                    </div>
                  </div>
                </div>
                <div className="flex justify-end">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => removeLine(line.key)}
                    disabled={isPending || lines.length === 1}
                  >
                    Remove line
                  </Button>
                </div>
              </div>
            ))}
            {itemsQuery.isLoading && (
              <p className="text-xs text-muted-foreground">Loading catalog items...</p>
            )}
            {itemsQuery.data?.length === 0 && (
              <p className="text-xs text-muted-foreground">No catalog items are available yet.</p>
            )}
            {itemsQuery.error && <p className="text-xs text-destructive">Could not load items.</p>}
          </div>

          <p className="text-xs text-muted-foreground">
            The line set you submit is authoritative: a line you remove is dropped from the draft.
            Receiving is a separate, explicit action and is never changed by editing.
          </p>

          <div className="flex flex-wrap items-center gap-3 pt-4">
            <Button type="submit" disabled={isPending}>
              {isPending ? "Saving..." : isEdit ? "Save changes" : "Create purchase"}
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
