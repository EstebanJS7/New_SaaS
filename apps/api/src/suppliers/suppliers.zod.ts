import { z } from "zod";

/**
 * Current contract version of the supplier DTO, carried in every supplier
 * audit row's metadata. Bumped when the accepted key set or value formats
 * change (the catalog/inventory convention).
 */
export const SUPPLIERS_DTO_SCHEMA_VERSION = 1;

/**
 * Supplier trading name: the same 1..200 bound the Customer `displayName`, the
 * Patient `name` and the catalog item `name` use, so every tenant-scoped name
 * field of the product agrees on one maximum. The column is `VARCHAR(200)` and
 * the W1 migration adds the matching length CHECK, so this contract is what
 * keeps a blank or over-long name out of the boundary first.
 */
export const SUPPLIER_NAME_MAX_LENGTH = 200;

/**
 * Optional identity/contact bounds. They mirror the column widths declared by
 * the W1 `Supplier` model (`legal_name` 200, `tax_id` 50, `email` 320, `phone`
 * 50, `address` 500) so the API can never submit a value the column would
 * truncate.
 *
 * SHAPE RULE: the shipped `Customer` contracts validate contact values by
 * LENGTH ONLY — `customer-contact.zod.ts` is `z.string().min(1).max(255)` free
 * text and the portal profile phone payload is the same rule. `Customer` has no
 * e-mail regex and no phone pattern, so this contract deliberately introduces
 * neither: `email` and `phone` are bounded by length only.
 */
export const SUPPLIER_LEGAL_NAME_MAX_LENGTH = 200;
export const SUPPLIER_TAX_ID_MAX_LENGTH = 50;
export const SUPPLIER_EMAIL_MAX_LENGTH = 320;
export const SUPPLIER_PHONE_MAX_LENGTH = 50;
export const SUPPLIER_ADDRESS_MAX_LENGTH = 500;

const supplierName = z.string().min(1).max(SUPPLIER_NAME_MAX_LENGTH);
const supplierLegalName = z.string().min(1).max(SUPPLIER_LEGAL_NAME_MAX_LENGTH);
const supplierTaxId = z.string().min(1).max(SUPPLIER_TAX_ID_MAX_LENGTH);
const supplierEmail = z.string().min(1).max(SUPPLIER_EMAIL_MAX_LENGTH);
const supplierPhone = z.string().min(1).max(SUPPLIER_PHONE_MAX_LENGTH);
const supplierAddress = z.string().min(1).max(SUPPLIER_ADDRESS_MAX_LENGTH);

/** Supplier-addressed path parameter; a non-UUID is `400 VALIDATION_FAILED`. */
export const supplierIdParam = z.object({ id: z.string().uuid() });

/**
 * Supplier list query. Query strings arrive as text, so `isActive` accepts
 * exactly `"true"`/`"false"` and is coerced to a boolean; anything else is
 * rejected. `.strict()` rejects unknown query keys instead of ignoring them,
 * mirroring the catalog and stock-movement filters.
 *
 * An omitted `isActive` adds NO predicate — there is deliberately no implicit
 * active-only default, exactly like the catalog list contract.
 */
export const supplierListQuery = z
  .object({
    isActive: z
      .enum(["true", "false"])
      .optional()
      .transform((value) => (value === undefined ? undefined : value === "true")),
  })
  .strict();

/**
 * Create payload. Only `name` is required; the five identity/contact fields are
 * optional and NOT nullable — an explicit `null` fails the string check with
 * `400 VALIDATION_FAILED`, because omitting the key is the one way to leave a
 * field absent on create.
 *
 * `.strict()` rejects unknown keys — including `tenantId`, which is resolved
 * server-side from the request context and is never caller authority, and
 * `isActive`, which only the dedicated deactivate command may change.
 */
export const createSupplierBody = z
  .object({
    name: supplierName,
    legalName: supplierLegalName.optional(),
    taxId: supplierTaxId.optional(),
    email: supplierEmail.optional(),
    phone: supplierPhone.optional(),
    address: supplierAddress.optional(),
  })
  .strict();

export type CreateSupplierInput = z.infer<typeof createSupplierBody>;

/**
 * Update payload. Every field is optional and the absent-versus-null
 * distinction is deliberate:
 *
 * - an OMITTED key leaves the stored value untouched (that is what omitting it
 *   means);
 * - an explicit `null` CLEARS an optional field (DEC-011's optional identity
 *   fields have no "empty string" state, so `null` is the clear signal);
 * - `name` is NOT nullable: it is required on the model, so a `null` fails the
 *   string check with `400 VALIDATION_FAILED` and a blank or over-long name is
 *   the same 400.
 *
 * `.strict()` rejects `tenantId` and `isActive` for the same reasons as create:
 * deactivation has its own command route and its own `suppliers.deactivate`
 * permission, so `suppliers.update` can never deactivate a supplier.
 */
export const updateSupplierBody = z
  .object({
    name: supplierName.optional(),
    legalName: supplierLegalName.nullable().optional(),
    taxId: supplierTaxId.nullable().optional(),
    email: supplierEmail.nullable().optional(),
    phone: supplierPhone.nullable().optional(),
    address: supplierAddress.nullable().optional(),
  })
  .strict();

export type UpdateSupplierInput = z.infer<typeof updateSupplierBody>;
