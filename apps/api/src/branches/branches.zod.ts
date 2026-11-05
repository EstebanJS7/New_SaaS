import { z } from "zod";

/**
 * MB-001 request contracts. Strict objects: an unknown key (for example
 * `isActive` on the edit body) is a 400, because activation is its own command.
 */

const name = z.string().trim().min(1).max(120);
/** Optional text: empty or whitespace clears it (stored as NULL). */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value.length === 0 ? null : value))
    .nullable()
    .optional();

export const branchIdParam = z.object({ id: z.string().uuid() }).strict();

export const createBranchBody = z
  .object({
    name,
    address: optionalText(255),
    phone: optionalText(30),
  })
  .strict();
export type CreateBranchInput = z.infer<typeof createBranchBody>;

/**
 * MB-002 (DEC-094 §9): the branch's own issuance point. Both keys together:
 * an establishment and a three-digit point, or `null` for both to go back to
 * the emitter profile's default point.
 */
const issuancePoint = {
  fiscalEstablishmentId: z.string().uuid().nullable().optional(),
  expeditionPoint: z
    .string()
    .regex(/^[0-9]{3}$/)
    .nullable()
    .optional(),
};

export const updateBranchBody = z
  .object({
    name: name.optional(),
    address: optionalText(255),
    phone: optionalText(30),
    ...issuancePoint,
  })
  .strict()
  .refine(
    (body) =>
      (body.fiscalEstablishmentId === undefined) === (body.expeditionPoint === undefined) &&
      (body.fiscalEstablishmentId === null) === (body.expeditionPoint === null),
    { message: "Establecimiento y punto de expedición van juntos." }
  );
export type UpdateBranchInput = z.infer<typeof updateBranchBody>;

export const membershipIdParam = z.object({ id: z.string().uuid() }).strict();

export const assignBranchesBody = z
  .object({ branchIds: z.array(z.string().uuid()).max(100) })
  .strict();
export type AssignBranchesInput = z.infer<typeof assignBranchesBody>;
