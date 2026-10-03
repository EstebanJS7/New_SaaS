import { z } from "zod";

export const FISCAL_DTO_SCHEMA_VERSION = 1;

export const createFiscalDocumentBody = z.object({ invoiceId: z.string().uuid() }).strict();

export type CreateFiscalDocumentInput = z.infer<typeof createFiscalDocumentBody>;
