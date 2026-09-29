import { z } from "zod";

/**
 * Current contract version of the sale DTO, carried in every sale audit row's
 * metadata. Bumped when the accepted key set or value formats change (the
 * catalog/inventory/purchase convention).
 */
export const SALES_DTO_SCHEMA_VERSION = 1;

/**
 * Lifecycle values pinned by the schema enum `sale_status` (PRD §18). Kept as a
 * local literal tuple so this boundary stays decoupled from the generated
 * client namespace (structural compatibility only). The server owns the
 * lifecycle: no request contract accepts a caller-supplied status, and
 * `CANCELLED` is reachable only through its explicit command.
 */
export const SALE_STATUS_VALUES = ["DRAFT", "COMPLETED", "CANCELLED"] as const;

/**
 * Exact positive quantity at the `Decimal(10, 3)` column scale: up to 7 integer
 * digits and at most 3 decimals, and NEVER a sign or a float (the purchase
 * quantity discipline, which mirrors the EPIC-10 ledger scale).
 */
export const SALE_QUANTITY_PATTERN = /^\d{1,7}(\.\d{1,3})?$/;

/**
 * Exact NON-NEGATIVE unit price at the `Decimal(14, 2)` column scale: up to 12
 * integer digits and at most 2 decimals, matching the catalog reference-price
 * scale (DEC-010/DEC-022). A float is never accepted and a negative value is
 * rejected by the pattern before it reaches the column CHECK.
 */
export const SALE_UNIT_PRICE_PATTERN = /^\d{1,12}(\.\d{1,2})?$/;

/**
 * True when the literal is arithmetically zero in any accepted spelling
 * (`"0"`, `"00"`, `"0.0"`, `"0.000"`). The pattern already rejects a sign, so a
 * zero quantity is the only value it admits that the schema forbids; the API
 * rejects it first with `400 VALIDATION_FAILED` instead of surfacing the column
 * CHECK as a persistence error.
 */
function isZeroQuantity(value: string): boolean {
  return /^0*(\.0*)?$/.test(value);
}

const saleQuantity = z
  .string()
  .regex(
    SALE_QUANTITY_PATTERN,
    "Sale line quantity must be an exact decimal string (max 10 digits, 3 decimals)."
  )
  .refine((value) => !isZeroQuantity(value), "Sale line quantity must be greater than zero.");

const saleUnitPrice = z
  .string()
  .regex(
    SALE_UNIT_PRICE_PATTERN,
    "Sale line unit price must be an exact non-negative decimal string (max 14 digits, 2 decimals)."
  );

/**
 * One submitted sale line. `.strict()` rejects unknown keys, so a line cannot
 * smuggle a server-owned field (an id, a timestamp, a foreign `tenantId` or a
 * derived amount) past the boundary. `unitPrice` is OPTIONAL: the catalog
 * reference price is a suggestion (DEC-022), so omitting the override falls back
 * to it, and a line that omits the override on an item with no usable reference
 * price is rejected by the service with the stable `400` below.
 */
const saleLine = z
  .object({
    catalogItemId: z.string().uuid(),
    quantity: saleQuantity,
    unitPrice: saleUnitPrice.optional(),
  })
  .strict();

/**
 * The submitted LINE SET. At least one line is required, and a duplicate
 * `catalogItemId` inside one sale is rejected — that rejection is what keeps
 * the update command's reconciliation deterministic (one line per item, the
 * schema's tenant-leading unique key). The duplicate rule is enforced here as
 * `400 VALIDATION_FAILED` so the unique key is never the first line of defence.
 *
 * LINE-SET RECONCILIATION (DEC-022): on update the submitted array is the
 * AUTHORITATIVE line set and every entry is matched to the stored draft BY
 * `catalogItemId`. A matched entry is updated in place (its `id` is preserved),
 * a new `catalogItemId` is inserted, and a stored line whose `catalogItemId` is
 * absent from the payload is DELETED. Because the payload describes each line
 * completely, an omitted `unitPrice` re-derives from the current reference price
 * rather than leaving a stale override.
 */
const saleLines = z
  .array(saleLine)
  .min(1, "A sale must have at least one line.")
  .refine(
    (lines) => new Set(lines.map((line) => line.catalogItemId)).size === lines.length,
    "A sale line must not repeat a catalog item."
  );

/** Sale-addressed path parameter; a non-UUID is `400 VALIDATION_FAILED`. */
export const saleIdParam = z.object({ id: z.string().uuid() });

