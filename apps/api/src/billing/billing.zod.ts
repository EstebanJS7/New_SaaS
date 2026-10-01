import { z } from "zod";

/**
 * Current contract version of the invoice DTO, carried in every invoice audit
 * row's metadata. Bumped when the accepted key set or value formats change (the
 * sales/cash DTO convention).
 */
export const BILLING_DTO_SCHEMA_VERSION = 1;

/**
 * Create payload (DEC-038): the sale reference and NOTHING else. The currency,
 * the customer, the snapshot lines and the totals are all derived server-side
 * from that sale's frozen rows, so no caller-computed amount can enter the
 * document.
 *
 * `.strict()` rejects unknown keys — explicitly including `tenantId` (resolved
 * server-side from the request context and never caller authority), `status`
 * (server-owned lifecycle, `DRAFT` by schema default), `currency` and
 * `customerId` (both inherited from the sale, DEC-038), `series`/`number`
 * (allocated only at confirmation, DEC-039) and any caller-supplied line or
 * total. An unknown key is the stable `400 VALIDATION_FAILED` through the
 * controller's `parseInput`.
 */
export const createInvoiceBody = z
  .object({
    saleId: z.string().uuid(),
  })
  .strict();

export type CreateInvoiceInput = z.infer<typeof createInvoiceBody>;

/**
 * Lifecycle values pinned by the `invoice_status` enum (PRD §21, DEC-038),
 * declared as a local literal tuple so this boundary stays decoupled from the
 * generated client namespace. The server owns the lifecycle: no request
 * contract accepts a caller-supplied status, and `CONFIRMED`/`CANCELLED` are
 * reachable only through BILL-003's explicit commands — the list filter merely
 * selects among stored values.
 */
export const INVOICE_STATUS_VALUES = Object.freeze(["DRAFT", "CONFIRMED", "CANCELLED"] as const);

/** Invoice-addressed path parameter; a non-UUID is `400 VALIDATION_FAILED`. */
export const invoiceIdParam = z.object({ id: z.string().uuid() });

/**
 * Invoice list query. The optional `status` narrows the list to one lifecycle
 * value and is applied on top of the implicit tenant predicate; an omitted
 * status applies NO filter (there is deliberately no implicit draft-only
 * default). `.strict()` rejects unknown query keys instead of ignoring them, so
 * a caller cannot smuggle a tenant, sale or pagination predicate into the read,
 * mirroring the catalog/stock-movement/supplier/purchase/sale/cash filters.
 */
export const invoiceListQuery = z
  .object({ status: z.enum(INVOICE_STATUS_VALUES).optional() })
  .strict();

export type InvoiceListFiltersInput = z.infer<typeof invoiceListQuery>;
