import { z } from "zod";

export const FISCAL_DTO_SCHEMA_VERSION = 1;

export const createFiscalDocumentBody = z.object({ invoiceId: z.string().uuid() }).strict();

export type CreateFiscalDocumentInput = z.infer<typeof createFiscalDocumentBody>;

/** Reason is trimmed before length checks (cash/invoice precedent); strict input rejects tenantId, status and cancelledAt. A non-UUID path id is a 400 VALIDATION_FAILED. */
export const FISCAL_CANCEL_REASON_MAX_LENGTH = 500;
export const cancelFiscalDocumentBody = z
  .object({
    reason: z
      .string()
      .trim()
      .min(1, "A fiscal document cancel reason is required.")
      .max(
        FISCAL_CANCEL_REASON_MAX_LENGTH,
        `A fiscal document cancel reason must be at most ${FISCAL_CANCEL_REASON_MAX_LENGTH} characters.`
      ),
  })
  .strict();
export type CancelFiscalDocumentInput = z.infer<typeof cancelFiscalDocumentBody>;
export const fiscalDocumentIdParam = z.object({ id: z.string().uuid() });