/**
 * Create payload (DEC-022/DEC-028): `customerId` is OPTIONAL and may be `null`
 * (a walk-in sale needs none) and `lines` must carry at least one strictly
 * positive line. `.strict()` rejects unknown keys — explicitly including
 * `tenantId` (resolved server-side from the request context and never caller
 * authority), `status` (server-owned lifecycle), `currency` and `total`
 * (server-derived), `number` (there is no numbering column, DEC-027) and any
 * discount field (no discount concept exists, DEC-028).
 */
export const createSaleBody = z
  .object({
    customerId: z.string().uuid().nullable().optional(),
    lines: saleLines,
  })
  .strict();

export type CreateSaleInput = z.infer<typeof createSaleBody>;

/**
 * Update payload. `customerId` may be changed, cleared with `null` or omitted;
 * `lines` is the authoritative line set described above and is REQUIRED, so an
 * update always states the complete set it wants. `.strict()` rejects
 * `tenantId`, `status`, `currency`, `total`, `number` and any discount field for
 * the same reasons as create: the lifecycle and the currency are server-owned
 * and a status transition has its own command (`POST /sales/:id/cancel`).
 */
export const updateSaleBody = z
  .object({
    customerId: z.string().uuid().nullable().optional(),
    lines: saleLines,
  })
  .strict();

export type UpdateSaleInput = z.infer<typeof updateSaleBody>;

/**
 * Payment method literals pinned by the schema enum `payment_method` (PRD §19,
 * DEC-029). Kept as a local literal tuple so the request contract stays
 * decoupled from the generated client namespace (structural compatibility only).
 */
export const PAYMENT_METHOD_VALUES = [
  "CASH",
  "CARD",
  "BANK_TRANSFER",
  "QR",
  "CHECK",
  "OTHER",
] as const;

/**
 * Exact POSITIVE payment amount at the `Decimal(14, 2)` column scale: the same
 * shape as the unit price (up to 12 integer digits, at most 2 decimals), with
 * the sign disallowed by the pattern so a negative amount never reaches the
 * column CHECK. A zero amount is rejected by the refine below.
 */
const salePaymentAmount = z
  .string()
  .regex(
    SALE_UNIT_PRICE_PATTERN,
    "Payment amount must be an exact positive decimal string (max 14 digits, 2 decimals)."
  )
  .refine((value) => !isZeroQuantity(value), "Payment amount must be greater than zero.");

/**
 * One submitted payment: its PRD §19 method and its exact positive amount.
 * `.strict()` rejects unknown keys, so a payment cannot smuggle a server-owned
 * field (an id, a timestamp, a foreign `tenantId`, a sale id or a derived
 * value) past the boundary. There is deliberately no tendered amount, change or
 * refund field (DEC-029).
 */
const salePayment = z
  .object({ method: z.enum(PAYMENT_METHOD_VALUES), amount: salePaymentAmount })
  .strict();

/**
 * CompleteSale body (PRD §18/DEC-029): a NON-EMPTY payment set, each entry a
 * strict `{ method, amount }` pair. `.strict()` rejects unknown keys —
 * explicitly including `tenantId` (resolved server-side from the request
 * context and never caller authority), `status` (server-owned lifecycle) and
 * the sale's id or currency (both come from the addressed sale). The payments
 * must sum exactly to the sale total; that sum is validated by the service
 * against the recomputed snapshot before any write, so a mismatch is a `400`
 * that persists nothing.
 */
export const completeSaleBody = z
  .object({ payments: z.array(salePayment).min(1, "At least one payment is required.") })
  .strict();

export type CompleteSaleInput = z.infer<typeof completeSaleBody>;

/**
 * Optional `Idempotency-Key` header value (DEC-024): a non-empty string bounded
 * to the `VarChar(255)` column width. The header is optional; when absent the
 * completion still serializes on the header row lock and a replay is a stable
 * `409`.
 */
export const saleIdempotencyKey = z.string().min(1).max(255);

/**
 * Sale list query. The optional `status` narrows the list to one lifecycle value
 * and is applied on top of the implicit tenant predicate; an omitted status
 * applies NO filter (there is deliberately no implicit draft-only default).
 * `.strict()` rejects unknown query keys instead of ignoring them, mirroring the
 * catalog, stock-movement, supplier and purchase filters.
 */
export const saleListQuery = z.object({ status: z.enum(SALE_STATUS_VALUES).optional() }).strict();

export type SaleListFiltersInput = z.infer<typeof saleListQuery>;
