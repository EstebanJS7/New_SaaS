import { z } from "zod";

/**
 * Current contract version of the inventory DTO, carried in every inventory
 * audit row's metadata. Bumped when the accepted key set or value formats
 * change (the catalog convention).
 */
export const INVENTORY_DTO_SCHEMA_VERSION = 1;

/**
 * Exact SIGNED decimal at the `Decimal(10, 3)` column scale: up to 7 integer
 * digits and 3 decimals, with an optional leading `-` for an output. The
 * `ClinicalWeight.quantity` precedent — quantities never travel as a
 * JavaScript number, so a float cannot enter the boundary and no rounding is
 * implied. A positive quantity is an input and a negative one an output.
 */
export const STOCK_QUANTITY_PATTERN = /^-?\d{1,7}(\.\d{1,3})?$/;

/**
 * True when the literal is arithmetically zero in any accepted spelling
 * (`"0"`, `"0.000"`, `"-0.0"`). A zero movement would move no stock and the
 * database CHECK rejects it, so the API rejects it first with
 * `400 VALIDATION_FAILED` instead of surfacing a constraint error.
 */
function isZeroQuantity(value: string): boolean {
  return /^-?0*(\.0*)?$/.test(value);
}

const stockQuantity = z
  .string()
  .regex(
    STOCK_QUANTITY_PATTERN,
    "Stock quantity must be an exact signed decimal string (max 10 digits, 3 decimals)."
  )
  .refine((value) => !isZeroQuantity(value), "Stock quantity must not be zero.");

/**
 * Adjustment reason: mandatory and bounded, mirroring the clinical amendment
 * reason. The database column is unbounded `TEXT`, so this contract is what
 * keeps a blank or unbounded reason out. The VALUE is stored on the immutable
 * movement; the audit row carries the field NAME only.
 */
export const STOCK_ADJUSTMENT_REASON_MAX_LENGTH = 500;
const stockAdjustmentReason = z.string().min(1).max(STOCK_ADJUSTMENT_REASON_MAX_LENGTH);

/**
 * Signed adjustment body. `.strict()` rejects unknown keys — including
 * `type`, which the command fixes to `ADJUSTMENT`, and `tenantId`, which is
 * resolved server-side from the request context and never supplied by a
 * caller. A positive quantity is an input; a negative one is an output.
 */
export const createStockAdjustmentBody = z
  .object({
    catalogItemId: z.string().uuid(),
    quantity: stockQuantity,
    reason: stockAdjustmentReason,
  })
  .strict();

export type CreateStockAdjustmentInput = z.infer<typeof createStockAdjustmentBody>;

/**
 * Movement list query. The optional `catalogItemId` narrows the ledger to one
 * item; any other query key is rejected instead of ignored, mirroring the
 * catalog list query. The value is resolved in-tenant by the service, so an
 * unknown or foreign item id is the shared, byte-equivalent `404` rather than
 * a silent empty list.
 */
export const stockMovementListQuery = z
  .object({ catalogItemId: z.string().uuid().optional() })
  .strict();

export type StockMovementListFiltersInput = z.infer<typeof stockMovementListQuery>;
