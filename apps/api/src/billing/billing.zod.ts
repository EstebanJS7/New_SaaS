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
