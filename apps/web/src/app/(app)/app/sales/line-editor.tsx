"use client";

import type { JSX } from "react";
import { Button } from "@newsaas/ui/components/ui/button";
import type { CartLine } from "./counter-cart";
import { formatAmount } from "./sales-display";
import { isWireQuantity, isWireUnitPrice } from "./sales-api";
import { normalizeEsPyDecimalInput } from "@/lib/es-py-format";

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
      : formatAmount(line.referencePriceAmount, line.referencePriceCurrency);
  const quantity = normalizeEsPyDecimalInput(line.quantity);
  const unitPrice = normalizeEsPyDecimalInput(line.unitPrice);
  const quantityInvalid = quantity === null || !isWireQuantity(quantity);
  const priceInvalid =
    line.unitPrice.trim().length === 0
      ? line.referencePriceAmount === null
      : unitPrice === null || !isWireUnitPrice(unitPrice);

  return (
    <div className="space-y-3 rounded-lg border border-input p-3">
      <div className="flex items-start justify-between gap-4">
        <span className="min-w-0 truncate font-medium text-foreground">{line.name}</span>
        <span className="shrink-0 text-xs text-muted-foreground">
          {referencePrice === null ? "Sin precio de referencia" : `Referencia: ${referencePrice}`}
        </span>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <label htmlFor={`${line.key}-quantity`} className="text-sm font-medium">
            Cantidad <span aria-hidden="true">*</span>
          </label>
          <input
            id={`${line.key}-quantity`}
            type="text"
            inputMode="decimal"
            value={line.quantity}
            onChange={(event) => onChange(line.key, { quantity: event.target.value })}
            disabled={disabled}
            placeholder="p. ej., 1,5"
            aria-invalid={quantityInvalid}
            aria-describedby={quantityInvalid ? `${line.key}-quantity-help` : undefined}
            className={inputClassName}
          />
          {quantityInvalid && (
            <p id={`${line.key}-quantity-help`} className="text-xs text-destructive">
              Ingresá una cantidad mayor que cero, con hasta tres decimales. Usá coma para los
              decimales y punto para los miles.
            </p>
          )}
        </div>

        <div className="space-y-2">
          <label htmlFor={`${line.key}-price`} className="text-sm font-medium">
            Precio unitario aplicado
          </label>
          <input
            id={`${line.key}-price`}
            type="text"
            inputMode="decimal"
            value={line.unitPrice}
            onChange={(event) => onChange(line.key, { unitPrice: event.target.value })}
            disabled={disabled}
            placeholder={
              line.referencePriceAmount === null ? "Obligatorio" : "Precio de referencia"
            }
            aria-invalid={priceInvalid}
            aria-describedby={`${line.key}-price-help`}
            className={inputClassName}
          />
          <p
            id={`${line.key}-price-help`}
            className={priceInvalid ? "text-xs text-destructive" : "text-xs text-muted-foreground"}
          >
            {line.referencePriceAmount === null
              ? priceInvalid
                ? "Ingresá el precio aplicado. Este artículo no tiene precio de referencia. Usá coma para los decimales y punto para los miles."
                : "Este artículo no tiene precio de referencia. Usá coma para los decimales y punto para los miles."
              : "El precio proviene del catálogo; podés cambiarlo o dejarlo vacío para usar el precio de referencia. Usá coma para los decimales y punto para los miles."}
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
          Quitar artículo
        </Button>
      </div>
    </div>
  );
}
