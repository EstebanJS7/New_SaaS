"use client";

import type { JSX } from "react";
import { Button } from "@newsaas/ui/components/ui/button";
import type { CartLine } from "./counter-cart";
import { formatWireAmount } from "./sales-api";

const inputClassName =
  "h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

interface LineEditorProps {
  readonly line: CartLine;
  readonly disabled: boolean;
  readonly onChange: (key: string, patch: Partial<Omit<CartLine, "key">>) => void;
  readonly onRemove: (key: string) => void;
}

/**
 * The cart line editor (EPIC-12 POS-004, DEC-022).
 *
 * It pre-fills the catalog reference price when the item has one and accepts the
 * operator override; an item without a reference price is not blocked — the
 * editor simply asks for the applied price. The quantity and price stay exact
 * decimal strings the whole time: they are never parsed into a number, and the
 * value the editor holds is exactly what the create payload submits.
 *
 * No lifecycle, discount, appointment or patient control exists here, and no
 * derived total is computed: the line total, tax and sale total belong to the
 * API.
 */
export function LineEditor({ line, disabled, onChange, onRemove }: LineEditorProps): JSX.Element {
  const referencePrice =
    line.referencePriceAmount === null
      ? null
      : `${formatWireAmount(line.referencePriceAmount)} ${line.referencePriceCurrency ?? ""}`.trim();

  return (
    <div className="space-y-3 rounded-lg border border-input p-3">
      <div className="flex items-start justify-between gap-4">
        <span className="min-w-0 truncate font-medium text-foreground">{line.name}</span>
        <span className="shrink-0 text-xs text-muted-foreground">
          {referencePrice === null ? "No reference price" : `Reference ${referencePrice}`}
        </span>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <label htmlFor={`${line.key}-quantity`} className="text-sm font-medium">
            Quantity
          </label>
          <input
            id={`${line.key}-quantity`}
            type="text"
            inputMode="decimal"
            value={line.quantity}
            onChange={(event) => onChange(line.key, { quantity: event.target.value })}
            disabled={disabled}
            placeholder="e.g. 1.000"
            className={inputClassName}
          />
        </div>

        <div className="space-y-2">
          <label htmlFor={`${line.key}-price`} className="text-sm font-medium">
            Applied unit price
          </label>
          <input
            id={`${line.key}-price`}
            type="text"
            inputMode="decimal"
            value={line.unitPrice}
            onChange={(event) => onChange(line.key, { unitPrice: event.target.value })}
            disabled={disabled}
            placeholder={line.referencePriceAmount === null ? "Required" : "Reference price"}
            className={inputClassName}
          />
          <p className="text-xs text-muted-foreground">
            {line.referencePriceAmount === null
              ? "This item has no reference price; enter the applied price."
              : "Pre-filled from the catalog reference price. Override it, or clear it to accept the reference price."}
          </p>
        </div>
      </div>

      <div className="flex justify-end">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onRemove(line.key)}
          disabled={disabled}
        >
          Remove line
        </Button>
      </div>
    </div>
  );
}
