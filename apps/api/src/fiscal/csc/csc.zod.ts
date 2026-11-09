import { z } from "zod";

/**
 * SIFEN-BASELINE §24.2-24.3: the CSC is "32 dígitos alfanuméricos" and `IdCSC`
 * is four characters long. The baseline fixes only the identifier's length, so
 * the schema adds nothing beyond refusing whitespace and control characters.
 * The value is never trimmed or transformed: what is stored is what SIFEN issued.
 */
export const loadCscBodySchema = z
  .object({
    environment: z.enum(["TEST", "PRODUCTION"]),
    idCsc: z.string().regex(/^[\x21-\x7E]{4}$/),
    value: z.string().regex(/^[0-9A-Za-z]{32}$/),
  })
  .strict();
export const retireCscBodySchema = z.object({ reason: z.string().trim().min(1).max(500) }).strict();
export const cscIdSchema = z.object({ id: z.string().uuid() }).strict();
