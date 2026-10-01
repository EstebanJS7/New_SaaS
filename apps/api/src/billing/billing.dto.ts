/**
 * Allowlisted invoice read projections (EPIC-14 BILL-002).
 *
 * Data classification (PRD §41): the currency, the status, the series, the
 * allocated number, the frozen rate code, the line description and the line
 * money amounts are INTERNAL. Prisma models are never returned; only the keys
 * declared here cross the HTTP boundary, and no CONFIDENTIAL or RESTRICTED
 * payload is read or written by this slice.
 *
 * There is deliberately NO `tenantId` key on either projection (the cash
 * precedent, DEC-020): the caller's tenant is already the request's own identity
 * and no invoice is ever addressed across a tenant boundary. The `saleId` and
 * `customerId` references are the invoice's OWN inherited coordinates
 * (DEC-038), not caller-supplied ones.
 *
 * Decimal fields are projected as FIXED-SCALE exact strings at their stored
 * column scale — quantity at `Decimal(10, 3)`, unit price / line total /
 * taxable base / tax amount at `Decimal(14, 2)` — never as JavaScript floats,
 * following the documented "Decimal projections are fixed-scale" rule (the
 * sales/purchases/cash DTOs are the sibling precedents). Padding to the column
 * scale is lossless because the invoice line is a VERBATIM copy of the sale's
 * already-rounded snapshot.
 */

/** Lifecycle values pinned by the `invoice_status` enum (PRD §21, DEC-038). */
export type InvoiceStatusDto = "DRAFT" | "CONFIRMED" | "CANCELLED";

/**
 * One allowlisted invoice line: the immutable snapshot copied verbatim from the
 * sale's frozen `SaleLine` (DEC-038). `position` is the invoice-local 0-based
 * reading order and `description` is the source catalog item's name, which is
 * the only text the document carries.
 */
export interface InvoiceLineResponse {
  readonly id: string;
  readonly catalogItemId: string;
  /** Invoice-local 0-based reading order, unique per invoice. */
  readonly position: number;
  /** Frozen line description copied from the catalog item name (`VarChar(200)`). */
  readonly description: string;
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
 * Allowlisted invoice response. There is deliberately no `tenantId` (the cash
 * precedent), no fiscal field and no payment field: Billing keeps no fiscal
 * state (DEC-042) and payments stay on the sale (PRD §19, DEC-044).
 *
 * `total` and `taxTotal` are PROJECTIONS over the invoice's OWN immutable
 * lines, summed locally with exact decimals — not pricing arithmetic. The
 * invoice stores no header total, so a projection can never disagree with the
 * frozen snapshot it describes.
 */
export interface InvoiceResponse {
  readonly id: string;
  /** The one completed sale this invoice bills (DEC-038). */
  readonly saleId: string;
  /** Customer inherited from the sale; `null` for a walk-in sale (DEC-028). */
  readonly customerId: string | null;
  /** ISO 4217 code inherited from the source sale; never caller-supplied. */
  readonly currency: string;
  readonly status: InvoiceStatusDto;
  /** Numbering series, `"A"` in this epic (DEC-039). */
  readonly series: string;
  /** Allocated number; `null` until confirmation (DEC-039). */
  readonly number: number | null;
  /** Set exactly when the invoice is confirmed. */
  readonly confirmedAt: string | null;
  /** Set exactly when the invoice is cancelled (DEC-043). */
  readonly cancelledAt: string | null;
  readonly cancelReason: string | null;
  readonly lines: InvoiceLineResponse[];
  /** Sum of the line totals, exact fixed-scale (2 decimals). */
  readonly total: string;
  /** Sum of the line tax amounts, exact fixed-scale (2 decimals). */
  readonly taxTotal: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}
