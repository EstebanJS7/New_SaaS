import { z } from "zod";

/**
 * The reporting response contract (EPIC-18 REP-002, [[DEC-062]]).
 *
 * Data classification (PRD §41): every value here is INTERNAL — aggregate
 * counts, calendar dates and money totals of the tenant's OWN confirmed sales.
 * No customer, patient, clinical or fiscal identity is read, and no CONFIDENTIAL
 * or RESTRICTED payload crosses this boundary. Prisma models are never returned;
 * only the keys declared here leave the process.
 *
 * Decimal projections are fixed-scale exact strings at their stored column scale
 * (`Decimal(14, 2)` for every money aggregate), never JavaScript floats and never
 * `number`s: `"0.10"` is the value, and `0.1 + 0.2` cannot appear in a response
 * because no aggregate in the reporting path is ever held as a float.
 */

/**
 * The period echo. It exists so a caller can PROVE what was aggregated: the same
 * resolved range the query applied, in both of its representations — the
 * calendar dates a human asked for and the half-open instant range that was
 * actually queried ([[DEC-063]]).
 */
export interface ReportPeriodDto {
  /** The preset that produced the range, or `null` for a custom `from`/`to` pair. */
  readonly preset: string | null;
  /** `YYYY-MM-DD` in the tenant zone. */
  readonly fromDate: string;
  /** `YYYY-MM-DD` in the tenant zone, inclusive. */
  readonly toDate: string;
  /** The zone the boundaries were resolved in. Never a request parameter. */
  readonly timeZone: string;
  /** ISO 8601 instant — the INCLUSIVE start of `fromDate`. */
  readonly fromInstant: string;
  /** ISO 8601 instant — the EXCLUSIVE end: the first instant of the day after `toDate`. */
  readonly toInstant: string;
}

/**
 * One calendar day of the report, in the TENANT's day. `bucketDate` is the
 * local day a sale's `completedAt` belongs to, so a sale completed at 23:30 local
 * is counted on that day and not on the next UTC one.
 */
export interface SalesByPeriodRowDto {
  /** `YYYY-MM-DD` in the tenant zone. */
  readonly bucketDate: string;
  /** Completed sales whose event instant falls on this local day. */
  readonly saleCount: number;
  /** Sum of the line taxable bases, exact fixed-scale (2 decimals), e.g. `"10.10"`. */
  readonly net: string;
  /** Sum of the line tax amounts, exact fixed-scale (2 decimals). */
  readonly tax: string;
  /** Sum of the line totals (tax included), exact fixed-scale (2 decimals). */
  readonly gross: string;
}

/**
 * `GET /reports/sales-by-period` (PRD §31). `currency` is the tenant's
 * server-resolved sale currency ([[DEC-022]]) and there is deliberately no
 * conversion column: no conversion exists anywhere in the system.
 */
export interface SalesByPeriodResponse {
  readonly report: "sales-by-period";
  readonly period: ReportPeriodDto;
  /** ISO-4217 code of the tenant's configured sale currency. */
  readonly currency: string;
  /** Completed sales in the whole period — the sum of the row counts. */
  readonly saleCount: number;
  /** Exact fixed-scale (2 decimals) period total. */
  readonly totalNet: string;
  /** Exact fixed-scale (2 decimals) period total. */
  readonly totalTax: string;
  /** Exact fixed-scale (2 decimals) period total. */
  readonly totalGross: string;
  /** Ascending by `bucketDate`. An empty period is `[]`, never an error. */
  readonly rows: SalesByPeriodRowDto[];
}

/**
 * One tender of the period (`GET /reports/payment-methods`, [[REP-003]]).
 *
 * The period predicate is the SALE's `completedAt`, never `Payment.createdAt`: a
 * payment row is written only by the `CompleteSale` transaction ([[DEC-029]]), so
 * its own timestamp is an implementation detail of the same commit and the two
 * reports that describe one revenue must not be able to cut it differently.
 */
export interface PaymentMethodRowDto {
  /** The `PaymentMethod` enum literal — `CASH`, `CARD`, `BANK_TRANSFER`, `QR`, `CHECK`, `OTHER`. */
  readonly method: string;
  /** Payments recorded with this method in the period. */
  readonly paymentCount: number;
  /** Summed `Decimal(14, 2)` amount, exact fixed-scale (2 decimals). */
  readonly amount: string;
  /**
   * `amount / totalGross` as a fixed-scale (4 decimals) string. `"0.0000"` when
   * the period's gross is zero: the share is a refusal to divide, never a NaN.
   * Rounded shares need not add to `"1.0000"`.
   */
  readonly shareOfGross: string;
}

