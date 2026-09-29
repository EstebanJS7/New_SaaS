"use client";

/**
 * Local counter cart model (EPIC-12 POS-004).
 *
 * The cart is browser-local state with no persistence and no server identity:
 * POS-004's accepted resolution is that the cart stays local and the checkout
 * action creates the `DRAFT` sale with the cart's lines and then completes it
 * with the payments. Nothing here calls the API, and nothing here performs money
 * arithmetic: a line carries the exact decimal strings the operator typed, the
 * catalog reference price is only a suggestion (DEC-022), and the line total,
 * tax and sale total remain the API's to compute.
 */

import type { CatalogItem } from "../catalog/catalog-api";
import { isWireQuantity, isWireUnitPrice, type SaleLineInput } from "./sales-api";

/**
 * One local cart line. `unitPrice` is the applied price the operator will
 * submit; it is pre-filled from the catalog reference price when the item has
 * one and stays editable (the DEC-022 override). An empty `unitPrice` means
 * "no override": the line is submitted without the optional `unitPrice` field,
 * and either the API applies the item's reference price or refuses a line that
 * then has no usable price at all.
 */
export interface CartLine {
  readonly key: string;
  readonly catalogItemId: string;
  readonly name: string;
  readonly referencePriceAmount: string | null;
  readonly referencePriceCurrency: string | null;
  /** Exact fixed-scale (3 decimals) positive literal the operator will submit. */
  readonly quantity: string;
  /** Applied price literal, pre-filled from the reference price when one exists. */
  readonly unitPrice: string;
}

/**
 * Builds a cart line from an item. The quantity starts at one whole unit at the
 * column scale, and the applied price starts at the item's reference price when
 * one exists — the operator override is a change to this value, not a separate
 * field.
 */
export function cartLineFromItem(item: CatalogItem, key: string): CartLine {
  return {
    key,
    catalogItemId: item.id,
    name: item.name,
    referencePriceAmount: item.referencePriceAmount,
    referencePriceCurrency: item.referencePriceCurrency,
    quantity: "1.000",
    unitPrice: item.referencePriceAmount ?? "",
  };
}

/**
 * Maps the local cart onto the create payload's line set. The optional
 * `unitPrice` is sent only when the operator has a value for it, so an accepted
 * reference price is never re-encoded into a caller-owned number and a cleared
 * override is a deliberate "use the reference price". The quantity is sent as
 * the exact string the operator typed.
 */
export function buildSaleLines(lines: readonly CartLine[]): SaleLineInput[] {
  return lines.map((line) => {
    const unitPrice = line.unitPrice.trim();
    return unitPrice.length > 0
      ? {
          catalogItemId: line.catalogItemId,
          quantity: line.quantity.trim(),
          unitPrice,
        }
      : { catalogItemId: line.catalogItemId, quantity: line.quantity.trim() };
  });
}

/**
 * The first client-side reason the cart cannot be submitted, or `null`.
 *
 * These checks are input affordances only: the API validates every field again
 * against its own exact-decimal patterns and remains the authority. The message
 * names the offending line so the operator can find it without re-reading the
 * whole cart.
 */
export function cartValidationError(lines: readonly CartLine[]): string | null {
  if (lines.length === 0) {
    return "Add at least one line before checking out.";
  }
  for (const line of lines) {
    if (!isWireQuantity(line.quantity.trim())) {
      return `Enter a positive quantity with at most three decimals for ${line.name}.`;
    }
    const unitPrice = line.unitPrice.trim();
    if (unitPrice.length === 0) {
      if (line.referencePriceAmount === null) {
        return `${line.name} has no reference price; enter the applied price.`;
      }
      continue;
    }
    if (!isWireUnitPrice(unitPrice)) {
      return `Enter an applied price with at most two decimals for ${line.name}.`;
    }
  }
  return null;
}

/**
 * Name search over the catalog read the surface already loaded. The shipped
 * catalog list accepts no name filter, so the match happens in the browser over
 * the allowlisted read: a case-insensitive substring of the item name. A
 * keyboard or a tablet keypad drives the same input, and a barcode scanner can
 * only type into it — no scanner behavior is claimed (DEC-025, TD-019).
 */
export function filterCatalogItemsByName(
  items: readonly CatalogItem[],
  query: string
): CatalogItem[] {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) {
    return [...items];
  }
  return items.filter((item) => item.name.toLowerCase().includes(needle));
}
