/**
 * Allowlisted purchase read projections (EPIC-11 PUR-001).
 *
 * Data classification (DEC-012/DEC-013): the supplier reference, the status and
 * the line quantities/costs are INTERNAL. Prisma models are never returned;
 * only the keys declared here cross the HTTP boundary, and no CONFIDENTIAL or
 * RESTRICTED payload is read or written by this slice.
 *
 * Decimal fields are projected as FIXED-SCALE exact strings at their stored
 * column scale — quantity at `Decimal(10, 3)`, unit cost at `Decimal(14, 2)` —
 * never as JavaScript floats, following the documented
 * "Decimal projections are fixed-scale" rule (`ClinicalWeight.quantity`,
 * catalog reference price and the inventory ledger are the precedents).
 * Padding to the column scale is lossless because this slice performs no price,
 * quantity or tax arithmetic, no valuation and no rounding.
 */

/** Lifecycle values pinned by the `purchase_status` enum (PRD §17). */
export type PurchaseStatusDto = "DRAFT" | "RECEIVED" | "CANCELLED";

/**
 * One allowlisted purchase line. `unitCost` is `null` when the informational
 * cost was never supplied (DEC-013); no total or tax is derived from it.
 */
export interface PurchaseLineResponse {
  readonly id: string;
  readonly catalogItemId: string;
  /** Exact fixed-scale (3 decimals) positive literal, e.g. `"2.000"`. */
  readonly quantity: string;
  /** Exact fixed-scale (2 decimals) non-negative literal, or `null`. */
  readonly unitCost: string | null;
}

/**
 * Allowlisted Purchase response. `tenantId` is the CALLER's own tenant — the
 * same disclosure the Customer/Patient/Supplier/CatalogItem DTOs make. There is
 * deliberately no number, code, total or tax key: DEC-018 ships no numbering
 * column and DEC-013 derives no amount.
 */
export interface PurchaseResponse {
  readonly id: string;
  readonly tenantId: string;
  readonly supplierId: string;
  readonly status: PurchaseStatusDto;
  readonly lines: PurchaseLineResponse[];
  readonly createdAt: string;
  readonly updatedAt: string;
}