/**
 * `GET /reports/payment-methods` (PRD §31, [[REP-003]]): how the money arrived.
 * It reads `payment`, never `cash_movement` — `cash_movement` carries no
 * `sale_id`, so the two ledgers answer different questions and never substitute
 * for each other.
 */
export interface PaymentMethodsResponse {
  readonly report: "payment-methods";
  readonly period: ReportPeriodDto;
  /** ISO-4217 code of the tenant's configured sale currency. */
  readonly currency: string;
  /** Every payment amount in the period, exact fixed-scale (2 decimals). */
  readonly totalGross: string;
  /** `amount` descending, then `method` ascending. An empty period is `[]`. */
  readonly rows: PaymentMethodRowDto[];
}

/**
 * One catalog item that earned revenue in the period (`GET
 * /reports/sales-by-product-service`, [[REP-003]]).
 */
export interface SalesByProductServiceRowDto {
  /** The frozen `sale_line.catalog_item_id` the lines were grouped by. */
  readonly catalogItemId: string;
  /** The item's name as the catalog holds it today (INTERNAL). */
  readonly name: string;
  /** `CatalogItem.kind` as a fact about the item — `PRODUCT`, `SERVICE`, `MEDICATION`, `SUPPLY`. */
  readonly kind: string;
  /** Summed `Decimal(10, 3)` quantity, exact fixed-scale (3 decimals), e.g. `"3.500"`. */
  readonly quantity: string;
  /** Summed taxable base, exact fixed-scale (2 decimals). */
  readonly net: string;
  /** Summed tax amount, exact fixed-scale (2 decimals). */
  readonly tax: string;
  /** Summed line total (tax included), exact fixed-scale (2 decimals). */
  readonly gross: string;
}

/** The `kind` roll-up of {@link SalesByProductServiceRowDto}, on both scales. */
export interface KindTotalDto {
  /** Exact fixed-scale (2 decimals). */
  readonly net: string;
  /** Exact fixed-scale (2 decimals). */
  readonly tax: string;
  /** Exact fixed-scale (2 decimals). */
  readonly gross: string;
  /** Exact fixed-scale (3 decimals) — the ledger's quantity scale. */
  readonly quantity: string;
}

/**
 * `GET /reports/sales-by-product-service` (PRD §31, [[REP-003]]): which products
 * and services earned the money. Only `COMPLETED` sales contribute; an item with
 * no sale in the period, or sold only in a cancelled one, does not appear.
 */
export interface SalesByProductServiceResponse {
  readonly report: "sales-by-product-service";
  readonly period: ReportPeriodDto;
  /** ISO-4217 code of the tenant's configured sale currency. */
  readonly currency: string;
  /**
   * Per `kind` that actually appears in the period, keyed by the enum literal.
   * A kind with no line in the period is ABSENT, never a zero row: a zero would
   * claim the tenant sold nothing under it, which the report did not measure.
   */
  readonly totalsByKind: Record<string, KindTotalDto>;
  /** `gross` descending, then `name` ascending. An empty period is `[]`. */
  readonly rows: SalesByProductServiceRowDto[];
}

/**
 * The query contract of every report route (`GET /reports/sales-by-period`,
 * `GET /reports/payment-methods`, `GET /reports/sales-by-product-service`).
 *
 * `.strict()` so an unknown key is REFUSED rather than silently ignored: a
 * typo'd `from_` would otherwise widen the report to a different question while
 * looking like the one that was asked.
 *
 * The three keys are only SHAPE-validated here (strings, no unknown keys) — the
 * period rule, with its one stable message per condition, lives in
 * `report.period.ts` and owns every semantic rejection ([[DEC-063]]). Duplicating
 * the preset list here would be a second, drift-prone opinion about the same
 * contract.
 */
export const reportPeriodQuerySchema = z
  .object({
    preset: z.string().optional(),
    from: z.string().optional(),
    to: z.string().optional(),
  })
  .strict();

export type ReportPeriodQuery = z.infer<typeof reportPeriodQuerySchema>;

/** Stable message behind every rejection of the query SHAPE (unknown key, wrong type). */
export const REPORT_PERIOD_QUERY_INVALID_MESSAGE = "Invalid report period query.";
