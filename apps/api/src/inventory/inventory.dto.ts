/**
 * Allowlisted inventory read projections (EPIC-10 W2).
 *
 * Data classification: stock quantities and adjustment reasons are INTERNAL
 * (the EPIC-10 ledger block in `schema.prisma`). Prisma models are never
 * returned; only the keys declared here cross the HTTP boundary, and no
 * CONFIDENTIAL/RESTRICTED payload is read or written by this slice.
 *
 * Quantities are projected as FIXED-SCALE (3 decimals) exact strings — the
 * `Decimal(10, 3)` column scale — never JavaScript floats and never the
 * trimmed form a real read would otherwise produce (`"5"` for `5.000`). The
 * scale is PINNED rather than taken from the value's own text, because the two
 * persistence paths disagree about padding for the same stored value: a real
 * `DECIMAL` read arrives as a `Prisma.Decimal` that trims trailing zeros, while
 * the test double hands back the literal verbatim. Padding both to the column
 * scale gives the API ONE canonical spelling without ever rounding a stored
 * digit (`ClinicalWeight.quantity` / catalog reference price are the
 * precedents).
 */

/** Item kinds pinned by the `catalog_item_kind` enum (PRD §15). */
export type StockItemKindDto = "PRODUCT" | "SERVICE" | "MEDICATION" | "SUPPLY";

/**
 * Movement kinds pinned by the `stock_movement_type` enum (PRD §16, W1). This
 * slice ships ONLY the standalone signed adjustment; purchases, sales,
 * transfers and the `*_REVERSAL` compensations are added additively later.
 */
export type StockMovementTypeDto = "ADJUSTMENT";

/**
 * Read-only projection of the item a balance belongs to. It carries the
 * display `name` and the `kind`; the balance already carries `catalogItemId`,
 * so the nested projection deliberately repeats no identifier (mirrors the
 * catalog's nested tax-rate projection).
 */
export interface StockItemProjection {
  readonly name: string;
  readonly kind: StockItemKindDto;
}

/**
 * One row of the tenant's stock projection. `quantity` is the signed-running
 * NON-NEGATIVE balance by construction: the projection is the ledger's
 * transactional sum and the fixed `BLOCK` policy never lets it go below zero.
 */
export interface StockBalanceResponse {
  readonly id: string;
  readonly tenantId: string;
  readonly catalogItemId: string;
  readonly item: StockItemProjection;
  /** Exact fixed-scale (3 decimals) non-negative literal, e.g. `"12.500"`. */
  readonly quantity: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * One immutable ledger entry. `quantity` is SIGNED — positive is an input,
 * negative an output — and is never zero (the schema CHECK rejects zero).
 * `reversesMovementId` is the reserved compensating link and is `null` until
 * the reversal command ships.
 */
export interface StockMovementResponse {
  readonly id: string;
  readonly tenantId: string;
  readonly catalogItemId: string;
  readonly type: StockMovementTypeDto;
  /** Exact fixed-scale (3 decimals) signed literal, e.g. `"-2.500"`. */
  readonly quantity: string;
  readonly reason: string;
  readonly reversesMovementId: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}
