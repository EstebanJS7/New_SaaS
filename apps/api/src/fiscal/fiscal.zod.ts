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

/**
 * The read surface's status vocabulary, mirroring `fiscal_document_status`.
 *
 * FISC-009 appended `SIGNING` to the enum and this list kept nine values until
 * FISC-010 WU-D closed the drift — the same vocabulary the web client mirrors.
 * It is ordered by the lifecycle, not by the enum's append order.
 */
export const FISCAL_DOCUMENT_STATUS_VALUES = Object.freeze([
  "PENDING",
  "QUEUED",
  "SIGNING",
  "SENDING",
  "SUBMITTED",
  "APPROVED",
  "REJECTED",
  "ERROR",
  "CANCEL_PENDING",
  "CANCELLED",
] as const);

/** No implicit default filter and no pagination, matching the shipped list precedent. */
export const fiscalDocumentListQuery = z
  .object({ status: z.enum(FISCAL_DOCUMENT_STATUS_VALUES).optional() })
  .strict();
export type FiscalDocumentListInput = z.infer<typeof fiscalDocumentListQuery>;
