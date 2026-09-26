import { z } from "zod";

/**
 * Current contract version of the purchase DTO, carried in every purchase
 * audit row's metadata. Bumped when the accepted key set or value formats
 * change (the catalog/inventory/supplier convention).
 */
export const PURCHASES_DTO_SCHEMA_VERSION = 1;

/**
 * Lifecycle values pinned by the schema enum `purchase_status` (PRD §17). Kept
 * as a local literal tuple so this boundary stays decoupled from the generated
 * client namespace (structural compatibility only). The server owns the
 * lifecycle: no request contract accepts a caller-supplied status.
 */
export const PURCHASE_STATUS_VALUES = ["DRAFT", "RECEIVED", "CANCELLED"] as const;

/**
 * Exact positive quantity at the `Decimal(10, 3)` column scale: up to 7 integer
 * digits and at most 3 decimals, and NEVER a sign or a float. This is the same
 * scale discipline the EPIC-10 ledger uses (`STOCK_QUANTITY_PATTERN`), minus the
 * sign: a purchase line quantity is an input, so it can never be negative.
 * DEC-012 also requires it to be strictly greater than zero.
 */
export const PURCHASE_QUANTITY_PATTERN = /^\d{1,7}(\.\d{1,3})?$/;

/**
 * Exact NON-NEGATIVE unit cost at the `Decimal(14, 2)` column scale: up to 12
 * integer digits and at most 2 decimals, matching the catalog reference-price
 * scale (DEC-010/DEC-013). A float is never accepted, and a negative value is
 * rejected by the pattern before it reaches the column CHECK.
 */
export const PURCHASE_UNIT_COST_PATTERN = /^\d{1,12}(\.\d{1,2})?$/;

/**
 * True when the literal is arithmetically zero in any accepted spelling
 * (`"0"`, `"00"`, `"0.0"`, `"0.000"`). The pattern already rejects a sign, so a
 * zero quantity is the only value the pattern admits that DEC-012 forbids; the
 * API rejects it first with `400 VALIDATION_FAILED` instead of surfacing the
 * column CHECK as a persistence error.
 */
function isZeroQuantity(value: string): boolean {
  return /^0*(\.0*)?$/.test(value);
}

const purchaseQuantity = z
  .string()
  .regex(
    PURCHASE_QUANTITY_PATTERN,
    "Purchase line quantity must be an exact decimal string (max 10 digits, 3 decimals)."
  )
  .refine((value) => !isZeroQuantity(value), "Purchase line quantity must be greater than zero.");

const purchaseUnitCost = z
  .string()
  .regex(
    PURCHASE_UNIT_COST_PATTERN,
    "Purchase line unit cost must be an exact non-negative decimal string (max 14 digits, 2 decimals)."
  );

/**
 * One submitted purchase line. `.strict()` rejects unknown keys, so a line
 * cannot smuggle a server-owned field (an id, a timestamp or a foreign
 * `tenantId`) past the boundary. `unitCost` is optional: omitting it means the
 * line carries no informational cost (DEC-013), never a zero.
 */
const purchaseLine = z
  .object({
    catalogItemId: z.string().uuid(),
    quantity: purchaseQuantity,
    unitCost: purchaseUnitCost.optional(),
  })
  .strict();

/**
 * The submitted LINE SET. DEC-012 requires at least one line to save a draft,
 * and rejects a duplicate `catalogItemId` inside one purchase — that rejection
 * is what keeps receiving deterministic (one line, one movement). The duplicate
 * rule is enforced here as `400 VALIDATION_FAILED` so the composite unique key
 * is never the first line of defence.
 *
 * LINE-SET RECONCILIATION (DEC-019): on update the submitted array is the
 * authoritative line set and every entry is matched to the stored draft BY
 * `catalogItemId`. A matched entry is updated in place (its `id` and creation
 * identity are preserved), a new `catalogItemId` is inserted, and a stored line
 * whose `catalogItemId` is absent from the payload is DELETED. That deletion is
 * exactly what DEC-019's conditional trigger permits while the purchase is
 * `DRAFT`, and it is why reconciliation can never touch a confirmed purchase.
 * Because the payload describes each line completely, an omitted `unitCost`
 * means the matched line is left with no cost (it is cleared, not ignored).
 */
const purchaseLines = z
  .array(purchaseLine)
  .min(1, "A purchase must have at least one line.")
  .refine(
    (lines) => new Set(lines.map((line) => line.catalogItemId)).size === lines.length,
    "A purchase line must not repeat a catalog item."
  );

/** Purchase-addressed path parameter; a non-UUID is `400 VALIDATION_FAILED`. */
export const purchaseIdParam = z.object({ id: z.string().uuid() });

/**
 * Create payload (DEC-012): `supplierId` is required and `lines` must carry at
 * least one strictly positive line. `.strict()` rejects unknown keys — including
 * `tenantId`, which is resolved server-side from the request context and is
 * never caller authority, and `status`, which only the server lifecycle owns (a
 * new purchase is `DRAFT` until the receive command exists).
 */
export const createPurchaseBody = z
  .object({
    supplierId: z.string().uuid(),
    lines: purchaseLines,
  })
  .strict();

export type CreatePurchaseInput = z.infer<typeof createPurchaseBody>;

/**
 * Update payload. `supplierId` may be changed and is optional; `lines` is the
 * authoritative line set described above and is REQUIRED, so an update always
 * states the complete set it wants. `.strict()` rejects `tenantId` and `status`
 * for the same reasons as create: the lifecycle is server-owned and a status
 * transition has its own command (`POST /purchases/:id/cancel`).
 */
export const updatePurchaseBody = z
  .object({
    supplierId: z.string().uuid().optional(),
    lines: purchaseLines,
  })
  .strict();

export type UpdatePurchaseInput = z.infer<typeof updatePurchaseBody>;

/**
 * Purchase list query. The optional `status` narrows the list to one lifecycle
 * value and is applied on top of the implicit tenant predicate; an omitted
 * status applies NO filter (there is deliberately no implicit draft-only
 * default). `.strict()` rejects unknown query keys instead of ignoring them,
 * mirroring the catalog, stock-movement and supplier filters.
 */
export const purchaseListQuery = z
  .object({ status: z.enum(PURCHASE_STATUS_VALUES).optional() })
  .strict();

export type PurchaseListFiltersInput = z.infer<typeof purchaseListQuery>;
