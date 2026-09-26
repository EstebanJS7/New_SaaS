/**
 * Allowlisted catalog read projections (EPIC-09 WU2).
 *
 * Data classification: catalog configuration (kind, name, active flag, the
 * global rate reference and the informational reference price) is INTERNAL.
 * Prisma models are never returned; only the keys declared here cross the HTTP
 * boundary, and no rate is copied into the item.
 *
 * Decimal fields are projected as FIXED-SCALE STRINGS at the stored two-decimal
 * scale, never as JavaScript floats and never in the trimmed form a real read
 * would otherwise produce (`"10"` for `DECIMAL(5,2)` `10.00`). The scale is the
 * column's own: EPIC-09 fixed the reference-price scale at `Decimal(14, 2)` for
 * every currency. Padding to that scale is lossless, and this slice performs no
 * price or tax arithmetic, rounding or conversion on these values
 * (`ClinicalWeight.quantity` is the precedent). The canonical spelling is
 * documented in `CAT-003` ("Decimal projections are fixed-scale").
 */

/** Item kinds pinned by the `catalog_item_kind` database enum (PRD §15). */
export type CatalogItemKindDto = "PRODUCT" | "SERVICE" | "MEDICATION" | "SUPPLY";

/**
 * Read-only projection of the item's selected GLOBAL rate. It carries the
 * stable `code`, the display `name` and the exact `rate` literal at the stored
 * two-decimal scale; the item already carries `taxRateId`, so the nested
 * projection deliberately repeats no identifier.
 */
export interface TaxRateProjection {
  readonly code: string;
  readonly name: string;
  /** Exact fixed-scale (2 decimals) literal, e.g. `"10.00"`. */
  readonly rate: string;
}

/** One row of the GLOBAL tax-rate list every tenant reads identically. */
export interface TaxRateResponse {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  /** Exact fixed-scale (2 decimals) literal, e.g. `"10.00"`. */
  readonly rate: string;
}

/**
 * Allowlisted CatalogItem response. `tenantId` is the CALLER's own tenant —
 * the same disclosure the Customer/Patient DTOs make — and the global rate
 * arrives as a nested read-only projection instead of a duplicated column.
 *
 * `tracksStock` is the EPIC-10 stock dimension: a plain manual boolean set by
 * kind on create (`SERVICE` false, the physical kinds true) and editable by
 * staff afterwards, so a caller can read back what the write path stored.
 */
export interface CatalogItemResponse {
  readonly id: string;
  readonly tenantId: string;
  readonly kind: CatalogItemKindDto;
  readonly name: string;
  readonly taxRateId: string;
  readonly taxRate: TaxRateProjection;
  /** Exact fixed-scale (2 decimals) amount string, or `null` when absent. */
  readonly referencePriceAmount: string | null;
  readonly referencePriceCurrency: string | null;
  readonly isActive: boolean;
  /** Whether the item participates in the EPIC-10 stock ledger. */
  readonly tracksStock: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}
