/**
 * Allowlisted sale read projections (EPIC-12 POS-001 W2).
 *
 * Data classification (PRD §41): the currency, the status, the frozen rate code
 * and the line money amounts are INTERNAL. Prisma models are never returned;
 * only the keys declared here cross the HTTP boundary, and no CONFIDENTIAL or
 * RESTRICTED payload is read or written by this slice.
 *
 * Decimal fields are projected as FIXED-SCALE exact strings at their stored
 * column scale — quantity at `Decimal(10, 3)`, unit price / line total /
 * taxable base / tax amount / sale total at `Decimal(14, 2)` — never as
 * JavaScript floats, following the documented "Decimal projections are
 * fixed-scale" rule (the purchases DTO is the sibling precedent). Padding to
 * the column scale is lossless because the snapshot was already rounded
 * half-up at the currency's minor unit before it was persisted.
 */

/** Lifecycle values pinned by the `sale_status` enum (PRD §18). */
export type SaleStatusDto = "DRAFT" | "COMPLETED" | "CANCELLED";

/**
 * One allowlisted sale line: the immutable snapshot the future invoice
 * consumes (DEC-021). `rateCode` is the frozen `tax_rate.code`; `unitPrice` is
 * the applied price whether it came from the catalog reference price or the
 * operator's override (DEC-022).
 */
export interface SaleLineResponse {
  readonly id: string;
  readonly catalogItemId: string;
  /** Frozen stable rate code, e.g. `"EXEMPT"` / `"IVA_10"`. */
  readonly rateCode: string;
  /** Exact fixed-scale (2 decimals) non-negative literal, e.g. `"10.50"`. */
  readonly unitPrice: string;
  /** Exact fixed-scale (3 decimals) positive literal, e.g. `"2.000"`. */
  readonly quantity: string;
  /** Exact fixed-scale (2 decimals) non-negative literal. */
  readonly lineTotal: string;
  /** Exact fixed-scale (2 decimals) non-negative literal. */
  readonly taxableBase: string;
  /** Exact fixed-scale (2 decimals) non-negative literal. */
  readonly taxAmount: string;
}

/**
 * Allowlisted Sale response. `tenantId` is the CALLER's own tenant — the same
 * disclosure the Purchase/Supplier/CatalogItem DTOs make. `total` is derived
 * from the lines (there is no total column, DEC-021). There is deliberately no
 * number, code, discount, appointment or patient key (DEC-027, DEC-028).
 */
export interface SaleResponse {
  readonly id: string;
  readonly tenantId: string;
  readonly customerId: string | null;
  readonly currency: string;
  readonly status: SaleStatusDto;
  readonly lines: SaleLineResponse[];
  /** Sum of the line totals, exact fixed-scale (2 decimals). */
  readonly total: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}
