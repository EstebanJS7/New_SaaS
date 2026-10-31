import { z } from "zod";
import {
  createTreatmentBody,
  createStudyBody,
  createWeightBody,
  updateTreatmentBody,
  updateStudyBody,
  updateWeightBody,
} from "./clinical.zod.js";

export const draftKind = z.enum(["treatment", "study", "weight"]);
const uuid = z.string().uuid();
const version = z.number().int().min(1).max(2147483646);
const instant = z.string().datetime({ offset: true });
const reason = z.string().max(2000).optional();
const creation = z
  .object({ key: uuid, command: z.unknown().optional(), savedId: uuid.optional() })
  .strict();
const base = { id: uuid, version };
const commonFields = { date: z.string().max(40), correctionReason: reason };
/** Bounded working fields may be incomplete. Commands are independently validated before dispatch. */
export const clinicalDraftCopy = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("treatment"),
      initial: z
        .object({
          ...base,
          description: z.string().max(2000),
          context: z.string().max(10000).nullable(),
          administeredAt: instant,
        })
        .strict()
        .optional(),
      fields: z
        .object({
          ...commonFields,
          description: z.string().max(2000),
          context: z.string().max(10000),
          creation: creation
            .extend({
              command: createTreatmentBody.omit({ idempotencyKey: true }).partial().optional(),
            })
            .optional(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("study"),
      initial: z
        .object({
          ...base,
          studyType: z.string().max(2000),
          result: z.string().max(10000),
          performedAt: instant,
        })
        .strict()
        .optional(),
      fields: z
        .object({
          ...commonFields,
          studyType: z.string().max(2000),
          result: z.string().max(10000),
          creation: creation
            .extend({
              command: createStudyBody.omit({ idempotencyKey: true }).partial().optional(),
            })
            .optional(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("weight"),
      initial: z
        .object({
          ...base,
          quantity: z.string().regex(/^\d{1,7}\.\d{3}$/),
          unit: z.literal("KG").nullable(),
          measuredAt: instant,
        })
        .strict()
        .optional(),
      fields: z
        .object({
          ...commonFields,
          quantity: z.string().max(40),
          confirmedKg: z.boolean(),
          creation: creation
            .extend({
              command: createWeightBody.omit({ idempotencyKey: true }).partial().optional(),
            })
            .optional(),
        })
        .strict(),
    })
    .strict(),
]);
export type ClinicalDraftCopy = z.infer<typeof clinicalDraftCopy>;
export const saveClinicalDraft = z
  .object({ version: z.number().int().min(0).max(2147483646), copy: clinicalDraftCopy })
  .strict();
export const submitClinicalDraft = z.object({ version, command: z.unknown() }).strict();
export const closeClinicalDraft = z.object({ version }).strict();
export const searchClinicalDraft = z.object({ kind: draftKind, before: uuid.optional() }).strict();
export const creationCommands = {
  treatment: createTreatmentBody.extend({ idempotencyKey: uuid }),
  study: createStudyBody.extend({ idempotencyKey: uuid }),
  weight: createWeightBody.extend({ idempotencyKey: uuid, unit: z.literal("KG") }),
};
const guard = {
  expectedVersion: version,
  correctionReason: z
    .string()
    .min(1)
    .max(2000)
    .refine((v) => v.trim().length > 0),
};
export const correctionCommands = {
  treatment: updateTreatmentBody.extend(guard),
  study: updateStudyBody.extend(guard),
  weight: updateWeightBody.extend(guard),
};
